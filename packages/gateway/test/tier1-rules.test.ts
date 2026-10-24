import { describe, expect, it } from "vitest";
import * as gateway from "@countersign/gateway";
import * as rules from "@countersign/rules";
import { mkRule, mkTrace } from "./fixtures";

describe("one Tier 1 matcher for live decisions and replay (D26)", () => {
  it("the gateway exports the rules package's matcher itself", () => {
    expect(gateway.ruleMatches).toBe(rules.ruleMatches);
    expect(gateway.matchTier1).toBe(rules.matchTier1);
    expect(gateway.tier1Eligible).toBe(rules.tier1Eligible);
  });

  it("runTier1 is a timing wrapper around matchTier1", () => {
    const t = mkTrace();
    const input = {
      floor: "approve" as const,
      origins: t.origins,
      payee: t.payee,
      category: t.category,
      taskType: "data-lookup",
      amountUsd: 0.1,
      rules: [mkRule()],
      now: Date.now(),
    };
    expect(gateway.runTier1(input)).toMatchObject({ approved: true, ruleId: rules.matchTier1(input)!.ruleId, tier: 1, costUsd: 0 });
    const tainted = { ...input, origins: { ...t.origins, tier: "PAGE" as const } };
    expect(rules.matchTier1(tainted)).toBeUndefined();
    expect(gateway.runTier1(tainted).approved).toBe(false);
  });
});
