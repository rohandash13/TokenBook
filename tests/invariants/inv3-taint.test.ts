import { afterEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_FIELDS, SEVERITY, computeFloors, decide, type Judge } from "@countersign/gateway";
import type { Origin } from "@countersign/shared";
import { mkQuote, mkReq, mkRule, mkTrace } from "../../packages/gateway/test/fixtures";
import {
  activeRule,
  createTestTask,
  fakeJudge,
  postJson,
  startStack,
  weatherPlan,
  type Stack,
} from "../helpers/stack";

const approvingJudge = (): Judge => ({
  judge: vi.fn(async () => ({ verdict: "approve" as const, reasons: ["looks fine"], costUsd: null, tokens: null })),
});

describe("INV3 (unit): a PAGE/UNKNOWN field can never be auto-approved", () => {
  for (const field of PAYMENT_FIELDS) {
    for (const origin of ["PAGE", "UNKNOWN"] as Origin[]) {
      it(`${field}=${origin}: matching active rule + approving judge, even with a wrongly-approve floor -> >= hold`, async () => {
        const trace = mkTrace();
        trace.origins[field] = origin;
        const base = {
          trace,
          taskType: "data-lookup",
          rules: [mkRule({ capUsd: 100 })],
          now: Date.now(),
          judge: approvingJudge(),
          budgetRemainingUsd: 20,
          history: { approvedSimilar: 9, heldSimilar: 0 },
        };
        const realFloor = computeFloors({ trace, req: mkReq(), quote: mkQuote(), budgetRemainingUsd: 20, payeeAllowlist: [] });
        expect(SEVERITY[realFloor.verdict]).toBeGreaterThanOrEqual(SEVERITY.hold);
        expect(realFloor.reasons.some(r => r.startsWith(field + " "))).toBe(true);
        const real = await decide({ ...base, floor: realFloor });
        expect(SEVERITY[real.verdict]).toBeGreaterThanOrEqual(SEVERITY.hold);
        const forced = await decide({ ...base, floor: { verdict: "approve", reasons: [], checks: [] } });
        expect(SEVERITY[forced.verdict]).toBeGreaterThanOrEqual(SEVERITY.hold);
        expect(forced.reasons.join(" ")).toContain(field);
        const cleanTrace = mkTrace();
        const cleanFloor = computeFloors({ trace: cleanTrace, req: mkReq(), quote: mkQuote(), budgetRemainingUsd: 20, payeeAllowlist: [] });
        expect((await decide({ ...base, trace: cleanTrace, floor: cleanFloor })).verdict).toBe("approve");
      });
    }
  }
});

describe("INV3 (HTTP): tainted payments are never paid, even with a matching rule and an approving judge", () => {
  let s: Stack | undefined;
  afterEach(async () => { await s?.close(); s = undefined; });

  async function attempt(opts: {
    plan?: (host: string) => unknown;
    tainted: string[];
    budgetUsd?: number;
    ruleCategory?: string;
    readPath?: string;
    req: (st: Stack) => Record<string, unknown>;
  }) {
    s = await startStack({ judge: fakeJudge("approve").judge });
    await s.store.putRule(activeRule(s.arena.host, { capUsd: 20, ...(opts.ruleCategory ? { category: opts.ruleCategory } : {}) }));
    const taskId = await createTestTask(s.gateway.url, { budgetUsd: opts.budgetUsd ?? 1 });
    const plan = (opts.plan ?? weatherPlan)(s.arena.host);
    expect((await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan })).status).toBe(200);
    if (opts.readPath) {
      expect((await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: `${s.arena.url}${opts.readPath}` })).status).toBe(200);
    }
    const r = await postJson(s.gateway.url, "/tools/pay_and_fetch", { taskId, req: opts.req(s) });
    expect(r.status).toBe(200);
    const decision = (await s.store.getDecision(r.body.decisionId))!;
    for (const field of opts.tainted) expect(decision.reasons.some(reason => reason.startsWith(field + " "))).toBe(true);
    expect(s.paySpy).not.toHaveBeenCalled();
    // A trusted version under the SAME active rule must succeed.
    const cleanTask = await createTestTask(s.gateway.url, { budgetUsd: 20, text: "Get weather and crypto prices" });
    const cleanPlan = weatherPlan(s.arena.host);
    cleanPlan.expected[0].category = opts.ruleCategory ?? "weather";
    await postJson(s.gateway.url, "/tools/declare_plan", { taskId: cleanTask, plan: cleanPlan });
    const cleanReq = basic(s, opts.ruleCategory ? { url: `${s.arena.url}/api/crypto?symbol=BTC` } : {});
    const clean = await postJson(s.gateway.url, "/tools/pay_and_fetch", { taskId: cleanTask, req: cleanReq });
    expect(clean.body.status).toBe("approved");
    expect(s.paySpy).toHaveBeenCalledTimes(1);
    s.paySpy.mockClear();
    return { r, decision, st: s };
  }

  const basic = (st: Stack, over: Record<string, unknown> = {}) => ({
    url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley`,
    payeeDomain: st.arena.host,
    amountUsd: 0.1,
    tier: "basic",
    quantity: 1,
    purpose: "weather for Berkeley",
    ...over,
  });

  it("payee not in task or plan (UNKNOWN)", async () => {
    const { r, decision, st } = await attempt({
      tainted: ["payee"],
      plan: (h) => ({ ...weatherPlan(h), expected: [{ ...weatherPlan(h).expected[0], vendorDomains: ["other.test"] }] }),
      req: (st) => basic(st),
    });
    expect(decision.fieldOrigins.payee).toBe("UNKNOWN");
    expect(r.body.status).toBe("held");
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("tier and amount pushed by a page (PAGE)", async () => {
    const { r, decision, st } = await attempt({
      tainted: ["tier", "amount"],
      budgetUsd: 20,
      readPath: "/docs/upsell",
      req: (st) => basic(st, { url: `${st.arena.url}/api/weather?tier=premium&city=Berkeley`, amountUsd: 15, tier: "premium" }),
    });
    expect(decision.fieldOrigins.tier).toBe("PAGE");
    expect(decision.fieldOrigins.amount).toBe("PAGE");
    expect(r.body.status).toBe("held");
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("category drift: crypto endpoint while the plan is weather (UNKNOWN), with a crypto rule active", async () => {
    const { r, decision, st } = await attempt({
      tainted: ["category"],
      ruleCategory: "crypto-prices",
      req: (st) => basic(st, { url: `${st.arena.url}/api/crypto?symbol=BTC` }),
    });
    expect(decision.fieldOrigins.category).toBe("UNKNOWN");
    expect(r.body.status).toBe("held");
    expect(st.paySpy).not.toHaveBeenCalled();
  });

  it("quantity above the plan (UNKNOWN)", async () => {
    const { r, decision, st } = await attempt({
      tainted: ["quantity"],
      req: (st) => basic(st, { url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley&qty=3`, amountUsd: 0.3, quantity: 3 }),
    });
    expect(decision.fieldOrigins.quantity).toBe("UNKNOWN");
    expect(r.body.status).toBe("held");
    expect(st.paySpy).not.toHaveBeenCalled();
  });
});
