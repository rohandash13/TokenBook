import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, runTier1, type Tier1Input } from "@countersign/gateway";
import { mkRule, mkTrace } from "./fixtures";

function base(over: Partial<Tier1Input> = {}): Tier1Input {
  const t = mkTrace();
  return {
    floor: "approve",
    origins: t.origins,
    payee: t.payee,
    category: t.category,
    taskType: "data-lookup",
    amountUsd: 0.1,
    rules: [mkRule()],
    now: Date.now(),
    ...over,
  };
}

describe("Tier 1 (spec §9)", () => {
  it("approves on an active, unexpired rule matching payee + category + task type, at $0", () => {
    const r = runTier1(base());
    expect(r).toMatchObject({ approved: true, ruleId: "rule-1", tier: 1, costUsd: 0 });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("an expired rule does not match", () => {
    const now = Date.now();
    expect(runTier1(base({ now, rules: [mkRule({ expiresAt: now - 1 })] })).approved).toBe(false);
    expect(runTier1(base({ now, rules: [mkRule({ expiresAt: now })] })).approved).toBe(false);
  });

  it("a different task type does not match", () => {
    expect(runTier1(base({ taskType: "research" })).approved).toBe(false);
  });

  it("over the cap does not match; exactly at the cap does", () => {
    expect(runTier1(base({ amountUsd: 1.5 })).approved).toBe(false);
    expect(runTier1(base({ amountUsd: 1 })).approved).toBe(true);
  });

  it("any tainted field blocks Tier 1 approval", () => {
    for (const field of PAYMENT_FIELDS) {
      for (const origin of ["PAGE", "UNKNOWN"] as const) {
        const origins = { ...mkTrace().origins, [field]: origin };
        expect(runTier1(base({ origins })).approved, `${field}=${origin}`).toBe(false);
      }
    }
  });

  it("a hold floor is never approved by Tier 1", () => {
    expect(runTier1(base({ floor: "hold" })).approved).toBe(false);
  });

  it("proposed and rejected rules never match", () => {
    expect(runTier1(base({ rules: [mkRule({ status: "proposed" })] })).approved).toBe(false);
    expect(runTier1(base({ rules: [mkRule({ status: "rejected" })] })).approved).toBe(false);
  });

  it("payee and category must match (normalized); no category never matches", () => {
    expect(runTier1(base({ rules: [mkRule({ payee: "other.test" })] })).approved).toBe(false);
    expect(runTier1(base({ rules: [mkRule({ category: "crypto-prices" })] })).approved).toBe(false);
    expect(runTier1(base({ category: null })).approved).toBe(false);
    expect(runTier1(base({ rules: [mkRule({ payee: "https://www.VENDOR.test:4101", category: "Weather" })] })).approved).toBe(true);
  });
});
