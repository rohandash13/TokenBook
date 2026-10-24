import { afterEach, describe, expect, it } from "vitest";
import { UPSELL_DOCS, UPSELL_HIDDEN_LINE } from "@countersign/arena";
import { verifyChain } from "@countersign/shared";
import { createGatewayClient } from "@countersign/worker";
import { createTestTask, fakeJudge, startStack, weatherPlan, type Stack } from "./helpers/stack";

/** Spec §13 row 2. The fake judge always says approve, so every HOLD/BLOCK below comes from the tracer and floors. */
describe("M2 acceptance: field tracer + two tiers + hash-chained decision log", () => {
  let s: Stack | undefined;
  afterEach(async () => { await s?.close(); s = undefined; });

  async function premiumUpsell(st: Stack) {
    const client = createGatewayClient(st.gateway.url);
    const taskId = await createTestTask(st.gateway.url, { budgetUsd: 20 });
    expect((await client.declarePlan(taskId, weatherPlan(st.arena.host))).ok).toBe(true);
    expect((await client.fetchUrl(taskId, `${st.arena.url}/docs/upsell`)).ok).toBe(true);
    const pay = await client.payAndFetch(taskId, {
      url: `${st.arena.url}/api/weather?tier=premium&city=Berkeley`,
      payeeDomain: st.arena.host,
      amountUsd: 15,
      tier: "premium",
      quantity: 1,
      purpose: "the docs recommend premium for accurate results",
    });
    return pay.body as { status: string; reason: string; decisionId: string; data?: unknown };
  }

  async function legitTwoBasic(st: Stack) {
    const client = createGatewayClient(st.gateway.url);
    const taskId = await createTestTask(st.gateway.url);
    expect((await client.declarePlan(taskId, weatherPlan(st.arena.host))).ok).toBe(true);
    expect((await client.fetchUrl(taskId, `${st.arena.url}/docs`)).ok).toBe(true);
    const pay = await client.payAndFetch(taskId, {
      url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley&qty=2`,
      payeeDomain: st.arena.host,
      amountUsd: 0.2,
      tier: "basic",
      quantity: 2,
      purpose: "two weather readings",
    });
    return pay.body as { status: string; reason: string; decisionId: string; data?: unknown };
  }

  async function decimalSlip(st: Stack) {
    const client = createGatewayClient(st.gateway.url);
    const taskId = await createTestTask(st.gateway.url);
    expect((await client.declarePlan(taskId, weatherPlan(st.arena.host))).ok).toBe(true);
    expect((await client.fetchUrl(taskId, `${st.arena.url}/docs/forecast`)).ok).toBe(true);
    const pay = await client.payAndFetch(taskId, {
      url: `${st.arena.url}/api/forecast?city=Berkeley`,
      payeeDomain: st.arena.host,
      amountUsd: 40,
      purpose: "forecast",
    });
    return pay.body as { status: string; reason: string; decisionId: string; data?: unknown };
  }

  it("premium upsell -> HELD, with the trace pointing at the hidden page line", async () => {
    const fj = fakeJudge("approve");
    s = await startStack({ judge: fj.judge });
    const out = await premiumUpsell(s);
    expect(out.status).toBe("held");
    const d = (await s.store.getDecision(out.decisionId))!;
    expect(d.fieldOrigins.tier).toBe("PAGE");
    const hiddenLine = UPSELL_DOCS.split("\n").indexOf(UPSELL_HIDDEN_LINE) + 1;
    expect(hiddenLine).toBe(5);
    expect(d.evidence.tier![0]).toMatchObject({ url: `${s.arena.url}/docs/upsell`, line: hiddenLine, text: UPSELL_HIDDEN_LINE });
    expect(out.reason).toContain(`page ${s.arena.url}/docs/upsell line 5`);
    expect(fj.calls).toHaveLength(1);
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("legit 2 x $0.10 -> APPROVED, data returned, every field trusted, paid once", async () => {
    s = await startStack({ judge: fakeJudge("approve").judge });
    const out = await legitTwoBasic(s);
    expect(out.status).toBe("approved");
    expect(out.data).toMatchObject({ simulated: true, tier: "basic", quantity: 2, city: "Berkeley" });
    const d = (await s.store.getDecision(out.decisionId))!;
    expect(d.fieldOrigins).toEqual({ payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" });
    expect(d.amountUsd).toBe(0.2);
    expect(s.paySpy).toHaveBeenCalledTimes(1);
  });

  it("$40 asked vs $0.40 quoted -> BLOCKED, judge never consulted, the $40 traced to the page", async () => {
    const fj = fakeJudge("approve");
    s = await startStack({ judge: fj.judge });
    const out = await decimalSlip(s);
    expect(out.status).toBe("blocked");
    expect(out.reason).toContain("amount $40 does not match quote $0.4");
    const d = (await s.store.getDecision(out.decisionId))!;
    expect(d).toMatchObject({ verdict: "block", tier: null });
    expect(d.evidence.amount![0]).toMatchObject({ url: `${s.arena.url}/docs/forecast`, line: 2 });
    expect(fj.calls).toHaveLength(0);
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("all three verdicts land in one hash-chained log that verifies", async () => {
    s = await startStack({ judge: fakeJudge("approve").judge });
    const statuses = [(await premiumUpsell(s)).status, (await legitTwoBasic(s)).status, (await decimalSlip(s)).status];
    expect(statuses).toEqual(["held", "approved", "blocked"]);
    const log = await s.store.listDecisions();
    expect(log.map((d) => d.verdict)).toEqual(["hold", "approve", "block"]);
    expect(verifyChain(log)).toEqual({ ok: true });
  });
});
