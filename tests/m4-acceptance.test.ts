import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatedExecutor } from "@countersign/gateway";
import { verifyChain } from "@countersign/shared";
import { createTestTask, fakeJudge, getJson, postJson, startStack, weatherPlan, weatherReq, type Stack } from "./helpers/stack";
let s: Stack | undefined;
afterEach(async () => { await s?.close(); s = undefined; });
async function setup(budgetUsd = 1) {
  s = await startStack({ judge: fakeJudge("approve").judge });
  const taskId = await createTestTask(s.gateway.url, { budgetUsd });
  await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
  return { st: s, taskId };
}
const pay = (st: Stack, taskId: string, over = {}) => postJson(st.gateway.url, "/tools/pay_and_fetch", { taskId, req: weatherReq(st, over) });
describe("M4 acceptance over HTTP (simulated payments)", () => {
  it("five parallel distinct purchases cannot overspend 30 cents", async () => {
    const { st, taskId } = await setup(0.3);
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => pay(st, taskId, { url: `${st.arena.url}/api/weather?city=C${i}` })));
    expect(rs.filter(r => r.body.status === "approved")).toHaveLength(3);
    expect(rs.filter(r => r.body.status === "blocked")).toHaveLength(2);
    expect(st.paySpy).toHaveBeenCalledTimes(3);
    expect((await getJson(st.gateway.url, `/admin/budget/${taskId}`)).body).toMatchObject({ committedUsd: 0.3, reservedUsd: 0, remainingUsd: 0 });
  });
  it("duplicate report saves $5 even if purpose changes, with no second reservation or payment", async () => {
    const { st, taskId } = await setup(10);
    // A separate research task has a plan for the report endpoint.
    const t = await createTestTask(st.gateway.url, { text: "Get a research report", budgetUsd: 5 });
    await postJson(st.gateway.url, "/tools/declare_plan", { taskId: t, plan: { goal: "research", expected: [{ category: "research", maxUnitUsd: 5, maxQuantity: 1, tiers: ["basic"], vendorDomains: [st.arena.host] }] } });
    const req = { url: `${st.arena.url}/api/report?topic=agents`, amountUsd: 5 };
    expect((await pay(st, t, req)).body.status).toBe("approved");
    const r = await pay(st, t, { ...req, purpose: "reworded request" });
    expect(r.body).toMatchObject({ status: "approved", reused: true, savedUsd: 5 });
    expect(st.paySpy).toHaveBeenCalledTimes(1);
    expect(await st.store.listReservations(t)).toHaveLength(1);
    expect((await st.store.listDecisions()).at(-1)).toMatchObject({ kind: "duplicate_reused", costUsd: 0, savedUsd: 5 });
    expect(verifyChain(await st.store.listDecisions())).toEqual({ ok: true });
  });
  it("INV5: lost settlement response is confirmed, never paid again", async () => {
    const { st, taskId } = await setup();
    const original = SimulatedExecutor.prototype.pay.bind(st.executor);
    st.paySpy.mockImplementationOnce(async (...args: Parameters<typeof original>) => { await original(...args); throw new Error("response lost"); });
    const r = await pay(st, taskId);
    expect(r.body.status).toBe("approved");
    expect(r.body.reason).toContain("confirmed settled");
    expect(st.paySpy).toHaveBeenCalledTimes(1);
    const key = st.paySpy.mock.calls[0][2];
    expect((await getJson(st.arena.url, `/_debug/charges/${key}`)).body.chargeCount).toBe(1);
    expect((await pay(st, taskId, { purpose: "retry words" })).body.reused).toBe(true);
    expect(st.paySpy).toHaveBeenCalledTimes(1);
  });
  it("unknown outcome retains reservation and blocks every retry", async () => {
    const { st, taskId } = await setup(0.1);
    st.paySpy.mockRejectedValue(new Error("network lost"));
    vi.spyOn(st.executor, "confirm").mockResolvedValue({ status: "unknown" });
    expect((await pay(st, taskId)).body).toMatchObject({ status: "held", reason: expect.stringContaining("outcome unknown") });
    expect((await st.store.listReservations(taskId))[0].state).toBe("reserved");
    expect((await pay(st, taskId, { purpose: "retry" })).body.status).toBe("held");
    expect(st.paySpy).toHaveBeenCalledTimes(1);
  });
  it("definitively not-settled confirmation permits only one retry", async () => {
    const { st, taskId } = await setup();
    st.paySpy.mockRejectedValueOnce(new Error("failed before send"));
    const r = await pay(st, taskId);
    expect(r.body.status).toBe("approved");
    expect(st.paySpy).toHaveBeenCalledTimes(2);
    const key = st.paySpy.mock.calls[0][2];
    expect(st.paySpy.mock.calls[1][2]).toBe(key);
    expect((await getJson(st.arena.url, `/_debug/charges/${key}`)).body.chargeCount).toBe(1);
  });
  it("empty paid deliveries produce receipts and force a hold after two failures", async () => {
    const { st, taskId } = await setup();
    for (let i = 0; i < 2; i++) expect((await pay(st, taskId, { url: `${st.arena.url}/api/weather?mode=empty&city=C${i}` })).body.status).toBe("approved");
    expect((await st.store.listReceipts(taskId)).map(r => r.deliveryStatus)).toEqual(["empty", "empty"]);
    expect((await st.store.listPayees())[0].deliveryFailures).toBe(2);
    const r = await pay(st, taskId);
    expect(r.body.status).toBe("held"); expect(r.body.reason).toContain("failed delivery 2 times");
    expect(st.paySpy).toHaveBeenCalledTimes(2);
  });
});

it("human hold approvals race for the same remaining budget and unknown outcomes keep it reserved", async () => {
  s = await startStack({ judge: fakeJudge("hold").judge });
  const st = s;
  const taskId = await createTestTask(st.gateway.url, { budgetUsd: 0.1 });
  await postJson(st.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(st.arena.host) });
  for (const city of ["A", "B"]) expect((await pay(st, taskId, { url: `${st.arena.url}/api/weather?city=${city}` })).body.status).toBe("held");
  expect((await st.store.listReservations(taskId)).every(r => r.state === "released")).toBe(true);
  const holds = await st.store.listHolds();
  const rs = await Promise.all(holds.map(h => postJson(st.gateway.url, `/admin/holds/${h.holdId}/approve`, { approver: "Sam" })));
  expect(rs.map(r => r.status).sort()).toEqual([200, 409]);
  expect(st.paySpy).toHaveBeenCalledTimes(1);
  expect(rs.find(r => r.status === 409)!.body.error.code).toBe("BUDGET_EXCEEDED");
});
it("concurrent identical approvals execute once", async () => {
  const { st, taskId } = await setup();
  const rs = await Promise.all([pay(st, taskId), pay(st, taskId, { purpose: "different words" })]);
  expect(rs.every(r => ["approved", "held"].includes(r.body.status))).toBe(true);
  expect(st.paySpy).toHaveBeenCalledTimes(1);
  expect((await st.store.listReservations(taskId)).filter(r => r.state === "committed")).toHaveLength(1);
});
