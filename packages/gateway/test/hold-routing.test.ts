import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@countersign/shared";
import { createGatewayApp, createTools, ToolError, type Executor, type Tools } from "@countersign/gateway";
import { listen } from "../../../tests/helpers/listen";
import { CATALOG, HOST, mkQuote } from "./fixtures";

// The amount-mismatch floor blocks (never holds) any claim that differs from the quote, so a hold whose claimed
// amount differs from the quote-charged one cannot arise via the real floors. Force a hold floor to prove the
// routing input itself is the quote-charged amount (defense in depth, D35).
vi.mock("../src/floors", async (orig) => {
  const real = await orig<typeof import("../src/floors")>();
  return { ...real, computeFloors: () => ({ verdict: "hold" as const, reasons: ["forced hold"], checks: [{ verdict: "hold" as const, reason: "forced hold" }] }) };
});

describe("D35: holds route on max(claimed, quote-charged) amount", () => {
  it("agent claims $0.10, quote charges $0.50 -> default approver, not the <= $0.20 route", async () => {
    const store = new MemoryStore();
    const executor: Executor = {
      kind: "simulated",
      getQuote: async () => mkQuote({ amountUsd: 0.5, amountAtomic: "500000" }),
      pay: vi.fn(),
    };
    const tools = createTools({
      store, executor, fetchHosts: [HOST], catalog: CATALOG, payeeAllowlist: [],
      approvers: { routes: [{ when: { maxUsd: 0.2 }, approver: "Narrow" }], default: "Sam" },
    });
    const task = await tools.createTask({ text: "Get the weather in Berkeley", budgetUsd: 5, taskType: "data-lookup" });
    await tools.declarePlan({
      taskId: task.taskId,
      plan: { goal: "weather", expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 2, vendorDomains: [HOST], tiers: ["basic"] }] },
    });
    const r = await tools.payAndFetch({
      taskId: task.taskId,
      req: { url: `http://${HOST}/api/weather?tier=basic`, payeeDomain: HOST, amountUsd: 0.1, tier: "basic", quantity: 1, purpose: "weather" },
    });
    expect(r.status).toBe("held");
    const holds = await store.listHolds();
    expect(holds).toHaveLength(1);
    expect(holds[0].routedTo).toBe("Sam");
    expect(executor.pay).not.toHaveBeenCalled();
  });
});

describe("server error envelope", () => {
  it("a ToolError with details returns them in the JSON body", async () => {
    const tools = { createTask: async () => { throw new ToolError("BAD_INPUT", "nope", { field: "x" }); } } as unknown as Tools;
    const l = await listen(createGatewayApp(tools));
    try {
      const res = await fetch(new URL("/admin/tasks", l.url), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "BAD_INPUT", message: "nope", details: { field: "x" } } });
    } finally {
      await l.close();
    }
  });
});
