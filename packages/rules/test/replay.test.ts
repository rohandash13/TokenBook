import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, type Decision, type Hold, type Origin, type PaymentField, type Rule, type Task } from "@countersign/shared";
import {
  ATTACK_CORPUS,
  RULE_CAP,
  SAME_AS_RULE,
  replayPassed,
  replayRule,
  type AttackCase,
  type ReplayContext,
} from "@countersign/rules";

const NOW = 1_800_000_000_000;
const HOST = "vendor.test:4101";
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };
const N = ATTACK_CORPUS.length;

const dec = (decisionId: string, over: Partial<Decision> = {}): Decision => ({
  decisionId, paymentRequestId: `p-${decisionId}`, taskId: "t1", kind: "verdict", tier: 2, verdict: "hold",
  fieldOrigins: { ...CLEAN }, evidence: {}, amountUsd: 0.1, payeeDomain: HOST, category: "weather", floorReasons: [],
  reasons: ["judge: new payee"], latencyMs: 1, costUsd: null, createdAt: 1, prevHash: "", hash: "", ...over,
});
const task = (taskId: string, taskType = "data-lookup"): Task => ({ taskId, text: "Get the weather", budgetUsd: 1, taskType, createdAt: 0 });
const candidate = (over: Partial<Rule> = {}): Rule => ({
  ruleId: "cand", payee: HOST, category: "weather", capUsd: 0.1, taskType: "data-lookup",
  expiresAt: NOW + 1000, createdBy: "Sam", status: "proposed", ...over,
});
const hold = (decisionId: string, status: Hold["status"], over: Partial<Hold> = {}): Hold => ({
  holdId: `h-${decisionId}`, decisionId, taskId: "t1", routedTo: "Sam", status,
  req: { url: `http://${HOST}/api/weather?tier=basic`, payeeDomain: HOST, amountUsd: 0.1, tier: "basic", quantity: 1, purpose: "p" },
  quoteId: "q", createdAt: 1, ...over,
});
const ctx = (over: Partial<ReplayContext> = {}): ReplayContext => ({
  decisions: [],
  tasks: new Map([["t1", task("t1")], ["t2", task("t2", "research")]]),
  holds: [],
  attackCorpus: ATTACK_CORPUS,
  activeRules: [],
  now: NOW,
  ...over,
});

describe("replayRule (spec §9, D30)", () => {
  it("counts every verdict decision plus every attack case, and which ones the candidate would auto-approve", () => {
    const r = replayRule(candidate(), ctx({
      decisions: [
        dec("d1"),
        dec("d2", { fieldOrigins: { ...CLEAN, tier: "PAGE" } }),
        dec("d3", { taskId: "t2" }),
        dec("d4", { amountUsd: 0.2 }),
        dec("d5", { floorReasons: ["unit price $0.2 exceeds plan maxUnitUsd $0.1"] }),
        dec("d6", { kind: "executor_failure", verdict: "block" }),
        dec("d7", { kind: "human_approval", verdict: "approve" }),
        dec("d8", { taskId: "t-missing" }),
      ],
    }));
    expect(r).toEqual({
      ranAt: NOW,
      decisionsChecked: 6,
      attacksChecked: N,
      casesChecked: 6 + N,
      wouldAutoApprove: 1,
      newlyAutoApproved: 1,
      knownBadMatched: [],
      attacksMatched: [],
      summary: `${6 + N} cases, 0 attacks matched, 0 known-bad matched`,
    });
    expect(replayPassed(r)).toBe(true);
  });

  it("newlyAutoApproved excludes what an existing active rule already approves; proposed rules do not count as existing", () => {
    const existing = candidate({ ruleId: "old", status: "active" });
    expect(replayRule(candidate(), ctx({ decisions: [dec("d1")], activeRules: [existing] }))).toMatchObject({ wouldAutoApprove: 1, newlyAutoApproved: 0 });
    const proposed = candidate({ ruleId: "other", status: "proposed" });
    expect(replayRule(candidate(), ctx({ decisions: [dec("d1")], activeRules: [proposed] }))).toMatchObject({ wouldAutoApprove: 1, newlyAutoApproved: 1 });
  });

  it("a rejected hold the candidate would approve is known-bad; open and approved holds are not", () => {
    const r = replayRule(candidate(), ctx({
      decisions: [dec("d1"), dec("d2"), dec("d3")],
      holds: [hold("d1", "rejected", { resolvedBy: "Sam" }), hold("d2", "approved"), hold("d3", "open")],
    }));
    expect(r.knownBadMatched).toEqual([{ decisionId: "d1", why: "hold h-d1 was rejected by Sam" }]);
    expect(r.summary).toBe(`${3 + N} cases, 0 attacks matched, 1 known-bad matched`);
    expect(replayPassed(r)).toBe(false);
  });

  it("a clean-floor block the candidate would approve is known-bad; a floor block never matches", () => {
    const r = replayRule(candidate(), ctx({
      decisions: [
        dec("judged", { verdict: "block", reasons: ["judge: scripted block"] }),
        dec("slip", { verdict: "block", amountUsd: 0.1, floorReasons: ["amount $40 does not match quote $0.4"] }),
      ],
    }));
    expect(r.knownBadMatched).toEqual([{ decisionId: "judged", why: "blocked: judge: scripted block" }]);
  });

  it("INV3: a tainted decision is never auto-approvable and never reported, whatever the candidate", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        const d = dec("t", { fieldOrigins: { ...CLEAN, [field]: origin } });
        const r = replayRule(candidate({ capUsd: 1_000_000 }), ctx({ decisions: [d], holds: [hold("t", "rejected")] }));
        expect(r.wouldAutoApprove, `${field}=${origin}`).toBe(0);
        expect(r.knownBadMatched, `${field}=${origin}`).toEqual([]);
      }
    }
  });

  it("an expired candidate matches nothing", () => {
    expect(replayRule(candidate({ expiresAt: NOW }), ctx({ decisions: [dec("d1")] })).wouldAutoApprove).toBe(0);
  });

  it("replay is not vacuous: a corpus case with trusted origins at the rule's own vendor is reported", () => {
    const control: AttackCase = {
      caseId: "control",
      name: "control case: trusted origins, rule's own payee, at the cap",
      specAttack: "premium-upsell",
      context: { payee: SAME_AS_RULE, category: SAME_AS_RULE, taskType: SAME_AS_RULE, amountUsd: RULE_CAP, fieldOrigins: { ...CLEAN } },
    };
    const r = replayRule(candidate(), ctx({ attackCorpus: [control] }));
    expect(r.attacksMatched).toEqual([{ caseId: "control", name: control.name }]);
    expect(r.summary).toBe("1 cases, 1 attacks matched, 0 known-bad matched");
    expect(replayPassed(r)).toBe(false);
  });
});
