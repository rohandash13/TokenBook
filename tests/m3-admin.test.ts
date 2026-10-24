import { afterEach, describe, expect, it } from "vitest";
import { budgetRemainingUsd, idempotencyKey, type Judge } from "@countersign/gateway";
import { ATTACK_CORPUS, RULE_CAP, SAME_AS_RULE, type AttackCase } from "@countersign/rules";
import { hashDecision, verifyChain, type PaymentRequest, type Verdict } from "@countersign/shared";
import {
  createTestTask,
  fakeJudge,
  getJson,
  postJson,
  startStack,
  weatherPlan,
  weatherReq,
  type Stack,
} from "./helpers/stack";

let s: Stack | undefined;
afterEach(async () => { await s?.close(); s = undefined; });

/** Returns the given verdicts in order, then repeats the last one. */
function scriptedJudge(...verdicts: Verdict[]): Judge {
  let i = 0;
  return {
    async judge() {
      const verdict = verdicts[Math.min(i++, verdicts.length - 1)];
      return { verdict, reasons: [`scripted ${verdict}`], costUsd: null, tokens: null };
    },
  };
}

async function declared(st: Stack, budgetUsd = 1): Promise<string> {
  const taskId = await createTestTask(st.gateway.url, { budgetUsd });
  expect((await postJson(st.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(st.arena.host) })).status).toBe(200);
  return taskId;
}

async function heldIn(st: Stack, taskId: string, req: PaymentRequest) {
  const r = await postJson(st.gateway.url, "/tools/pay_and_fetch", { taskId, req });
  expect(r.body.status).toBe("held");
  const hold = (await st.store.getHoldByDecision(r.body.decisionId))!;
  return { taskId, req, decisionId: r.body.decisionId as string, holdId: hold.holdId };
}

async function heldPurchase(st: Stack, over: Partial<PaymentRequest> = {}) {
  return heldIn(st, await declared(st), weatherReq(st, over));
}

const approve = (st: Stack, holdId: string, body: unknown = { approver: "Sam" }) =>
  postJson(st.gateway.url, `/admin/holds/${holdId}/approve`, body);
const reject = (st: Stack, holdId: string, body: unknown = { approver: "Sam" }) =>
  postJson(st.gateway.url, `/admin/holds/${holdId}/reject`, body);
const activate = (st: Stack, ruleId: string, body: unknown = { approver: "Sam" }) =>
  postJson(st.gateway.url, `/admin/rules/${ruleId}/activate`, body);
const getHold = (st: Stack, taskId: string, decisionId: string) =>
  postJson(st.gateway.url, "/tools/get_hold", { taskId, decisionId });

describe("GET /admin/holds", () => {
  it("lists holds with the decision trace, its tier label and the task", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const r = await getJson(s.gateway.url, "/admin/holds?status=open");
    expect(r.status).toBe(200);
    expect(r.body.holds).toHaveLength(1);
    const item = r.body.holds[0];
    expect(item.hold).toMatchObject({ holdId: h.holdId, status: "open", routedTo: "Sam" });
    expect(item.tierLabel).toBe("Tier 2");
    expect(item.decision.tierLabel).toBeUndefined();
    const { hash, prevHash, ...body } = item.decision;
    expect(hashDecision(prevHash, body)).toBe(hash);
    expect(item.decision).toMatchObject({
      decisionId: h.decisionId,
      amountUsd: 0.1,
      payeeDomain: s.arena.host,
      category: "weather",
      fieldOrigins: { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" },
      evidence: {},
    });
    expect(item.decision.reasons).toContain("judge: fake judge says hold");
    expect(item.task).toEqual({ taskId: h.taskId, text: "Get the weather in Berkeley", taskType: "data-lookup" });
    expect((await getJson(s.gateway.url, "/admin/holds?status=approved")).body.holds).toEqual([]);
    expect((await getJson(s.gateway.url, "/admin/holds")).body.holds).toHaveLength(1);
    expect((await getJson(s.gateway.url, "/admin/holds?status=bogus")).status).toBe(400);
  });
});

describe("POST /admin/holds/:holdId/approve", () => {
  it("pays the held request once with its original idempotency key, logs a linked human approval and proposes a narrow rule", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const before = Date.now();
    const r = await approve(s, h.holdId);
    expect(r.status).toBe(200);

    expect(s.paySpy).toHaveBeenCalledTimes(1);
    expect(s.paySpy.mock.calls[0][0]).toBe(h.req.url);
    expect(s.paySpy.mock.calls[0][2]).toBe(idempotencyKey(h.taskId, s.arena.host, h.req));
    expect(r.body.payment).toMatchObject({ status: "settled", reason: "approved by Sam; paid (simulated)", data: { simulated: true, tier: "basic" } });

    const original = (await s.store.getDecision(h.decisionId))!;
    expect(await s.store.getDecision(r.body.decisionId)).toMatchObject({
      kind: "human_approval", verdict: "approve", tier: null, linkedDecisionId: h.decisionId,
      paymentRequestId: original.paymentRequestId, reasons: ["approved by Sam"], costUsd: 0,
    });

    const rule = r.body.proposedRule;
    expect(rule).toMatchObject({
      payee: s.arena.host, category: "weather", capUsd: 0.1, taskType: "data-lookup",
      createdBy: "Sam", status: "proposed", sourceHoldId: h.holdId,
    });
    expect(rule.expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 3600 * 1000);
    expect(r.body.proposalNote).toMatch(/^narrow rule: /);
    expect(r.body.replay).toMatchObject({
      decisionsChecked: 1, attacksChecked: ATTACK_CORPUS.length, casesChecked: 1 + ATTACK_CORPUS.length,
      wouldAutoApprove: 1, newlyAutoApproved: 1, knownBadMatched: [], attacksMatched: [],
    });
    expect(rule.replayResult).toEqual(r.body.replay);
    expect(r.body.hold).toMatchObject({ status: "approved", resolvedBy: "Sam", resolutionDecisionId: r.body.decisionId, proposedRuleId: rule.ruleId });
    expect((await s.store.listRules()).map((x) => [x.ruleId, x.status])).toEqual([[rule.ruleId, "proposed"]]);

    expect((await getHold(s, h.taskId, h.decisionId)).body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic" } });
    expect(verifyChain(await s.store.listDecisions())).toEqual({ ok: true });
  });

  it("approving twice is 409 HOLD_NOT_OPEN and pays once", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    expect((await approve(s, h.holdId)).status).toBe(200);
    const again = await approve(s, h.holdId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("HOLD_NOT_OPEN");
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });

  it("a human approval spends budget: the next hold on an exhausted budget is 409 BUDGET_EXCEEDED and stays open", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const taskId = await declared(s, 0.25);
    const a = await heldIn(s, taskId, weatherReq(s, { url: `${s.arena.url}/api/weather?tier=basic&city=Berkeley&qty=2`, amountUsd: 0.2, quantity: 2 }));
    const b = await heldIn(s, taskId, weatherReq(s));
    expect((await approve(s, a.holdId)).status).toBe(200);
    const r = await approve(s, b.holdId);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("BUDGET_EXCEEDED");
    expect(r.body.error.message).toContain("exceeds task budget remaining $0.05");
    expect((await s.store.getHold(b.holdId))!.status).toBe("open");
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });

  it("a failed payment: hold approved, get_hold reports the failure without data, budget not spent, rule still proposed", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    s.paySpy.mockResolvedValueOnce({ status: "failed", httpStatus: 402, txRef: null, simulated: true });
    const r = await approve(s, h.holdId);
    expect(r.status).toBe(200);
    expect(r.body.payment).toMatchObject({ status: "failed", reason: "payment failed: executor failed: http 402" });
    const seen = await getHold(s, h.taskId, h.decisionId);
    expect(seen.body).toEqual({ holdId: h.holdId, decisionId: h.decisionId, status: "approved", reason: "payment failed: executor failed: http 402" });
    const log = await s.store.listDecisions();
    expect(log.map((d) => d.kind)).toEqual(["verdict", "human_approval", "executor_failure"]);
    expect(log[2]).toMatchObject({ verdict: "block", paymentRequestId: log[0].paymentRequestId, linkedDecisionId: log[1].decisionId });
    expect(budgetRemainingUsd((await s.store.getTask(h.taskId))!, log)).toBe(1);
    expect(r.body.proposedRule).not.toBeNull();
    expect(verifyChain(log)).toEqual({ ok: true });
  });

  it("concurrent approve+approve: one 200, one 409 HOLD_NOT_OPEN, one payment, one human decision", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const rs = await Promise.all([approve(s, h.holdId), approve(s, h.holdId, { approver: "Priya" })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error.code).toBe("HOLD_NOT_OPEN");
    expect(s.paySpy.mock.calls.length).toBeLessThanOrEqual(1);
    const log = await s.store.listDecisions();
    expect(log.filter((d) => d.kind === "human_approval" || d.kind === "human_rejection")).toHaveLength(1);
    expect(verifyChain(log)).toEqual({ ok: true });
  });

  it("concurrent approve+reject: one 200, one 409 HOLD_NOT_OPEN, at most one payment, one human decision", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const rs = await Promise.all([approve(s, h.holdId), reject(s, h.holdId)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error.code).toBe("HOLD_NOT_OPEN");
    expect(s.paySpy.mock.calls.length).toBeLessThanOrEqual(1);
    const log = await s.store.listDecisions();
    expect(log.filter((d) => d.kind === "human_approval" || d.kind === "human_rejection")).toHaveLength(1);
    expect((await s.store.getHold(h.holdId))!.status).toBe(rs[0].status === 200 ? "approved" : "rejected");
    expect(verifyChain(log)).toEqual({ ok: true });
  });

  it("ignores url/amount/quote fields in the approve body: pays the hold's stored url and the stored quote", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const r = await approve(s, h.holdId, { approver: "Sam", url: "http://evil.test/x", amountUsd: 100, quoteId: "x" });
    expect(r.status).toBe(200);
    expect(s.paySpy).toHaveBeenCalledTimes(1);
    expect(s.paySpy.mock.calls[0][0]).toBe(h.req.url);
    expect(s.paySpy.mock.calls[0][1].amountUsd).toBe(0.1);
  });

  it("a rule-proposal failure after a settled payment never loses the payment: 200, proposedRule null, note, hold carries the payment", async () => {
    // A TTL above the 365-day cap makes proposeRule throw after executor.pay settled.
    s = await startStack({ judge: fakeJudge("hold").judge, ruleTtlMs: 400 * 24 * 3600 * 1000 });
    const h = await heldPurchase(s);
    const r = await approve(s, h.holdId);
    expect(r.status).toBe(200);
    expect(r.body.payment.status).toBe("settled");
    expect(r.body.proposedRule).toBeNull();
    expect(r.body.proposalNote).toMatch(/proposal failed/i);
    const stored = (await s.store.getHold(h.holdId))!;
    expect(stored).toMatchObject({ status: "approved", resolutionDecisionId: r.body.decisionId });
    expect(stored.payment).toMatchObject({ status: "settled" });
    expect((await getHold(s, h.taskId, h.decisionId)).body).toMatchObject({ status: "approved", data: { simulated: true, tier: "basic" } });
    expect(await s.store.listRules()).toEqual([]);
  });

  it("unknown hold -> 404; missing or empty approver -> 400", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    expect((await approve(s, "no-such-hold")).body.error.code).toBe("HOLD_NOT_FOUND");
    expect((await approve(s, h.holdId, {})).status).toBe(400);
    expect((await approve(s, h.holdId, { approver: "  " })).status).toBe(400);
    expect(s.paySpy).not.toHaveBeenCalled();
  });
});

describe("POST /admin/holds/:holdId/reject", () => {
  it("closes the hold, logs a human rejection, proposes nothing; the hold cannot be approved later", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const h = await heldPurchase(s);
    const r = await reject(s, h.holdId);
    expect(r.status).toBe(200);
    expect(r.body.hold).toMatchObject({ status: "rejected", resolvedBy: "Sam", resolutionDecisionId: r.body.decisionId });
    expect(await s.store.getDecision(r.body.decisionId)).toMatchObject({
      kind: "human_rejection", verdict: "block", tier: null, linkedDecisionId: h.decisionId, reasons: ["rejected by Sam"],
    });
    expect((await getHold(s, h.taskId, h.decisionId)).body).toMatchObject({ status: "rejected", reason: "rejected by Sam" });
    expect(await s.store.listRules()).toEqual([]);
    expect((await approve(s, h.holdId)).body.error.code).toBe("HOLD_NOT_OPEN");
    expect((await reject(s, h.holdId)).status).toBe(409);
    expect(s.paySpy).not.toHaveBeenCalled();
    expect(verifyChain(await s.store.listDecisions())).toEqual({ ok: true });
  });
});

describe("rules: list, activate (with narrowing and replay), reject", () => {
  async function proposed(st: Stack) {
    const h = await heldPurchase(st);
    const r = await approve(st, h.holdId);
    return r.body.proposedRule as { ruleId: string; expiresAt: number };
  }

  it("lists by status, activates a proposed rule, rejects (deactivates) it", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const rule = await proposed(s);
    expect((await getJson(s.gateway.url, "/admin/rules?status=proposed")).body.rules).toHaveLength(1);
    const act = await activate(s, rule.ruleId);
    expect(act.status).toBe(200);
    expect(act.body.rule).toMatchObject({ ruleId: rule.ruleId, status: "active", resolvedBy: "Sam" });
    expect(act.body.replay).toMatchObject({ attacksMatched: [], knownBadMatched: [] });
    expect(act.body.rule.replayResult).toEqual(act.body.replay);
    expect((await getJson(s.gateway.url, "/admin/rules?status=active")).body.rules).toHaveLength(1);
    expect((await activate(s, rule.ruleId)).body.error.code).toBe("RULE_STATE");
    const rej = await postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/reject`, { approver: "Priya" });
    expect(rej.body.rule).toMatchObject({ status: "rejected", resolvedBy: "Priya" });
    expect((await getJson(s.gateway.url, "/admin/rules?status=active")).body.rules).toEqual([]);
    expect((await postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/reject`, { approver: "Priya" })).body.error.code).toBe("RULE_STATE");
    expect((await activate(s, "no-such-rule")).body.error.code).toBe("RULE_NOT_FOUND");
    expect((await getJson(s.gateway.url, "/admin/rules?status=bogus")).status).toBe(400);
  });

  it("narrowing only tightens: widening, other keys and past expiry are 400 and leave the rule proposed", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const rule = await proposed(s);
    const bad = [
      { capUsd: 1 },
      { capUsd: 0 },
      { payee: "evil.test" },
      { expiresAt: Date.now() - 1 },
      { expiresAt: rule.expiresAt + 1 },
    ];
    for (const narrow of bad) {
      const r = await activate(s, rule.ruleId, { approver: "Sam", narrow });
      expect(r.status, JSON.stringify(narrow)).toBe(400);
      expect(r.body.error.code).toBe("BAD_INPUT");
    }
    expect((await s.store.listRules())[0]).toMatchObject({ status: "proposed", capUsd: 0.1 });
    const expiresAt = Date.now() + 3_600_000;
    const ok = await activate(s, rule.ruleId, { approver: "Sam", narrow: { capUsd: 0.05, expiresAt } });
    expect(ok.status).toBe(200);
    expect(ok.body.rule).toMatchObject({ status: "active", capUsd: 0.05, expiresAt });
  });

  it("concurrent activate+reject: exactly one wins and the stored state matches the winner (never active after a successful reject)", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const rule = await proposed(s);
    const [a, b] = await Promise.all([
      activate(s, rule.ruleId),
      postJson(s.gateway.url, `/admin/rules/${rule.ruleId}/reject`, { approver: "Priya" }),
    ]);
    // Reject may legitimately follow a completed activation (it deactivates), so both can be 200;
    // what must never happen is an active rule after a successful reject response.
    const final = (await s.store.listRules())[0];
    if (b.status === 200) {
      expect(final.status).toBe("rejected");
    } else {
      expect(b.status).toBe(409);
      expect(b.body.error.code).toBe("RULE_STATE");
      expect(a.status).toBe(200);
      expect(final.status).toBe("active");
    }
    if (a.status !== 200) {
      expect(a.status).toBe(409);
      expect(a.body.error.code).toBe("RULE_STATE");
      expect(final.status).toBe("rejected");
    }
  });

  it("two concurrent activations with different narrowings: one 200, one 409 RULE_STATE, stored rule matches the winner", async () => {
    s = await startStack({ judge: fakeJudge("hold").judge });
    const rule = await proposed(s);
    const [a, b] = await Promise.all([
      activate(s, rule.ruleId, { approver: "A", narrow: { capUsd: 0.05 } }),
      activate(s, rule.ruleId, { approver: "B", narrow: { capUsd: 0.02 } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(loser.body.error.code).toBe("RULE_STATE");
    expect((await s.store.listRules())[0]).toMatchObject({ status: "active", capUsd: winner.body.rule.capUsd, resolvedBy: winner.body.rule.resolvedBy });
  });

  it("refuses a rule that would auto-approve a purchase the judge blocked (409 REPLAY_FAILED, report attached and stored)", async () => {
    s = await startStack({ judge: scriptedJudge("hold", "block") });
    const rule = await proposed(s);
    const taskB = await declared(s);
    const blocked = await postJson(s.gateway.url, "/tools/pay_and_fetch", { taskId: taskB, req: weatherReq(s) });
    expect(blocked.body.status).toBe("blocked");
    const r = await activate(s, rule.ruleId);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("REPLAY_FAILED");
    expect(r.body.error.details.replay.knownBadMatched).toEqual([{ decisionId: blocked.body.decisionId, why: "blocked: judge: scripted block" }]);
    const stored = (await s.store.listRules())[0];
    expect(stored.status).toBe("proposed");
    expect(stored.replayResult!.knownBadMatched).toHaveLength(1);
  });

  it("refuses a rule that an attack case would slip through (corpus injected for the test)", async () => {
    const control: AttackCase = {
      caseId: "control",
      name: "control: trusted origins at the rule's own vendor and cap",
      specAttack: "premium-upsell",
      why: "control case: a legitimate-looking purchase that any rule would auto-approve",
      context: {
        payee: SAME_AS_RULE, category: SAME_AS_RULE, taskType: SAME_AS_RULE, amountUsd: RULE_CAP,
        fieldOrigins: { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "PLAN" },
      },
    };
    s = await startStack({ judge: fakeJudge("hold").judge, attackCorpus: [control] });
    const rule = await proposed(s);
    const r = await activate(s, rule.ruleId);
    expect(r.status).toBe(409);
    expect(r.body.error.details.replay.attacksMatched).toEqual([{ caseId: "control", name: control.name }]);
    expect(r.body.error.message).toContain("1 attacks matched");
  });
});
