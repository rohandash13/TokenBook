import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { M1_HOLD_REASON } from "@countersign/gateway";
import { createGatewayClient } from "@countersign/worker";
import { createTestTask, startStack, weatherPlan, type Stack } from "./helpers/stack";

describe("M1 acceptance: the worker can only read and pay through the gateway", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("declare → fetch docs → pay_and_fetch is HELD, quote and decision stored, nothing paid", async () => {
    const client = createGatewayClient(s.gateway.url);
    const taskId = await createTestTask(s.gateway.url);

    expect((await client.declarePlan(taskId, weatherPlan(s.arena.host))).ok).toBe(true);

    const fetched = await client.fetchUrl(taskId, `${s.arena.url}/docs`);
    expect(fetched.ok).toBe(true);
    expect((fetched.body as { text: string }).text).toContain("Basic tier");
    const [page] = await s.store.listPages(taskId);
    expect(page.lines[1]).toContain("$0.10");

    const pay = await client.payAndFetch(taskId, {
      url: `${s.arena.url}/api/weather?tier=basic&city=Berkeley`,
      payeeDomain: s.arena.host,
      amountUsd: 0.1,
      tier: "basic",
      quantity: 1,
      purpose: "weather for Berkeley",
    });
    expect(pay.body).toMatchObject({ status: "held", reason: M1_HOLD_REASON });

    const quotes = await s.store.listQuotes(taskId);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ payeeDomain: s.arena.host, amountUsd: 0.1, tier: "basic" });

    const decision = await s.store.getDecision((pay.body as { decisionId: string }).decisionId);
    expect(decision).toMatchObject({ verdict: "hold", taskId });
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("the gateway's simulated executor can complete a payment (path ready for M2), labelled simulated", async () => {
    const url = `${s.arena.url}/api/weather?tier=basic&city=Berkeley`;
    const out = await s.executor.pay(url, await s.executor.getQuote(url), "m1-acceptance-idem");
    expect(out).toMatchObject({ status: "settled", httpStatus: 200, simulated: true });
  });

  it("the gateway refuses /llm/messages when it has no key configured", async () => {
    const res = await fetch(`${s.gateway.url}/llm/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(503);
  });
});
