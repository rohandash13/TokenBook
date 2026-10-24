import { describe, expect, it } from "vitest";
import {
  ATTACK_CORPUS,
  DEFAULT_RULE_TTL_MS,
  instantiateAttack,
  matchTier1,
  proposeRule,
  replayRule,
} from "@countersign/rules";
import { PAYMENT_FIELDS, type Decision, type Hold, type Origin, type PaymentField, type Rule } from "@countersign/shared";

const NOW = 1_800_000_000_000;
const HOST = "127.0.0.1:4101";
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };

const dec = (fieldOrigins: Partial<Record<PaymentField, Origin>>): Decision => ({
  decisionId: "d", paymentRequestId: "p", taskId: "t1", kind: "verdict", tier: 2, verdict: "hold", fieldOrigins,
  evidence: {}, amountUsd: 0.1, payeeDomain: HOST, category: "weather", floorReasons: [], reasons: [],
  latencyMs: 0, costUsd: null, createdAt: 0, prevHash: "", hash: "",
});
const wide: Rule = {
  ruleId: "wide", payee: HOST, category: "weather", capUsd: 1_000_000, taskType: "data-lookup",
  expiresAt: NOW + DEFAULT_RULE_TTL_MS, createdBy: "test", status: "active",
};
const rejectedHold: Hold = {
  holdId: "h", decisionId: "d", taskId: "t1", routedTo: "Sam", status: "rejected", resolvedBy: "Sam",
  req: { url: `http://${HOST}/api/weather`, payeeDomain: HOST, amountUsd: 0.1, purpose: "p" }, quoteId: "q", createdAt: 0,
};

describe("INV3 across rule proposal, replay and the attack corpus", () => {
  const variants: Array<[string, Partial<Record<PaymentField, Origin>>]> = [];
  for (const field of PAYMENT_FIELDS) {
    for (const origin of ["PAGE", "UNKNOWN"] as const) variants.push([`${field}=${origin}`, { ...CLEAN, [field]: origin }]);
    const missing: Partial<Record<PaymentField, Origin>> = { ...CLEAN };
    delete missing[field];
    variants.push([`${field} missing`, missing]);
  }

  for (const [label, origins] of variants) {
    it(`${label}: no rule is proposed, and a $1,000,000 rule never auto-approves it in replay or live Tier 1`, () => {
      const d = dec(origins);
      expect(proposeRule({ decision: d, task: { taskType: "data-lookup" }, approver: "Sam", now: NOW, ttlMs: DEFAULT_RULE_TTL_MS, ruleId: "r" }).rule).toBeNull();
      const r = replayRule(wide, {
        decisions: [d],
        tasks: new Map([["t1", { taskId: "t1", text: "t", budgetUsd: 1, taskType: "data-lookup", createdAt: 0 }]]),
        holds: [rejectedHold],
        attackCorpus: [],
        activeRules: [wide],
        now: NOW,
      });
      expect(r.wouldAutoApprove).toBe(0);
      expect(r.knownBadMatched).toEqual([]);
      expect(matchTier1({ floor: "approve", origins, payee: HOST, category: "weather", taskType: "data-lookup", amountUsd: 0.1, rules: [wide], now: NOW })).toBeUndefined();
    });
  }

  it("no attack corpus case is ever matched, even by a rule at the attack's own vendor with a $1,000,000 cap", () => {
    for (const c of ATTACK_CORPUS) expect(matchTier1(instantiateAttack(c, wide, NOW)), c.caseId).toBeUndefined();
  });
});
