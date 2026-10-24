import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  DEFAULT_RULE_TTL_MS,
  MAX_RULE_TTL_MS,
  NarrowError,
  narrowRule,
  parseApprovers,
  proposeRule,
  replayPassed,
  replayRule,
  type ApproverConfig,
  type AttackCase,
  type ReplayContext,
} from "@countersign/rules";
import type { Decision, Hold, HoldPayment, HoldStatus, ReplayResult, Rule, Store, Task } from "@countersign/shared";
import { ToolError, idempotencyKey, parseInput } from "./common";
import { parseQuote, type Executor, type QuoteInfo } from "./executor";
import { budgetSnapshot, settle } from "./settlement";
import { toAtomic } from "./normalize";

export function loadApproversFile(path: string | URL): ApproverConfig {
  return parseApprovers(JSON.parse(readFileSync(path, "utf8")));
}

/** RULE_TTL_MS: positive integer ms <= 365 days (MAX_RULE_TTL_MS, what proposeRule accepts); unset/blank -> 7 days (D29). A bad value is a startup error, not a silent default. */
export function ruleTtlFromEnv(env: NodeJS.ProcessEnv): number {
  const v = env.RULE_TTL_MS;
  if (v === undefined || v.trim() === "") return DEFAULT_RULE_TTL_MS;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`RULE_TTL_MS must be a positive integer number of ms, got '${v}'`);
  if (n > MAX_RULE_TTL_MS) throw new Error(`RULE_TTL_MS must be at most 365 days (${MAX_RULE_TTL_MS} ms), got '${v}'`);
  return n;
}

/** What the worker sees for a hold (D33). */
export interface HoldView {
  holdId: string;
  decisionId: string;
  status: HoldStatus;
  reason: string;
  data?: unknown;
}

export function holdView(h: Hold): HoldView {
  const base = { holdId: h.holdId, decisionId: h.decisionId };
  if (h.status === "open") return { ...base, status: "open", reason: `held for review by ${h.routedTo}` };
  if (h.status === "rejected") return { ...base, status: "rejected", reason: `rejected by ${h.resolvedBy ?? "an approver"}` };
  // Approved, but the payment has not finished: the worker keeps waiting.
  if (h.payment?.status === "unknown") return { ...base, status: "open", reason: h.payment.reason };
  if (!h.payment) return { ...base, status: "open", reason: `approved by ${h.resolvedBy ?? "an approver"}; payment in progress` };
  return {
    ...base,
    status: "approved",
    reason: h.payment.reason,
    ...(h.payment.status === "settled" ? { data: h.payment.data } : {}),
  };
}

export type TierLabel = "Tier 1" | "Tier 2" | "floor";

export function tierLabel(tier: 1 | 2 | null): TierLabel {
  return tier === 1 ? "Tier 1" : tier === 2 ? "Tier 2" : "floor";
}

export interface HoldListItem {
  hold: Hold;
  decision: Decision;
  tierLabel: TierLabel;
  task: Pick<Task, "taskId" | "text" | "taskType">;
}

export interface ApproveHoldResult {
  hold: Hold;
  decisionId: string;
  payment: HoldPayment;
  proposedRule: Rule | null;
  proposalNote: string;
  replay: ReplayResult | null;
}

const Approver = z.string().trim().min(1).max(64);
const GetHoldSchema = z.object({ taskId: z.string().min(1), decisionId: z.string().min(1) });
const ListHoldsSchema = z.object({ status: z.enum(["open", "approved", "rejected"]).optional() });
const ResolveHoldSchema = z.object({ holdId: z.string().min(1), approver: Approver });
const ListRulesSchema = z.object({ status: z.enum(["proposed", "active", "rejected"]).optional() });
const NarrowSchema = z.object({ capUsd: z.number().optional(), expiresAt: z.number().optional() }).strict();
const ActivateRuleSchema = z.object({ ruleId: z.string().min(1), approver: Approver, narrow: NarrowSchema.optional() });
const RejectRuleSchema = z.object({ ruleId: z.string().min(1), approver: Approver });

export interface HoldToolDeps {
  store: Store;
  executor: Executor;
  ruleTtlMs: number;
  attackCorpus: AttackCase[];
}

/** Fields a human decision copies from the held decision it resolves (D28). */
function carried(d: Decision) {
  return {
    paymentRequestId: d.paymentRequestId,
    taskId: d.taskId,
    fieldOrigins: d.fieldOrigins,
    evidence: d.evidence,
    amountUsd: d.amountUsd,
    payeeDomain: d.payeeDomain,
    category: d.category,
    floorReasons: d.floorReasons,
  };
}

/**
 * Approver-side tools back the /admin routes, which are UNAUTHENTICATED by design (D13, D34).
 * `approver` is a self-declared name. The judge/proposer never see the agent's free-text purpose:
 * proposeRule and replayRule take only the logged decision (trace fields), never hold.req.purpose.
 */
export function createHoldTools(deps: HoldToolDeps) {
  const { store, executor } = deps;

  async function requireHold(holdId: string): Promise<Hold> {
    const hold = await store.getHold(holdId);
    if (!hold) throw new ToolError("HOLD_NOT_FOUND", `no hold ${holdId}`);
    return hold;
  }

  async function requireHeldDecision(hold: Hold): Promise<Decision> {
    const decision = await store.getDecision(hold.decisionId);
    if (!decision) throw new ToolError("HOLD_NOT_FOUND", `hold ${hold.holdId} has no decision ${hold.decisionId}`);
    return decision;
  }

  async function requireRule(ruleId: string): Promise<Rule> {
    const rule = (await store.listRules()).find((r) => r.ruleId === ruleId);
    if (!rule) throw new ToolError("RULE_NOT_FOUND", `no rule ${ruleId}`);
    return rule;
  }

  async function replayContext(): Promise<ReplayContext> {
    const decisions = await store.listDecisions();
    const tasks = new Map<string, Task>();
    for (const taskId of new Set(decisions.map((d) => d.taskId))) {
      const task = await store.getTask(taskId);
      if (task) tasks.set(taskId, task);
    }
    return {
      decisions,
      tasks,
      holds: await store.listHolds(),
      attackCorpus: deps.attackCorpus,
      activeRules: (await store.listRules()).filter((r) => r.status === "active"),
      now: store.now(),
    };
  }

  return {
    /** Worker tool (D33). 404 unless this task owns a held decision; no existence leak. */
    async getHold(input: unknown): Promise<HoldView> {
      const { taskId, decisionId } = parseInput(GetHoldSchema, input);
      const hold = await store.getHoldByDecision(decisionId);
      if (!hold || hold.taskId !== taskId) throw new ToolError("HOLD_NOT_FOUND", `no hold for decision ${decisionId} in this task`);
      return holdView(hold);
    },

    /** Approver queue (D34). */
    async listHolds(input: unknown): Promise<{ holds: HoldListItem[] }> {
      const { status } = parseInput(ListHoldsSchema, input ?? {});
      const holds: HoldListItem[] = [];
      for (const hold of await store.listHolds(status ? { status } : {})) {
        const decision = await store.getDecision(hold.decisionId);
        const task = await store.getTask(hold.taskId);
        if (!decision || !task) {
          console.warn(`[gateway] listHolds: dropping orphan hold ${hold.holdId} (decision ${hold.decisionId} ${decision ? "found" : "missing"}, task ${hold.taskId} ${task ? "found" : "missing"})`);
          continue;
        }
        holds.push({
          hold,
          decision,
          tierLabel: tierLabel(decision.tier),
          task: { taskId: task.taskId, text: task.text, taskType: task.taskType },
        });
      }
      return { holds };
    },

    /** D27-D30: re-check, claim, pay the stored quote with the original key, log, propose, replay. */
    async approveHold(input: unknown): Promise<ApproveHoldResult> {
      const started = performance.now();
      const { holdId, approver } = parseInput(ResolveHoldSchema, input);
      const hold = await requireHold(holdId);
      if (hold.status !== "open") throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} is ${hold.status}`);
      const decision = await requireHeldDecision(hold);
      const task = await store.getTask(hold.taskId);
      if (!task) throw new ToolError("HOLD_NOT_FOUND", `hold ${holdId} has no task ${hold.taskId}`);

      const remaining = (await budgetSnapshot(store, task.taskId, task.budgetUsd)).remainingUsd;
      if (toAtomic(decision.amountUsd) > toAtomic(remaining)) {
        throw new ToolError("BUDGET_EXCEEDED", `amount $${decision.amountUsd} exceeds task budget remaining $${remaining}`);
      }
      const stored = (await store.listQuotes(hold.taskId)).find((q) => q.quoteId === hold.quoteId);
      if (!stored) throw new ToolError("HOLD_NOT_FOUND", `quote ${hold.quoteId} for hold ${holdId} is missing`);
      let quote: QuoteInfo;
      try {
        quote = parseQuote(hold.req.url, 402, stored.rawRequirements);
      } catch (e) {
        throw new ToolError("UPSTREAM_FAILED", `stored quote for hold ${holdId} is unusable: ${(e as Error).message}`);
      }

      const reservation = await store.reserve(task.taskId, randomUUID(), decision.amountUsd, task.budgetUsd);
      if (!reservation.ok) throw new ToolError("BUDGET_EXCEEDED", "budget exhausted while approving hold");
      // Claim before paying: a second click finds the hold no longer open (D28).
      const claimed = await store.updateHold(holdId, "open", { status: "approved", resolvedBy: approver, resolvedAt: store.now() });
      if (!claimed) {
        await store.release(reservation.reservation.reservationId);
        throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} was resolved concurrently`);
      }

      const approval = await store.appendDecision({
        ...carried(decision),
        decisionId: randomUUID(),
        kind: "human_approval",
        tier: null,
        verdict: "approve",
        linkedDecisionId: decision.decisionId,
        reasons: [`approved by ${approver}`],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      });

      const key = idempotencyKey(hold.taskId, quote.payeeDomain, { ...hold.req, amountUsd: quote.amountUsd, tier: quote.tier ?? undefined, quantity: quote.quantity });
      const outcome = await settle({ store, executor, decision: approval, reservation: reservation.reservation, key, quote, url: hold.req.url });

      let payment: HoldPayment;
      if (outcome.status === "settled") {
        payment = {
          status: "settled",
          reason: `approved by ${approver}; ${outcome.reason}`,
          data: outcome.data,
          decisionId: approval.decisionId,
        };
      } else if (outcome.status === "unknown") {
        payment = { status: "unknown", reason: outcome.reason, decisionId: approval.decisionId };
      } else {
        const failReason = outcome.reason;
        const failure = await store.appendDecision({
          ...carried(decision),
          decisionId: randomUUID(),
          kind: "executor_failure",
          tier: null,
          verdict: "block",
          linkedDecisionId: approval.decisionId,
          reasons: [failReason],
          latencyMs: performance.now() - started,
          costUsd: 0,
          createdAt: store.now(),
        });
        payment = { status: "failed", reason: `payment failed: ${failReason}`, decisionId: failure.decisionId };
      }

      // The money has moved: persist the outcome BEFORE anything that can throw (proposal, replay).
      const persisted = await store.updateHold(holdId, "approved", { payment, resolutionDecisionId: approval.decisionId });
      let hold2 = persisted ?? claimed;

      let proposedRule: Rule | null = null;
      let replay: ReplayResult | null = null;
      let proposalNote: string;
      try {
        const proposal = proposeRule({
          decision,
          task,
          approver,
          now: store.now(),
          ttlMs: deps.ruleTtlMs,
          ruleId: randomUUID(),
          holdId,
        });
        proposalNote = proposal.reason;
        if (proposal.rule) {
          replay = replayRule(proposal.rule, await replayContext());
          const candidate: Rule = { ...proposal.rule, replayResult: replay };
          await store.putRule(candidate);
          proposedRule = candidate;
          hold2 = (await store.updateHold(holdId, "approved", { proposedRuleId: candidate.ruleId })) ?? hold2;
        }
      } catch (e) {
        console.error(`[gateway] rule proposal failed after approving hold ${holdId}`, e);
        proposedRule = null;
        replay = null;
        proposalNote = `rule proposal failed (${(e as Error).message}); the payment is recorded, one-off approval only`;
      }
      return { hold: hold2, decisionId: approval.decisionId, payment, proposedRule, proposalNote, replay };
    },

    async rejectHold(input: unknown): Promise<{ hold: Hold; decisionId: string }> {
      const started = performance.now();
      const { holdId, approver } = parseInput(ResolveHoldSchema, input);
      const hold = await requireHold(holdId);
      if (hold.status !== "open") throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} is ${hold.status}`);
      const decision = await requireHeldDecision(hold);
      const claimed = await store.updateHold(holdId, "open", { status: "rejected", resolvedBy: approver, resolvedAt: store.now() });
      if (!claimed) throw new ToolError("HOLD_NOT_OPEN", `hold ${holdId} was resolved concurrently`);
      const rejection = await store.appendDecision({
        ...carried(decision),
        decisionId: randomUUID(),
        kind: "human_rejection",
        tier: null,
        verdict: "block",
        linkedDecisionId: decision.decisionId,
        reasons: [`rejected by ${approver}`],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      });
      const final = await store.updateHold(holdId, "rejected", { resolutionDecisionId: rejection.decisionId });
      return { hold: final ?? claimed, decisionId: rejection.decisionId };
    },

    async listRules(input: unknown): Promise<{ rules: Rule[] }> {
      const { status } = parseInput(ListRulesSchema, input ?? {});
      const rules = await store.listRules();
      return { rules: status ? rules.filter((r) => r.status === status) : rules };
    },

    /** D29, D30: optional tighten-only narrowing, then a fresh replay; any known-bad or attack match refuses. */
    async activateRule(input: unknown): Promise<{ rule: Rule; replay: ReplayResult }> {
      const { ruleId, approver, narrow } = parseInput(ActivateRuleSchema, input);
      const rule = await requireRule(ruleId);
      if (rule.status !== "proposed") throw new ToolError("RULE_STATE", `rule ${ruleId} is ${rule.status}, not proposed`);
      const now = store.now();
      let candidate: Rule;
      try {
        candidate = narrow ? narrowRule(rule, narrow, now) : rule;
      } catch (e) {
        if (e instanceof NarrowError) throw new ToolError("BAD_INPUT", e.message);
        throw e;
      }
      if (candidate.expiresAt <= now) throw new ToolError("RULE_STATE", `rule ${ruleId} expired at ${new Date(candidate.expiresAt).toISOString()}`);

      const replay = replayRule(candidate, await replayContext());
      if (!replayPassed(replay)) {
        // Keep the failing report on the still-proposed, un-narrowed rule (CAS proposed -> proposed).
        await store.updateRule(ruleId, "proposed", { replayResult: replay });
        throw new ToolError("REPLAY_FAILED", `replay refused activation: ${replay.summary}`, { replay });
      }
      const patch: Partial<Rule> = {
        status: "active",
        capUsd: candidate.capUsd,
        expiresAt: candidate.expiresAt,
        replayResult: replay,
        resolvedBy: approver,
        resolvedAt: now,
      };
      const active = await store.updateRule(ruleId, "proposed", patch);
      if (!active) throw new ToolError("RULE_STATE", `rule ${ruleId} changed concurrently; not activated`);
      return { rule: active, replay };
    },

    /** Rejects a proposed rule or deactivates an active one. */
    async rejectRule(input: unknown): Promise<{ rule: Rule }> {
      const { ruleId, approver } = parseInput(RejectRuleSchema, input);
      const rule = await requireRule(ruleId);
      if (rule.status === "rejected") throw new ToolError("RULE_STATE", `rule ${ruleId} is already rejected`);
      const rejected = await store.updateRule(ruleId, rule.status, { status: "rejected", resolvedBy: approver, resolvedAt: store.now() });
      if (!rejected) throw new ToolError("RULE_STATE", `rule ${ruleId} changed concurrently; not rejected`);
      return { rule: rejected };
    },
  };
}

export type HoldTools = ReturnType<typeof createHoldTools>;
