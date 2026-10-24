import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  CreateTaskSchema,
  DeclarePlanSchema,
  FetchUrlSchema,
  PayAndFetchSchema,
  type Decision,
  type PayResult,
  type Store,
  type Task,
} from "@countersign/shared";
import type { Executor } from "./executor";

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
}

/** D6: until the decision core exists, nothing is approved. */
export const M1_HOLD_REASON = "Decision core not built yet (milestone 1): every payment is held. Fail closed.";

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
      await requireTask(taskId);
      await requirePlan(taskId);
      requireAllowedHost(req.url);
      const started = performance.now();

      let quote;
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
        rawRequirements: quote.raw,
        receivedAt: store.now(),
      });

      const decision: Decision = {
        decisionId: randomUUID(),
        paymentRequestId: randomUUID(),
        taskId,
        tier: null,
        verdict: "hold",
        fieldOrigins: {},
        reasons: [M1_HOLD_REASON],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      };
      await store.putDecision(decision);
      return { status: "held", reason: M1_HOLD_REASON, decisionId: decision.decisionId };
    },
  };
}

export type Tools = ReturnType<typeof createTools>;
