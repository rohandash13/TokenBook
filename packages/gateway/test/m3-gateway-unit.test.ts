import { describe, expect, it } from "vitest";
import { budgetRemainingUsd, holdView, loadApproversFile } from "@countersign/gateway";
import type { Decision, Hold } from "@countersign/shared";

const dec = (over: Partial<Decision>): Decision => ({
  decisionId: "d", paymentRequestId: "p", taskId: "t1", kind: "verdict", tier: 2, verdict: "approve",
  fieldOrigins: {}, evidence: {}, amountUsd: 0.1, payeeDomain: "v.test", category: "weather", floorReasons: [],
  reasons: [], latencyMs: 0, costUsd: null, createdAt: 0, prevHash: "", hash: "", ...over,
});

const hold = (over: Partial<Hold> = {}): Hold => ({
  holdId: "h1", decisionId: "d1", taskId: "t1", routedTo: "Sam", status: "open",
  req: { url: "http://v.test/api/weather", payeeDomain: "v.test", amountUsd: 0.1, purpose: "p" },
  quoteId: "q1", createdAt: 1, ...over,
});

describe("M3 gateway units", () => {
  it("loads config/approvers.json", () => {
    expect(loadApproversFile(new URL("../../../config/approvers.json", import.meta.url))).toEqual({
      routes: [{ when: { category: "coding", maxUsd: 5 }, approver: "Priya" }],
      default: "Sam",
    });
  });

  it("budget: human approvals spend; one whose payment failed does not; held and rejected never do (D23, D28)", () => {
    const remaining = budgetRemainingUsd({ taskId: "t1", budgetUsd: 1 }, [
      dec({ paymentRequestId: "a", verdict: "hold", amountUsd: 0.2 }),
      dec({ paymentRequestId: "a", kind: "human_approval", tier: null, verdict: "approve", amountUsd: 0.2 }),
      dec({ paymentRequestId: "b", verdict: "hold", amountUsd: 0.3 }),
      dec({ paymentRequestId: "b", kind: "human_approval", tier: null, verdict: "approve", amountUsd: 0.3 }),
      dec({ paymentRequestId: "b", kind: "executor_failure", tier: null, verdict: "block", amountUsd: 0.3 }),
      dec({ paymentRequestId: "c", verdict: "hold", amountUsd: 0.4 }),
      dec({ paymentRequestId: "c", kind: "human_rejection", tier: null, verdict: "block", amountUsd: 0.4 }),
    ]);
    expect(remaining).toBe(0.8);
  });

  it("holdView: open, rejected, approved+settled (data), approved+failed (no data), approved with payment in flight (open)", () => {
    expect(holdView(hold())).toEqual({ holdId: "h1", decisionId: "d1", status: "open", reason: "held for review by Sam" });
    expect(holdView(hold({ status: "rejected", resolvedBy: "Priya" }))).toEqual({ holdId: "h1", decisionId: "d1", status: "rejected", reason: "rejected by Priya" });
    expect(holdView(hold({ status: "approved", resolvedBy: "Sam", payment: { status: "settled", reason: "approved by Sam; paid (simulated)", data: { x: 1 }, decisionId: "a" } })))
      .toEqual({ holdId: "h1", decisionId: "d1", status: "approved", reason: "approved by Sam; paid (simulated)", data: { x: 1 } });
    expect(holdView(hold({ status: "approved", resolvedBy: "Sam", payment: { status: "failed", reason: "payment failed: executor failed: http 402", decisionId: "f" } })))
      .toEqual({ holdId: "h1", decisionId: "d1", status: "approved", reason: "payment failed: executor failed: http 402" });
    expect(holdView(hold({ status: "approved", resolvedBy: "Sam" })))
      .toEqual({ holdId: "h1", decisionId: "d1", status: "open", reason: "approved by Sam; payment in progress" });
  });
});
