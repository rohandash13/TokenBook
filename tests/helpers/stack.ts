import { vi, type MockInstance } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import { SimulatedExecutor, createGatewayApp, createTools, type LlmProxy } from "@countersign/gateway";
import { MemoryStore } from "@countersign/shared";
import { listen, type Listening } from "./listen";

export const TEST_SECRET = "test-sim-secret";

export interface Stack {
  arena: Listening;
  gateway: Listening;
  store: MemoryStore;
  executor: SimulatedExecutor;
  paySpy: MockInstance;
  close(): Promise<void>;
}

/** Arena + gateway on ephemeral ports, in-memory store, simulated executor with a spy on pay(). */
export async function startStack(opts: { llm?: LlmProxy } = {}): Promise<Stack> {
  const arena = await listen(createLegitVendor({ simPayerSecret: TEST_SECRET }));
  const store = new MemoryStore();
  const executor = new SimulatedExecutor(TEST_SECRET);
  const paySpy = vi.spyOn(executor, "pay");
  const tools = createTools({ store, executor, fetchHosts: [arena.host] });
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

export async function createTestTask(gatewayUrl: string): Promise<string> {
  const r = await postJson(gatewayUrl, "/admin/tasks", { text: "Get the weather in Berkeley", budgetUsd: 1, taskType: "data-lookup" });
  if (r.status !== 200) throw new Error(`createTestTask failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.taskId as string;
}
