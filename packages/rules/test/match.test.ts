import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, type Origin, type PaymentField, type Rule } from "@countersign/shared";
import { matchTier1, ruleMatches, tier1Eligible, type Tier1Input } from "@countersign/rules";

const NOW = 1_800_000_000_000;
const HOST = "vendor.test:4101";
const CLEAN: Record<PaymentField, Origin> = { payee: "PLAN", amount: "PLAN", tier: "PLAN", quantity: "PLAN", category: "TASK" };

const rule = (over: Partial<Rule> = {}): Rule => ({
  ruleId: "r1",
  payee: HOST,
  category: "weather",
  capUsd: 0.1,
  taskType: "data-lookup",
  expiresAt: NOW + 1000,
  createdBy: "Sam",
  status: "active",
  ...over,
});

const input = (over: Partial<Tier1Input> = {}): Tier1Input => ({
  floor: "approve",
  origins: CLEAN,
  payee: HOST,
  category: "weather",
  taskType: "data-lookup",
  amountUsd: 0.1,
  rules: [rule()],
  now: NOW,
  ...over,
});

describe("Tier 1 matcher (spec §9, D26)", () => {
  it("matches an active, unexpired rule on payee + category + task type within the cap", () => {
    expect(matchTier1(input())?.ruleId).toBe("r1");
  });

  it("every dimension must match", () => {
    const misses: Partial<Tier1Input>[] = [
      { payee: "other.test" },
      { category: "crypto-prices" },
      { category: null },
      { taskType: "research" },
      { amountUsd: 0.11 },
    ];
    for (const over of misses) expect(matchTier1(input(over)), JSON.stringify(over)).toBeUndefined();
  });

  it("payee and category are normalized on both sides", () => {
    const r = rule({ payee: "Vendor.TEST:4101", category: "Weather" });
    expect(matchTier1(input({ payee: "https://www.vendor.test:4101/docs", rules: [r] }))?.ruleId).toBe("r1");
  });

  it("the cap compares in atomic units: 0.1 + 0.2 fits a 0.3 cap", () => {
    expect(matchTier1(input({ amountUsd: 0.1 + 0.2, rules: [rule({ capUsd: 0.3 })] }))?.ruleId).toBe("r1");
  });

  it("expired, proposed and rejected rules never match", () => {
    for (const r of [rule({ expiresAt: NOW }), rule({ expiresAt: NOW - 1 }), rule({ status: "proposed" }), rule({ status: "rejected" })]) {
      expect(matchTier1(input({ rules: [r] }))).toBeUndefined();
    }
  });

  it("the first matching rule wins", () => {
    expect(matchTier1(input({ rules: [rule({ ruleId: "x", payee: "other.test" }), rule({ ruleId: "a" }), rule({ ruleId: "b" })] }))?.ruleId).toBe("a");
  });

  it("INV3: any PAGE, UNKNOWN or missing origin makes Tier 1 ineligible", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        const tainted = input({ origins: { ...CLEAN, [field]: origin } });
        expect(tier1Eligible(tainted), `${field}=${origin}`).toBe(false);
        expect(matchTier1(tainted), `${field}=${origin}`).toBeUndefined();
      }
      const missing: Partial<Record<PaymentField, Origin>> = { ...CLEAN };
      delete missing[field];
      expect(matchTier1(input({ origins: missing })), `${field} missing`).toBeUndefined();
    }
  });

  it("only an approve floor is eligible", () => {
    expect(matchTier1(input({ floor: "hold" }))).toBeUndefined();
    expect(matchTier1(input({ floor: "block" }))).toBeUndefined();
    expect(tier1Eligible({ floor: "approve", origins: CLEAN })).toBe(true);
  });

  it("ruleMatches is the per-rule check; matchTier1 adds the taint and floor gate first", () => {
    const tainted = input({ origins: { ...CLEAN, tier: "PAGE" } });
    expect(ruleMatches(rule(), tainted)).toBe(true);
    expect(matchTier1(tainted)).toBeUndefined();
  });
});
