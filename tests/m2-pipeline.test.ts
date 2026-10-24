import { afterEach, describe, expect, it } from "vitest";
import { idempotencyKey } from "@countersign/gateway";
import { verifyChain } from "@countersign/shared";
import {
  activeRule,
  createTestTask,
  fakeJudge,
  postJson,
  startStack,
  weatherPlan,
  type Stack,
  type StackOptions,
} from "./helpers/stack";

let s: Stack | undefined;
afterEach(async () => { await s?.close(); s = undefined; });

async function setup(opts: StackOptions = {}, task: { budgetUsd?: number } = {}) {
  s = await startStack(opts);
  const taskId = await createTestTask(s.gateway.url, task);
  const plan = await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
  expect(plan.status).toBe(200);
  return { st: s, taskId };
}

const basicReq = (st: Stack, over: Record<string, unknown> = {}) => ({
  url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley`,
  payeeDomain: st.arena.host,
  amountUsd: 0.1,
  tier: "basic",
  quantity: 1,
  purpose: "weather for Berkeley",
  ...over,
});

const pay = (st: Stack, taskId: string, req: unknown) => postJson(st.gateway.url, "/tools/pay_and_fetch", { taskId, req });

describe("M2 pipeline: pay_and_fetch runs the decision core", () => {
  it("clean purchase + approving judge: approved, data returned, paid once with the deterministic idempotency key", async () => {
    const fj = fakeJudge("approve");
    const { st, taskId } = await setup({ judge: fj.judge });
    const req = basicReq(st);
    const r = await pay(st, taskId, req);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic", city: "Berkeley" } });
    expect(fj.calls).toHaveLength(1);
    expect(st.paySpy).toHaveBeenCalledTimes(1);
    expect(st.paySpy.mock.calls[0][2]).toBe(idempotencyKey(taskId, st.arena.host, req));
    expect(await st.store.getDecision(r.body.decisionId)).toMatchObject({
      kind: "verdict", tier: 2, verdict: "approve", amountUsd: 0.1, payeeDomain: st.arena.host, category: "weather",
      judge: { verdict: "approve" },
    });
  });

  it("an active matching rule approves at Tier 1 without calling the judge", async () => {
    const fj = fakeJudge("block");
    const { st, taskId } = await setup({ judge: fj.judge });
    await st.store.putRule(activeRule(st.arena.host));
    const r = await pay(st, taskId, basicReq(st));
    expect(r.body.status).toBe("approved");
    expect(fj.calls).toHaveLength(0);
    expect(await st.store.getDecision(r.body.decisionId)).toMatchObject({ tier: 1, ruleId: "rule-test", costUsd: 0 });
  });

  it("no judge configured: a clean purchase is held and nothing is paid", async () => {
    const { st, taskId } = await setup();
    const r = await pay(st, taskId, basicReq(st));
    expect(r.body.status).toBe("held");
    expect(r.body.reason).toContain("no judge configured");
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("a block floor skips the judge and is logged", async () => {
    const fj = fakeJudge("approve");
    const { st, taskId } = await setup({ judge: fj.judge });
    const r = await pay(st, taskId, basicReq(st, { amountUsd: 1 }));
    expect(r.body.status).toBe("blocked");
    expect(fj.calls).toHaveLength(0);
    expect(await st.store.getDecision(r.body.decisionId)).toMatchObject({ tier: null, verdict: "block" });
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("an executor failure after approve returns blocked and appends a follow-up decision (D23)", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    st.paySpy.mockResolvedValueOnce({ status: "failed", httpStatus: 402, txRef: null, simulated: true });
    const r = await pay(st, taskId, basicReq(st));
    expect(r.body).toMatchObject({ status: "blocked", reason: "executor failed: http 402" });
    const log = await st.store.listDecisions();
    expect(log.map((d) => [d.kind, d.verdict])).toEqual([["verdict", "approve"], ["executor_failure", "block"]]);
    expect(log[0].paymentRequestId).toBe(log[1].paymentRequestId);
    expect(r.body.decisionId).toBe(log[1].decisionId);
  });

  it("spent budget counts: 2 x $0.10 approved, then $0.10 more on a $0.25 budget is blocked", async () => {
    const fj = fakeJudge("approve");
    const { st, taskId } = await setup({ judge: fj.judge }, { budgetUsd: 0.25 });
    const first = await pay(st, taskId, basicReq(st, {
      url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley&qty=2`, amountUsd: 0.2, quantity: 2,
    }));
    expect(first.body.status).toBe("approved");
    expect((await st.store.listQuotes(taskId))[0].quantity).toBe(2);
    const second = await pay(st, taskId, basicReq(st));
    expect(second.body.status).toBe("blocked");
    expect(second.body.reason).toContain("exceeds task budget remaining $0.05");
    expect(fj.calls).toHaveLength(1);
  });

  it("approve, hold and block are all logged and the hash chain verifies", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    await pay(st, taskId, basicReq(st));
    await pay(st, taskId, basicReq(st, { url: `${st.arena.url}/api/crypto?symbol=BTC` }));
    await pay(st, taskId, basicReq(st, { amountUsd: 0.5 }));
    const log = await st.store.listDecisions();
    expect(log.map((d) => d.verdict)).toEqual(["approve", "hold", "block"]);
    expect(verifyChain(log)).toEqual({ ok: true });
  });
});
