import { createReadTools } from "./admin";
import { randomUUID } from "node:crypto";
import {
  CreateTaskSchema,
  DeclarePlanSchema,
  FetchUrlSchema,
  PayAndFetchSchema,
  type PayResult,
  type Store,
  type Task,
} from "@countersign/shared";
import {
  ATTACK_CORPUS,
  DEFAULT_APPROVER_CONFIG,
  DEFAULT_RULE_TTL_MS,
  routeHold,
  type ApproverConfig,
  type AttackCase,
} from "@countersign/rules";
import { EXECUTOR_FAILED_PREFIX, ToolError, idempotencyKey, parseInput } from "./common";
import { createHoldTools } from "./holds";
import type { CatalogEntry } from "./catalog";
import { decide, similarHistory } from "./decide";
import type { Executor, PayOutcome, QuoteInfo } from "./executor";
import { budgetSnapshot, cachedSettlement, settle } from "./settlement";
import { computeFloors } from "./floors";
import type { Judge } from "./judge";
import { traceFields } from "./tracer";

/** Moved to ./common so holds.ts can use them without importing this file. Re-exported unchanged. */
export { EXECUTOR_FAILED_PREFIX, ToolError, idempotencyKey, type ToolErrorCode } from "./common";

export interface GatewayDeps {
  store: Store;
  executor: Executor;
  /** host[:port] values the gateway may contact on the worker's behalf (D9). */
  fetchHosts: string[];
  fetchPage?: (url: string) => Promise<string>;
  /** Endpoint path prefix -> category (D3). */
  catalog: CatalogEntry[];
  /** Payees accepted even when not in the plan's vendorDomains (D24). */
  payeeAllowlist: string[];
  /** Tier 2. Absent = every Tier 2 case is HOLD (D20). */
  judge?: Judge;
  /** Hold routing (D27). main.ts loads config/approvers.json; default only for unit tests. */
  approvers?: ApproverConfig;
  /** Proposed rule lifetime (D29). Default 7 days. */
  ruleTtlMs?: number;
  /** Replay's attack corpus (D31). Default ATTACK_CORPUS. */
  attackCorpus?: AttackCase[];
  deliveryFailureHoldAt?: number;
  duplicateWindowMs?: number;
}

export function createTools(deps: GatewayDeps) {
  const { store, executor } = deps;
  const hosts = new Set(deps.fetchHosts.map((h) => h.toLowerCase()));
  const fetchPage =
    deps.fetchPage ??
    (async (url: string) => {
      // Never follow redirects: a page could bounce the gateway off the allowlist.
      let res: Response;
      try {
        res = await fetch(url, { redirect: "manual" });
      } catch (e) {
        throw new ToolError("UPSTREAM_FAILED", `GET ${url} failed: ${(e as Error).message}`);
      }
      if (res.status < 200 || res.status >= 300) throw new ToolError("UPSTREAM_FAILED", `GET ${url} returned ${res.status}`);
      return res.text();
    });

  async function requireTask(taskId: string): Promise<Task> {
    const task = await store.getTask(taskId);
    if (!task) throw new ToolError("TASK_NOT_FOUND", `no task ${taskId}`);
    return task;
  }

  async function requirePlan(taskId: string) {
    const plan = await store.getPlan(taskId);
    if (!plan) throw new ToolError("PLAN_REQUIRED", "declare_plan must be called before fetch_url or pay_and_fetch");
    return plan;
  }

  function requireAllowedHost(url: string) {
    const host = new URL(url).host.toLowerCase();
    if (!hosts.has(host)) throw new ToolError("HOST_NOT_ALLOWED", `${host} is not a host Countersign may contact`);
  }

  const approvers = deps.approvers ?? DEFAULT_APPROVER_CONFIG;
  const holdTools = createHoldTools({
    store,
    executor,
    ruleTtlMs: deps.ruleTtlMs ?? DEFAULT_RULE_TTL_MS,
    attackCorpus: deps.attackCorpus ?? ATTACK_CORPUS,
  });

  return {
    ...holdTools,
    ...createReadTools(store),

    async createTask(input: unknown): Promise<Task> {
      const { text, budgetUsd, taskType } = parseInput(CreateTaskSchema, input);
      const task: Task = { taskId: randomUUID(), text, budgetUsd, taskType, createdAt: store.now() };
      await store.putTask(task);
      return task;
    },

    async declarePlan(input: unknown): Promise<{ ok: true }> {
      const { taskId, plan } = parseInput(DeclarePlanSchema, input);
      await requireTask(taskId);
      const inserted = await store.insertPlan({ taskId, goal: plan.goal, expected: plan.expected, declaredAt: store.now() });
      if (!inserted) throw new ToolError("PLAN_EXISTS", "a plan is already declared for this task; plans are immutable");
      return { ok: true };
    },

    async fetchUrl(input: unknown): Promise<{ pageId: string; text: string }> {
      const { taskId, url } = parseInput(FetchUrlSchema, input);
      await requireTask(taskId);
      await requirePlan(taskId);
      requireAllowedHost(url);
      const text = await fetchPage(url);
      const pageId = randomUUID();
      await store.putPage({ pageId, taskId, url, lines: text.split(/\r?\n/), fetchedAt: store.now() });
      return { pageId, text };
    },

    async payAndFetch(input: unknown): Promise<PayResult> {
      const { taskId, req } = parseInput(PayAndFetchSchema, input);
      const task = await requireTask(taskId);
      const plan = await requirePlan(taskId);
      requireAllowedHost(req.url);

      let quote: QuoteInfo;
      try {
        quote = await executor.getQuote(req.url);
      } catch (e) {
        throw new ToolError("UPSTREAM_FAILED", (e as Error).message);
      }
      const quoteId = randomUUID();
      await store.putQuote({
        quoteId,
        taskId,
        payeeDomain: quote.payeeDomain,
        amountUsd: quote.amountUsd,
        tier: quote.tier,
        unit: quote.unit,
        quantity: quote.quantity,
        rawRequirements: quote.raw,
        receivedAt: store.now(),
      });

      const started = performance.now(); // D32: the decision's latency, after the vendor's quote round-trip
      const trace = traceFields({ task, plan, pages: await store.listPages(taskId), quote, req, catalog: deps.catalog });
      const log = await store.listDecisions();
      const paymentRequestId = randomUUID();
      const key = idempotencyKey(taskId, quote.payeeDomain, { ...req, amountUsd: quote.amountUsd, tier: quote.tier ?? undefined, quantity: quote.quantity });
      const existing = await store.getPayment(key);
      // Reuse only the same charged resource; request/quote mismatches remain blocked.
      const preflight = computeFloors({ trace, req, quote, budgetRemainingUsd: task.budgetUsd, payeeAllowlist: deps.payeeAllowlist });
      if (existing && existing.state !== "failed" && preflight.verdict !== "block") {
        const expired = existing.state === "settled" && store.now() - existing.createdAt > (deps.duplicateWindowMs ?? 600_000);
        const result = expired ? { status: "unknown" as const, reason: "duplicate window expired; manual reconciliation; will not pay twice", data: undefined } : cachedSettlement(existing);
        const reused = result.status === "settled";
        const d = await store.appendDecision({ decisionId: randomUUID(), paymentRequestId, taskId, kind: reused ? "duplicate_reused" : "payment_unconfirmed", linkedDecisionId: existing.firstDecisionId, tier: null, verdict: reused ? "approve" : "hold", fieldOrigins: trace.origins, evidence: trace.evidence, amountUsd: quote.amountUsd, payeeDomain: quote.payeeDomain, category: trace.category, floorReasons: [], reasons: [result.reason + (reused ? `; saved $${quote.amountUsd}` : "")], latencyMs: performance.now() - started, costUsd: 0, ...(reused ? { savedUsd: quote.amountUsd } : {}), createdAt: store.now() });
        return { status: reused ? "approved" : "held", reason: d.reasons.join("; "), data: result.data, decisionId: d.decisionId, ...(reused ? { reused: true, savedUsd: quote.amountUsd } : {}) };
      }
      const remaining = (await budgetSnapshot(store, taskId, task.budgetUsd)).remainingUsd;
      const floor = computeFloors({ trace, req, quote, budgetRemainingUsd: remaining, payeeAllowlist: deps.payeeAllowlist });
      const reservation = await store.reserve(taskId, paymentRequestId, quote.amountUsd, task.budgetUsd);
      if (!reservation.ok) { floor.verdict = "block"; floor.reasons.push("budget exhausted"); }
      const payee = await store.getPayee(quote.payeeDomain);
      if ((payee?.deliveryFailures ?? 0) >= (deps.deliveryFailureHoldAt ?? 2)) {
        if (floor.verdict === "approve") floor.verdict = "hold";
        floor.reasons.push(`vendor failed delivery ${payee!.deliveryFailures} times`);
      }
      const out = await decide({
        trace,
        floor,
        taskType: task.taskType,
        rules: await store.listRules(),
        now: store.now(),
        judge: deps.judge,
        budgetRemainingUsd: remaining,
        history: similarHistory(log, trace.payee, trace.category),
        payeeRecord: payee,
      });

      // Logged values are the quote-charged ones (trace.amountUsd / trace.payee), never the agent's claims.
      const shared = {
        paymentRequestId,
        taskId,
        fieldOrigins: trace.origins,
        evidence: trace.evidence,
        amountUsd: trace.amountUsd,
        payeeDomain: trace.payee,
        category: trace.category,
        floorReasons: floor.reasons,
      };
      const decision = await store.appendDecision({
        ...shared,
        decisionId: randomUUID(),
        kind: "verdict",
        tier: out.tier,
        verdict: out.verdict,
        ...(out.ruleId ? { ruleId: out.ruleId } : {}),
        ...(out.judge ? { judge: out.judge } : {}),
        reasons: out.reasons,
        latencyMs: performance.now() - started,
        costUsd: out.costUsd,
        createdAt: store.now(),
      });
      const reason = out.reasons.join("; ") || out.verdict;

      if (out.verdict !== "approve" && reservation.ok) await store.release(reservation.reservation.reservationId);
      if (out.verdict === "hold") {
        // D27: one hold per held verdict, routed by config. Block never creates a hold.
        await store.putHold({
          holdId: randomUUID(),
          decisionId: decision.decisionId,
          taskId,
          routedTo: routeHold(approvers, { category: trace.category, amountUsd: Math.max(req.amountUsd, trace.amountUsd) }), // D35: never under-route
          status: "open",
          req,
          quoteId,
          createdAt: store.now(),
        });
        return { status: "held", reason, decisionId: decision.decisionId };
      }
      if (out.verdict === "block") return { status: "blocked", reason, decisionId: decision.decisionId };

      if (!reservation.ok) throw new Error("approve without reservation");
      const outcome = await settle({ store, executor, decision, reservation: reservation.reservation, key, quote, url: req.url });
      if (outcome.status === "settled") {
        return { status: "approved", reason: `${reason}; ${outcome.reason}`, data: outcome.data, decisionId: decision.decisionId, ...(outcome.reused ? { reused: true, savedUsd: quote.amountUsd } : {}) };
      }
      if (outcome.status === "unknown") return { status: "held", reason: outcome.reason, decisionId: decision.decisionId };

      // D23: never report approved when money did not move; log a follow-up block.
      const failReason = outcome.reason;
      const followUp = await store.appendDecision({
        ...shared,
        decisionId: randomUUID(),
        kind: "executor_failure",
        tier: null,
        verdict: "block",
        reasons: [failReason],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      });
      return { status: "blocked", reason: failReason, decisionId: followUp.decisionId };
    },
  };
}

export type Tools = ReturnType<typeof createTools>;
