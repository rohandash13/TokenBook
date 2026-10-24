import { describe, expect, it, vi } from "vitest";
import {
  JUDGE_INVALID_REASON,
  NO_JUDGE_REASON,
  buildJudgeInput,
  computeFloors,
  decide,
  similarHistory,
  type DecideInput,
  type Judge,
  type JudgeInput,
  type JudgeResult,
} from "@countersign/gateway";
import type { Decision, Verdict } from "@countersign/shared";
import { HOST, mkQuote, mkReq, mkRule, mkTrace } from "./fixtures";

function judgeSaying(verdict: Verdict) {
  const fn = vi.fn(async (_input: JudgeInput): Promise<JudgeResult> => ({
    verdict,
    reasons: [`fake judge says ${verdict}`],
    costUsd: null,
    tokens: null,
  }));
  const judge: Judge = { judge: fn };
  return { judge, fn };
}

function clean(over: Partial<DecideInput> = {}): DecideInput {
  const trace = mkTrace();
  return {
    trace,
    floor: computeFloors({ trace, req: mkReq(), quote: mkQuote(), budgetRemainingUsd: 20, payeeAllowlist: [] }),
    taskType: "data-lookup",
    rules: [],
    now: Date.now(),
    budgetRemainingUsd: 20,
    history: { approvedSimilar: 0, heldSimilar: 0 },
    ...over,
  };
}

describe("decide", () => {
  it("a block floor returns block without calling Tier 1 or the judge", async () => {
    const j = judgeSaying("approve");
    const out = await decide(clean({
      floor: { verdict: "block", reasons: ["amount mismatch"], checks: [{ verdict: "block", reason: "amount mismatch" }] },
      rules: [mkRule()],
      judge: j.judge,
    }));
    expect(out).toEqual({ verdict: "block", tier: null, reasons: ["amount mismatch"], costUsd: 0 });
    expect(j.fn).not.toHaveBeenCalled();
  });

  it("a matching active rule approves at Tier 1 without calling the judge", async () => {
    const j = judgeSaying("block");
    const out = await decide(clean({ rules: [mkRule()], judge: j.judge }));
    expect(out).toMatchObject({ verdict: "approve", tier: 1, ruleId: "rule-1", costUsd: 0 });
    expect(out.reasons).toContain("tier 1: active rule rule-1 matched");
    expect(j.fn).not.toHaveBeenCalled();
  });

  it("without a rule, Tier 2 asks the judge with buildJudgeInput's structured object", async () => {
    const j = judgeSaying("approve");
    const input = clean({ judge: j.judge, history: { approvedSimilar: 2, heldSimilar: 0 } });
    const out = await decide(input);
    expect(out).toMatchObject({ verdict: "approve", tier: 2, costUsd: null, judge: { verdict: "approve", reasons: ["fake judge says approve"] } });
    expect(out.reasons).toContain("judge: fake judge says approve");
    expect(j.fn).toHaveBeenCalledTimes(1);
    expect(j.fn.mock.calls[0][0]).toEqual(
      buildJudgeInput({ taskType: "data-lookup", trace: input.trace, budgetRemainingUsd: 20, history: { approvedSimilar: 2, heldSimilar: 0 } }),
    );
  });

  it("no judge configured -> hold (fail closed)", async () => {
    const out = await decide(clean());
    expect(out).toMatchObject({ verdict: "hold", tier: 2, costUsd: 0, judge: { verdict: "hold", reasons: [NO_JUDGE_REASON] } });
    expect(out.reasons).toContain(`judge: ${NO_JUDGE_REASON}`);
  });

  it("a judge that throws -> hold", async () => {
    const judge: Judge = { judge: async () => { throw new Error("boom"); } };
    const out = await decide(clean({ judge }));
    expect(out).toMatchObject({ verdict: "hold", tier: 2, judge: { verdict: "hold", reasons: [JUDGE_INVALID_REASON, "judge error: boom"] } });
  });

  it("a judge that returns a non-verdict -> hold", async () => {
    const judge: Judge = { judge: async () => ({ verdict: "yes" as unknown as Verdict, reasons: ["sure"], costUsd: null, tokens: null }) };
    expect((await decide(clean({ judge }))).verdict).toBe("hold");
  });

  it("final = max(floor, judge): a hold floor stays hold when the judge approves", async () => {
    const j = judgeSaying("approve");
    const floor = { verdict: "hold" as const, reasons: ["quantity 3 exceeds plan maxQuantity 2"], checks: [] };
    expect((await decide(clean({ floor, judge: j.judge }))).verdict).toBe("hold");
  });

  it("the judge can raise a clean floor to block", async () => {
    expect((await decide(clean({ judge: judgeSaying("block").judge }))).verdict).toBe("block");
  });

  it("INV3 guard: tainted field + forced approve floor + matching rule + approving judge -> hold", async () => {
    const trace = mkTrace();
    trace.origins.tier = "PAGE";
    const out = await decide(clean({
      trace,
      floor: { verdict: "approve", reasons: [], checks: [] },
      rules: [mkRule()],
      judge: judgeSaying("approve").judge,
    }));
    expect(out.verdict).toBe("hold");
    expect(out.reasons.some((r) => r.startsWith("INV3"))).toBe(true);
  });

  it("similarHistory counts approved and held verdicts for the same payee and category", () => {
    const d = (verdict: Verdict, over: Partial<Decision> = {}): Decision => ({
      decisionId: "d", paymentRequestId: "p", taskId: "t", kind: "verdict", tier: 2, verdict,
      fieldOrigins: {}, evidence: {}, amountUsd: 0.1, payeeDomain: HOST, category: "weather", floorReasons: [],
      reasons: [], latencyMs: 0, costUsd: null, createdAt: 0, prevHash: "", hash: "", ...over,
    });
    const log = [
      d("approve"), d("approve"), d("hold"), d("block"),
      d("approve", { category: "crypto-prices" }),
      d("approve", { payeeDomain: "other.test" }),
      d("block", { kind: "executor_failure" }),
    ];
    expect(similarHistory(log, HOST, "weather")).toEqual({ approvedSimilar: 2, heldSimilar: 1 });
  });
});
