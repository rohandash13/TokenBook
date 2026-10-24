import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyChain } from "@countersign/shared";
import type { PaymentRequest } from "@countersign/shared";
import { createTestTask, fakeJudge, postJson, startStack, weatherPlan, weatherReq, type Stack, type StackOptions } from "./helpers/stack";

let s: Stack | undefined;
afterEach(async () => { await s?.close(); s = undefined; });

async function setup(opts: StackOptions = {}) {
  s = await startStack(opts);
  const taskId = await createTestTask(s.gateway.url);
  expect((await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) })).status).toBe(200);
  return { st: s, taskId };
}

const pay = (st: Stack, taskId: string, req: PaymentRequest) => postJson(st.gateway.url, "/tools/pay_and_fetch", { taskId, req });
const getHold = (st: Stack, taskId: string, decisionId: string) => postJson(st.gateway.url, "/tools/get_hold", { taskId, decisionId });

describe("M3: every held verdict opens one routed hold (D27)", () => {
  it("a held purchase opens one open hold routed by config/approvers.json, with the exact request and its stored quote", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    const req = weatherReq(st);
    const r = await pay(st, taskId, req);
    expect(r.body.status).toBe("held");
    const holds = await st.store.listHolds();
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ decisionId: r.body.decisionId, taskId, routedTo: "Sam", status: "open", req });
    expect((await st.store.listQuotes(taskId)).map((q) => q.quoteId)).toContain(holds[0].quoteId);
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("routing is config: a weather route sends the same hold to Priya", async () => {
    const { st, taskId } = await setup({
      judge: fakeJudge("hold").judge,
      approvers: { routes: [{ when: { category: "weather", maxUsd: 1 }, approver: "Priya" }], default: "Sam" },
    });
    await pay(st, taskId, weatherReq(st));
    expect((await st.store.listHolds())[0].routedTo).toBe("Priya");
  });

  it("approve and block verdicts open no hold", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    expect((await pay(st, taskId, weatherReq(st))).body.status).toBe("approved");
    expect((await pay(st, taskId, weatherReq(st, { amountUsd: 1 }))).body.status).toBe("blocked");
    expect(await st.store.listHolds()).toEqual([]);
  });
});

describe("POST /tools/get_hold (D33)", () => {
  it("the owning task sees its open hold", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    const r = await pay(st, taskId, weatherReq(st));
    const own = await getHold(st, taskId, r.body.decisionId);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({
      holdId: (await st.store.listHolds())[0].holdId,
      decisionId: r.body.decisionId,
      status: "open",
      reason: "held for review by Sam",
    });
  });

  it("another task, an unknown decision, an unknown task or a decision with no hold -> 404 HOLD_NOT_FOUND", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    const held = await pay(st, taskId, weatherReq(st));
    const otherTask = await createTestTask(st.gateway.url);
    const blocked = await pay(st, taskId, weatherReq(st, { amountUsd: 1 }));
    expect(blocked.body.status).toBe("blocked");
    const cases: Array<[string, string]> = [
      [otherTask, held.body.decisionId],
      [taskId, "no-such-decision"],
      ["no-such-task", held.body.decisionId],
      [taskId, blocked.body.decisionId],
    ];
    for (const [t, d] of cases) {
      const x = await getHold(st, t, d);
      expect(x.status, `${t}/${d}`).toBe(404);
      expect(x.body.error.code).toBe("HOLD_NOT_FOUND");
    }
  });

  it("bad input -> 400", async () => {
    const { st, taskId } = await setup();
    const x = await postJson(st.gateway.url, "/tools/get_hold", { taskId });
    expect(x.status).toBe(400);
    expect(x.body.error.code).toBe("BAD_INPUT");
  });
});

describe("hold-path coverage", () => {
  it("a floor-driven hold (quantity above plan maxQuantity) opens exactly one hold even when the judge would approve", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    const r = await pay(st, taskId, weatherReq(st, {
      url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley&qty=3`, amountUsd: 0.3, quantity: 3,
    }));
    expect(r.body.status).toBe("held");
    expect(await st.store.listHolds()).toHaveLength(1);
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("no judge configured: Tier 2 cases hold, and open exactly one hold", async () => {
    const { st, taskId } = await setup();
    const r = await pay(st, taskId, weatherReq(st));
    expect(r.body.status).toBe("held");
    expect(await st.store.listHolds()).toHaveLength(1);
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("a block opens no hold and never pays", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    expect((await pay(st, taskId, weatherReq(st, { amountUsd: 1 }))).body.status).toBe("blocked");
    expect(await st.store.listHolds()).toEqual([]);
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("D32: decision latency starts after the vendor quote round-trip", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("approve").judge });
    const real = st.executor.getQuote.bind(st.executor);
    vi.spyOn(st.executor, "getQuote").mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, 400));
      return real(url);
    });
    const t0 = performance.now();
    expect((await pay(st, taskId, weatherReq(st))).body.status).toBe("approved");
    expect(performance.now() - t0).toBeGreaterThanOrEqual(400);
    const verdict = (await st.store.listDecisions()).find((d) => d.kind === "verdict")!;
    expect(verdict.latencyMs).toBeLessThan(150);
  });

  it("if opening the hold throws, the request fails closed: error response, nothing paid, log still verifies", async () => {
    const { st, taskId } = await setup({ judge: fakeJudge("hold").judge });
    vi.spyOn(st.store, "putHold").mockRejectedValue(new Error("store down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await pay(st, taskId, weatherReq(st));
    quiet.mockRestore();
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.body.status).toBeUndefined();
    expect(r.body.error).toBeDefined();
    expect(st.paySpy).not.toHaveBeenCalled();
    expect(verifyChain(await st.store.listDecisions())).toEqual({ ok: true });
  });
});
