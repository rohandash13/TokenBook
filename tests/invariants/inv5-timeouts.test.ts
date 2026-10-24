import { afterEach, expect, it, vi } from "vitest";
import { SimulatedExecutor } from "@countersign/gateway";
import { createTestTask, fakeJudge, getJson, postJson, startStack, weatherPlan, weatherReq, type Stack } from "../helpers/stack";
let s: Stack | undefined;
afterEach(async () => { await s?.close(); });
it("INV5: lost response after settlement plus reworded retry charges once", async () => {
  s = await startStack({ judge: fakeJudge("approve").judge });
  const taskId = await createTestTask(s.gateway.url);
  await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
  const original = SimulatedExecutor.prototype.pay.bind(s.executor);
  s.paySpy.mockImplementationOnce(async (...args: Parameters<typeof original>) => { await original(...args); throw new Error("lost settlement response"); });
  const req = weatherReq(s);
  const r = await postJson(s.gateway.url, "/tools/pay_and_fetch", { taskId, req });
  expect(r.body.status).toBe("approved");
  expect((await postJson(s.gateway.url, "/tools/pay_and_fetch", { taskId, req: { ...req, purpose: "try again" } })).body.reused).toBe(true);
  expect(s.paySpy).toHaveBeenCalledTimes(1);
  const key = s.paySpy.mock.calls[0][2];
  expect((await getJson(s.arena.url, `/_debug/charges/${key}`)).body.chargeCount).toBe(1);
});
