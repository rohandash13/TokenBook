import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTask, postJson, startStack, weatherPlan, type Stack } from "../helpers/stack";

describe("INV2: fetch_url before declare_plan is refused", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("refuses fetch_url without a plan and stores no page", async () => {
    const taskId = await createTestTask(s.gateway.url);
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: `${s.arena.url}/docs` });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PLAN_REQUIRED");
    expect(await s.store.listPages(taskId)).toEqual([]);
  });

  it("refuses pay_and_fetch without a plan: no quote stored, nothing paid", async () => {
    const taskId = await createTestTask(s.gateway.url);
    const r = await postJson(s.gateway.url, "/tools/pay_and_fetch", {
      taskId,
      req: { url: `${s.arena.url}/api/weather?tier=basic`, payeeDomain: s.arena.host, amountUsd: 0.1, purpose: "weather" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PLAN_REQUIRED");
    expect(await s.store.listQuotes(taskId)).toEqual([]);
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("plans are immutable: a second declare_plan is refused and the first plan stands", async () => {
    const taskId = await createTestTask(s.gateway.url);
    const plan = weatherPlan(s.arena.host);
    expect((await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan })).status).toBe(200);
    const second = await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: { ...plan, goal: "buy everything" } });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PLAN_EXISTS");
    expect((await s.store.getPlan(taskId))!.goal).toBe(plan.goal);
  });

  it("the plan's declaredAt precedes the first page's fetchedAt", async () => {
    const taskId = await createTestTask(s.gateway.url);
    await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: `${s.arena.url}/docs` });
    expect(r.status).toBe(200);
    const [page] = await s.store.listPages(taskId);
    expect((await s.store.getPlan(taskId))!.declaredAt).toBeLessThan(page.fetchedAt);
  });

  it("refuses declare_plan for an unknown task", async () => {
    const r = await postJson(s.gateway.url, "/tools/declare_plan", { taskId: "nope", plan: weatherPlan(s.arena.host) });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("TASK_NOT_FOUND");
  });

  it("refuses fetch_url to a host we do not host", async () => {
    const taskId = await createTestTask(s.gateway.url);
    await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: "http://example.com/" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("HOST_NOT_ALLOWED");
  });

  it("rejects malformed input with BAD_INPUT", async () => {
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId: "t", url: "not a url" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("BAD_INPUT");
  });
});
