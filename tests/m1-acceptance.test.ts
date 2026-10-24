import { afterEach, describe, expect, it } from "vitest";
import { NO_JUDGE_REASON } from "@countersign/gateway";
import { createGatewayClient } from "@countersign/worker";
import { createTestTask, fakeJudge, startStack, weatherPlan, type Stack } from "./helpers/stack";

describe("M1 acceptance (updated for M2): the worker can only read and pay through the gateway", () => {
  let s: Stack | undefined;
  afterEach(async () => { await s?.close(); s = undefined; });

  async function declareReadPay(stack: Stack) {
    const client = createGatewayClient(stack.gateway.url);
    const taskId = await createTestTask(stack.gateway.url);
    expect((await client.declarePlan(taskId, weatherPlan(stack.arena.host))).ok).toBe(true);

    const fetched = await client.fetchUrl(taskId, `${stack.arena.url}/docs`);
    expect(fetched.ok).toBe(true);
    expect((fetched.body as { text: string }).text).toContain("Basic tier");
    const [page] = await stack.store.listPages(taskId);
    expect(page.lines[1]).toContain("$0.10");

    const pay = await client.payAndFetch(taskId, {
      url: `${stack.arena.url}/api/weather?tier=basic&city=Berkeley`,
      payeeDomain: stack.arena.host,
      amountUsd: 0.1,
      tier: "basic",
      quantity: 1,
      purpose: "weather for Berkeley",
    });
    const quotes = await stack.store.listQuotes(taskId);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ payeeDomain: stack.arena.host, amountUsd: 0.1, tier: "basic", quantity: 1 });
    return { taskId, pay };
  }

  it("declare → fetch docs → pay_and_fetch: a clean basic purchase is approved and paid once (simulated)", async () => {
    s = await startStack({ judge: fakeJudge("approve").judge });
    const { taskId, pay } = await declareReadPay(s);
    expect(pay.body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic", city: "Berkeley" } });
    const decision = await s.store.getDecision((pay.body as { decisionId: string }).decisionId);
    expect(decision).toMatchObject({ verdict: "approve", taskId });
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });

  it("with no judge configured the same purchase is HELD and nothing is paid (fail closed)", async () => {
    s = await startStack();
    const { taskId, pay } = await declareReadPay(s);
    expect(pay.body).toMatchObject({ status: "held" });
    expect((pay.body as { reason: string }).reason).toContain(NO_JUDGE_REASON);
    const decision = await s.store.getDecision((pay.body as { decisionId: string }).decisionId);
    expect(decision).toMatchObject({ verdict: "hold", taskId });
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("the gateway's simulated executor can complete a payment, labelled simulated", async () => {
    s = await startStack();
    const url = `${s.arena.url}/api/weather?tier=basic&city=Berkeley`;
    const out = await s.executor.pay(url, await s.executor.getQuote(url), "m1-acceptance-idem");
    expect(out).toMatchObject({ status: "settled", httpStatus: 200, simulated: true });
  });

  it("the gateway refuses /llm/messages when it has no key configured", async () => {
    s = await startStack();
    const res = await fetch(`${s.gateway.url}/llm/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(503);
  });
});
