import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  CreateTaskSchema,
  DeclarePlanSchema,
  FetchUrlSchema,
  PayAndFetchSchema,
  canonical,
  sha256Hex,
  type PayResult,
  type PaymentRequest,
  type Store,
  type Task,
} from "@countersign/shared";
import type { CatalogEntry } from "./catalog";
import { decide, similarHistory } from "./decide";
import type { Executor, PayOutcome, QuoteInfo } from "./executor";
import { budgetRemainingUsd, computeFloors } from "./floors";
import type { Judge } from "./judge";
import { traceFields } from "./tracer";

export type ToolErrorCode =
  | "BAD_INPUT"
  | "TASK_NOT_FOUND"
  | "PLAN_REQUIRED"
  | "PLAN_EXISTS"
  | "HOST_NOT_ALLOWED"
  | "UPSTREAM_FAILED";

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string) {
    super(message);
  }
}

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
}

export const EXECUTOR_FAILED_PREFIX = "executor failed";

/** Spec section 8: sha256(taskId + payeeDomain + requestHash). Same request -> same key. */
export function idempotencyKey(taskId: string, payee: string, req: PaymentRequest): string {
  return sha256Hex(taskId + payee + canonical(req));
}

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ToolError("BAD_INPUT", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
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

  return {
    async createTask(input: unknown): Promise<Task> {
      const { text, budgetUsd, taskType } = parse(CreateTaskSchema, input);
      const task: Task = { taskId: randomUUID(), text, budgetUsd, taskType, createdAt: store.now() };
      await store.putTask(task);
      return task;
    },

    async declarePlan(input: unknown): Promise<{ ok: true }> {
      const { taskId, plan } = parse(DeclarePlanSchema, input);
      await requireTask(taskId);
      const inserted = await store.insertPlan({ taskId, goal: plan.goal, expected: plan.expected, declaredAt: store.now() });
      if (!inserted) throw new ToolError("PLAN_EXISTS", "a plan is already declared for this task; plans are immutable");
      return { ok: true };
    },

    async fetchUrl(input: unknown): Promise<{ pageId: string; text: string }> {
      const { taskId, url } = parse(FetchUrlSchema, input);
      await requireTask(taskId);
      await requirePlan(taskId);
      requireAllowedHost(url);
      const text = await fetchPage(url);
      const pageId = randomUUID();
      await store.putPage({ pageId, taskId, url, lines: text.split(/\r?\n/), fetchedAt: store.now() });
      return { pageId, text };
    },

    async payAndFetch(input: unknown): Promise<PayResult> {
      const { taskId, req } = parse(PayAndFetchSchema, input);
      const task = await requireTask(taskId);
      const plan = await requirePlan(taskId);
      requireAllowedHost(req.url);
      const started = performance.now();

      let quote: QuoteInfo;
      try {
        quote = await executor.getQuote(req.url);
      } catch (e) {
        throw new ToolError("UPSTREAM_FAILED", (e as Error).message);
      }
      await store.putQuote({
        quoteId: randomUUID(),
        taskId,
        payeeDomain: quote.payeeDomain,
        amountUsd: quote.amountUsd,
        tier: quote.tier,
        unit: quote.unit,
        quantity: quote.quantity,
        rawRequirements: quote.raw,
        receivedAt: store.now(),
      });

      const trace = traceFields({ task, plan, pages: await store.listPages(taskId), quote, req, catalog: deps.catalog });
      const log = await store.listDecisions();
      const remaining = budgetRemainingUsd(task, log);
      const floor = computeFloors({ trace, req, quote, budgetRemainingUsd: remaining, payeeAllowlist: deps.payeeAllowlist });
      const out = await decide({
        trace,
        floor,
        taskType: task.taskType,
        rules: await store.listRules(),
        now: store.now(),
        judge: deps.judge,
        budgetRemainingUsd: remaining,
        history: similarHistory(log, trace.payee, trace.category),
      });

      const paymentRequestId = randomUUID();
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

      if (out.verdict === "hold") return { status: "held", reason, decisionId: decision.decisionId };
      if (out.verdict === "block") return { status: "blocked", reason, decisionId: decision.decisionId };

      let outcome: PayOutcome;
      try {
        outcome = await executor.pay(req.url, quote, idempotencyKey(taskId, trace.payee, req));
      } catch {
        outcome = { status: "failed", httpStatus: 0, txRef: null, simulated: executor.kind === "simulated" };
      }
      if (outcome.status === "settled") {
        return { status: "approved", reason, data: outcome.data, decisionId: decision.decisionId };
      }

      // D23: never report approved when money did not move; log a follow-up block.
      const failReason = `${EXECUTOR_FAILED_PREFIX}: http ${outcome.httpStatus}`;
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
