import { vi, type MockInstance } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import type { ApproverConfig, AttackCase } from "@countersign/rules";
import {
  SimulatedExecutor,
  createGatewayApp,
  createTools,
  loadApproversFile,
  loadCatalogFile,
  type Judge,
  type JudgeInput,
  type LlmProxy,
} from "@countersign/gateway";
import { MemoryStore, type PaymentRequest, type Rule, type Verdict } from "@countersign/shared";
import { listen, type Listening } from "./listen";

export const TEST_SECRET = "test-sim-secret";
export const TEST_CATALOG = loadCatalogFile(new URL("../../config/catalog.json", import.meta.url));
export const TEST_APPROVERS = loadApproversFile(new URL("../../config/approvers.json", import.meta.url));

export interface Stack {
  arena: Listening;
  gateway: Listening;
  store: MemoryStore;
  executor: SimulatedExecutor;
  paySpy: MockInstance;
  close(): Promise<void>;
}

export interface StackOptions {
  llm?: LlmProxy;
  judge?: Judge;
  payeeAllowlist?: string[];
  approvers?: ApproverConfig; // default: config/approvers.json
  ruleTtlMs?: number;
  attackCorpus?: AttackCase[];
}

/** Arena + gateway on ephemeral ports, in-memory store, simulated executor with a spy on pay(). No judge unless given. */
export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const arena = await listen(createLegitVendor({ simPayerSecret: TEST_SECRET }));
  const store = new MemoryStore();
  const executor = new SimulatedExecutor(TEST_SECRET);
  const paySpy = vi.spyOn(executor, "pay");
  const tools = createTools({
    store,
    executor,
    fetchHosts: [arena.host],
    catalog: TEST_CATALOG,
    payeeAllowlist: opts.payeeAllowlist ?? [],
    judge: opts.judge,
    approvers: opts.approvers ?? TEST_APPROVERS,
    ...(opts.ruleTtlMs !== undefined ? { ruleTtlMs: opts.ruleTtlMs } : {}),
    ...(opts.attackCorpus !== undefined ? { attackCorpus: opts.attackCorpus } : {}),
  });
  const gateway = await listen(createGatewayApp(tools, opts.llm));
  return {
    arena, gateway, store, executor, paySpy,
    async close() { await gateway.close(); await arena.close(); },
  };
}

export async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export function weatherPlan(host: string) {
  return {
    goal: "current weather for Berkeley",
    expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 2, vendorDomains: [host], tiers: ["basic"] }],
  };
}

export async function createTestTask(
  gatewayUrl: string,
  opts: { text?: string; budgetUsd?: number; taskType?: string } = {},
): Promise<string> {
  const r = await postJson(gatewayUrl, "/admin/tasks", {
    text: opts.text ?? "Get the weather in Berkeley",
    budgetUsd: opts.budgetUsd ?? 1,
    taskType: opts.taskType ?? "data-lookup",
  });
  if (r.status !== 200) throw new Error(`createTestTask failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.taskId as string;
}

/** In-process judge for tests. Records every input it receives. */
export function fakeJudge(verdict: Verdict = "approve"): { judge: Judge; calls: JudgeInput[] } {
  const calls: JudgeInput[] = [];
  const judge: Judge = {
    async judge(input) {
      calls.push(structuredClone(input));
      return { verdict, reasons: [`fake judge says ${verdict}`], costUsd: null, tokens: null };
    },
  };
  return { judge, calls };
}

export function activeRule(payee: string, over: Partial<Rule> = {}): Rule {
  return {
    ruleId: "rule-test",
    payee,
    category: "weather",
    capUsd: 1,
    taskType: "data-lookup",
    expiresAt: Date.now() + 3_600_000,
    createdBy: "test",
    status: "active",
    ...over,
  };
}

export async function getJson(base: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(new URL(path, base));
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The legit 1 x $0.10 basic weather purchase that weatherPlan allows. */
export function weatherReq(st: Pick<Stack, "arena">, over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley`,
    payeeDomain: st.arena.host,
    amountUsd: 0.1,
    tier: "basic",
    quantity: 1,
    purpose: "weather for Berkeley",
    ...over,
  };
}
