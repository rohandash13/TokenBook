import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, type Decision, type Origin, type PaymentField, type Rule } from "@countersign/shared";
import { DEFAULT_RULE_TTL_MS, NarrowError, narrowRule, proposeRule, type ProposeInput } from "@countersign/rules";

const NOW = 1_800_000_000_000;
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };

const held = (over: Partial<Decision> = {}): Decision => ({
  decisionId: "d1", paymentRequestId: "p1", taskId: "t1", kind: "verdict", tier: 2, verdict: "hold",
  fieldOrigins: { ...CLEAN }, evidence: {}, amountUsd: 0.1, payeeDomain: "vendor.test:4101", category: "weather",
  floorReasons: [], reasons: ["judge: new payee"], latencyMs: 1, costUsd: null, createdAt: 1, prevHash: "", hash: "",
  ...over,
});

const args = (decision: Decision, over: Partial<ProposeInput> = {}): ProposeInput => ({
  decision,
  task: { taskType: "data-lookup" },
  approver: "Sam",
  now: NOW,
  ttlMs: DEFAULT_RULE_TTL_MS,
  ruleId: "r1",
  holdId: "h1",
  ...over,
});

describe("proposeRule (spec §9, D29)", () => {
  it("the default TTL is 7 days", () => {
    expect(DEFAULT_RULE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("a clean held decision proposes the narrowest rule: this payee, category and task type, capped at the approved amount", () => {
    const p = proposeRule(args(held()));
    expect(p.rule).toEqual({
      ruleId: "r1",
      payee: "vendor.test:4101",
      category: "weather",
      capUsd: 0.1,
      taskType: "data-lookup",
      expiresAt: NOW + DEFAULT_RULE_TTL_MS,
      createdBy: "Sam",
      status: "proposed",
      sourceHoldId: "h1",
    });
    expect(p.reason).toBe(
      `narrow rule: vendor.test:4101 / weather / up to $0.1 / data-lookup / expires ${new Date(NOW + DEFAULT_RULE_TTL_MS).toISOString()}`,
    );
  });

  it("normalizes payee and category; omits sourceHoldId when there is no hold", () => {
    const p = proposeRule(args(held({ payeeDomain: "https://www.Vendor.TEST:4101/", category: "Crypto Prices" }), { holdId: undefined }));
    expect(p.rule).toMatchObject({ payee: "vendor.test:4101", category: "crypto-prices" });
    expect(p.rule).not.toHaveProperty("sourceHoldId");
  });

  it("the premium upsell (tier and amount from a page) proposes nothing", () => {
    expect(proposeRule(args(held({ fieldOrigins: { ...CLEAN, amount: "PAGE", tier: "PAGE" }, amountUsd: 15 })))).toEqual({
      rule: null,
      reason: "tainted fields: amount, tier; one-off approval only",
    });
  });

  it("INV3: any PAGE, UNKNOWN or missing origin proposes nothing", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        expect(proposeRule(args(held({ fieldOrigins: { ...CLEAN, [field]: origin } }))).rule, `${field}=${origin}`).toBeNull();
      }
    }
    const missing: Partial<Record<PaymentField, Origin>> = { ...CLEAN };
    delete missing.quantity;
    expect(proposeRule(args(held({ fieldOrigins: missing })))).toEqual({
      rule: null,
      reason: "tainted fields: quantity; one-off approval only",
    });
  });

  it("no category proposes nothing", () => {
    expect(proposeRule(args(held({ category: null })))).toEqual({
      rule: null,
      reason: "no category for this endpoint; one-off approval only",
    });
  });

  it("a non-positive TTL is a programming error", () => {
    expect(() => proposeRule(args(held(), { ttlMs: 0 }))).toThrow();
  });
});

describe("narrowRule (only tightening, D29)", () => {
  const rule: Rule = {
    ruleId: "r1", payee: "vendor.test:4101", category: "weather", capUsd: 0.1, taskType: "data-lookup",
    expiresAt: NOW + 10_000, createdBy: "Sam", status: "proposed",
  };

  it("lowers the cap and pulls the expiry in, without mutating the input", () => {
    const out = narrowRule(rule, { capUsd: 0.05, expiresAt: NOW + 5_000 }, NOW);
    expect(out).toEqual({ ...rule, capUsd: 0.05, expiresAt: NOW + 5_000 });
    expect(rule.capUsd).toBe(0.1);
  });

  it("an empty narrow or equal values are allowed", () => {
    expect(narrowRule(rule, {}, NOW)).toEqual(rule);
    expect(narrowRule(rule, { capUsd: 0.1, expiresAt: NOW + 10_000 }, NOW)).toEqual(rule);
  });

  it("widening the cap or the expiry throws NarrowError", () => {
    expect(() => narrowRule(rule, { capUsd: 0.11 }, NOW)).toThrow(NarrowError);
    expect(() => narrowRule(rule, { expiresAt: NOW + 10_001 }, NOW)).toThrow(NarrowError);
  });

  it("the cap must be a finite number > 0; the expiry must be in the future", () => {
    for (const capUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => narrowRule(rule, { capUsd }, NOW), String(capUsd)).toThrow(NarrowError);
    }
    expect(() => narrowRule(rule, { expiresAt: NOW }, NOW)).toThrow(NarrowError);
    expect(() => narrowRule(rule, { expiresAt: NOW - 1 }, NOW)).toThrow(NarrowError);
  });

  it("payee, category, task type and status cannot be changed", () => {
    for (const key of ["payee", "category", "taskType", "status"]) {
      expect(() => narrowRule(rule, { [key]: "x" } as never, NOW), key).toThrow(NarrowError);
    }
  });
});
