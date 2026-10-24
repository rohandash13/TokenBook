import { matchTier1, type Tier1Input } from "@countersign/rules";

/** D26: the matcher lives in @countersign/rules so replay runs exactly the same code. */
export { matchTier1, ruleMatches, tier1Eligible, type Tier1Input } from "@countersign/rules";

export interface Tier1Result {
  approved: boolean;
  ruleId?: string;
  tier: 1;
  latencyMs: number;
  costUsd: 0;
}

/** Spec §9 Tier 1: ms, $0. Only on an approve floor with no tainted field (INV3), enforced inside matchTier1. */
export function runTier1(input: Tier1Input): Tier1Result {
  const started = performance.now();
  const rule = matchTier1(input);
  return {
    approved: rule !== undefined,
    ...(rule ? { ruleId: rule.ruleId } : {}),
    tier: 1,
    latencyMs: performance.now() - started,
    costUsd: 0,
  };
}
