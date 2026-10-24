import { afterEach, describe, expect, it } from "vitest";
import { createGatewayClient } from "@countersign/worker";
import { createTestTask, fakeJudge, getJson, postJson, startStack, weatherPlan, weatherReq, type Stack } from "./helpers/stack";

type PayBody = { status: string; reason: string; decisionId: string; data?: unknown };

/** Spec §13 row 3. The fake judge always says hold, so every approval below comes from a human or a rule. */
describe("M3 acceptance: hold queue, rule chips, replay, activation", () => {
  let s: Stack | undefined;
  afterEach(async () => { await s?.close(); s = undefined; });

  async function newTask(st: Stack, budgetUsd = 1) {
    const taskId = await createTestTask(st.gateway.url, { budgetUsd });
    const client = createGatewayClient(st.gateway.url);
    expect((await client.declarePlan(taskId, weatherPlan(st.arena.host))).ok).toBe(true);
    return { taskId, client };
  }

  it("held -> routed -> approved and paid -> narrow rule proposed with replay -> activated -> next similar purchase is Tier 1 in ms at $0", async () => {
    const fj = fakeJudge("hold");
    s = await startStack({ judge: fj.judge });
    const st = s;

    // 1. A legit purchase from a vendor in the plan; the judge holds it; the queue shows it routed per config.
    const a = await newTask(st);
    expect((await a.client.fetchUrl(a.taskId, `${st.arena.url}/docs`)).ok).toBe(true);
    const req = weatherReq(st);
    const held = (await a.client.payAndFetch(a.taskId, req)).body as PayBody;
    expect(held.status).toBe("held");
    expect(fj.calls).toHaveLength(1);
    const queue = await getJson(st.gateway.url, "/admin/holds?status=open");
    expect(queue.body.holds).toHaveLength(1);
    const item = queue.body.holds[0];
    expect(item.hold.routedTo).toBe("Sam"); // config/approvers.json: only small coding purchases go to Priya
    expect(item.decision.decisionId).toBe(held.decisionId);
    expect(item.task).toMatchObject({ taskId: a.taskId, taskType: "data-lookup" });
    expect(st.paySpy).not.toHaveBeenCalled();

    // 2. Approve: the payment executes (simulated), the worker sees it, a narrow rule is proposed with a replay report.
    const approved = await postJson(st.gateway.url, `/admin/holds/${item.hold.holdId}/approve`, { approver: "Sam" });
    expect(approved.status).toBe(200);
    expect(st.paySpy).toHaveBeenCalledTimes(1);
    const seen = await a.client.getHold(a.taskId, held.decisionId);
    expect(seen.body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic", city: "Berkeley" } });
    const rule = approved.body.proposedRule;
    expect(rule).toMatchObject({ status: "proposed", payee: st.arena.host, category: "weather", capUsd: 0.1, taskType: "data-lookup" });
    expect(approved.body.replay.casesChecked).toBeGreaterThan(0);
    expect(approved.body.replay.attacksMatched).toEqual([]);
    expect(approved.body.replay.knownBadMatched).toEqual([]);
    expect(approved.body.replay.summary).toBe(`${approved.body.replay.casesChecked} cases, 0 attacks matched, 0 known-bad matched`);

    // 7. A narrowing that widens is refused; the rule stays proposed.
    const widen = await postJson(st.gateway.url, `/admin/rules/${rule.ruleId}/activate`, { approver: "Sam", narrow: { capUsd: 1 } });
    expect(widen.status).toBe(400);
    expect(widen.body.error.code).toBe("BAD_INPUT");
    expect((await getJson(st.gateway.url, "/admin/rules?status=proposed")).body.rules).toHaveLength(1);

    // 3. Activate, narrowed to one hour.
    const expiresAt = Date.now() + 3_600_000;
    const act = await postJson(st.gateway.url, `/admin/rules/${rule.ruleId}/activate`, { approver: "Sam", narrow: { expiresAt } });
    expect(act.status).toBe(200);
    expect(act.body.rule).toMatchObject({ ruleId: rule.ruleId, status: "active", capUsd: 0.1, expiresAt });
    expect(act.body.replay.attacksMatched).toEqual([]);

    // 4. A new task of the same type makes the same purchase: Tier 1, $0, milliseconds, judge not called.
    const c = await newTask(st);
    const next = (await c.client.payAndFetch(c.taskId, req)).body as PayBody;
    expect(next.status).toBe("approved");
    expect(next.data).toMatchObject({ simulated: true, tier: "basic" });
    const d = (await st.store.getDecision(next.decisionId))!;
    expect(d).toMatchObject({ kind: "verdict", verdict: "approve", tier: 1, ruleId: rule.ruleId, costUsd: 0 });
    expect(d.latencyMs).toBeLessThan(50);
    expect(fj.calls).toHaveLength(1);
    expect(st.paySpy).toHaveBeenCalledTimes(2);
  });

  it("approving a premium upsell pays once but proposes no rule: tainted fields teach nothing", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const u = await newTask(s, 20);
    expect((await u.client.fetchUrl(u.taskId, `${s.arena.url}/docs/upsell`)).ok).toBe(true);
    const held = (await u.client.payAndFetch(
      u.taskId,
      weatherReq(s, { url: `${s.arena.url}/api/weather?tier=premium&city=Berkeley`, amountUsd: 15, tier: "premium" }),
    )).body as PayBody;
    expect(held.status).toBe("held");
    const hold = (await s.store.getHoldByDecision(held.decisionId))!;
    const r = await postJson(s.gateway.url, `/admin/holds/${hold.holdId}/approve`, { approver: "Sam" });
    expect(r.status).toBe(200);
    expect(r.body.payment).toMatchObject({ status: "settled", data: { simulated: true, tier: "premium" } });
    expect(s.paySpy).toHaveBeenCalledTimes(1);
    expect(r.body.proposedRule).toBeNull();
    expect(r.body.replay).toBeNull();
    expect(r.body.proposalNote).toBe("tainted fields: amount, tier; one-off approval only");
    expect(await s.store.listRules()).toEqual([]);
    expect((await u.client.getHold(u.taskId, held.decisionId)).body).toMatchObject({ status: "approved", data: { tier: "premium" } });
  });

  it("activation is refused when replay finds a rejected purchase the rule would auto-approve (409 REPLAY_FAILED)", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const a = await newTask(s);
    const heldA = (await a.client.payAndFetch(a.taskId, weatherReq(s))).body as PayBody;
    const holdA = (await s.store.getHoldByDecision(heldA.decisionId))!;
    const rule = (await postJson(s.gateway.url, `/admin/holds/${holdA.holdId}/approve`, { approver: "Sam" })).body.proposedRule;
    expect(rule.status).toBe("proposed");

    const b = await newTask(s);
    const heldB = (await b.client.payAndFetch(b.taskId, weatherReq(s))).body as PayBody;
    expect(heldB.status).toBe("held"); // the rule is only proposed, so Tier 1 does not apply yet
    const holdB = (await s.store.getHoldByDecision(heldB.decisionId))!;
    expect((await postJson(s.gateway.url, `/admin/holds/${holdB.holdId}/reject`, { approver: "Sam" })).status).toBe(200);
    expect((await b.client.getHold(b.taskId, heldB.decisionId)).body).toMatchObject({ status: "rejected" });

    const act = await postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/activate`, { approver: "Sam" });
    expect(act.status).toBe(409);
    expect(act.body.error.code).toBe("REPLAY_FAILED");
    expect(act.body.error.details.replay.knownBadMatched).toEqual([
      { decisionId: heldB.decisionId, why: `hold ${holdB.holdId} was rejected by Sam` },
    ]);
    expect(act.body.error.details.replay.attacksMatched).toEqual([]);
    const stored = (await s.store.listRules())[0];
    expect(stored.status).toBe("proposed");
    expect(stored.replayResult!.knownBadMatched).toHaveLength(1);
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });
});
