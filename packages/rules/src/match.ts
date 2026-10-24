import {
  PAYMENT_FIELDS,
  isTainted,
  normalizeCategory,
  normalizeDomain,
  toAtomic,
  type Origin,
  type PaymentField,
  type Rule,
  type Verdict,
} from "@countersign/shared";

/** Everything Tier 1 looks at. Built from a live trace (gateway) or a logged decision (replay). */
export interface Tier1Input {
  floor: Verdict;
  origins: Partial<Record<PaymentField, Origin>>; // missing = UNKNOWN = tainted
  payee: string;
  category: string | null;
  taskType: string;
  amountUsd: number;
  rules: Rule[];
  now: number;
}

/** Spec §9 + INV3: Tier 1 runs only on an approve floor with no PAGE/UNKNOWN/missing field. */
export function tier1Eligible(input: Pick<Tier1Input, "floor" | "origins">): boolean {
  return input.floor === "approve" && !PAYMENT_FIELDS.some((f) => isTainted(input.origins[f]));
}

/** One rule against one payment. Taint is not checked here: matchTier1 gates on it before any rule is consulted. */
export function ruleMatches(rule: Rule, input: Tier1Input): boolean {
  return (
    rule.status === "active" &&
    rule.expiresAt > input.now &&
    input.category !== null &&
    normalizeDomain(rule.payee) === normalizeDomain(input.payee) &&
    normalizeCategory(rule.category) === normalizeCategory(input.category) &&
    rule.taskType === input.taskType &&
    toAtomic(input.amountUsd) <= toAtomic(rule.capUsd)
  );
}

/** The single Tier 1 decision (D26): used by the gateway's runTier1 and by replay. */
export function matchTier1(input: Tier1Input): Rule | undefined {
  if (!tier1Eligible(input)) return undefined;
  return input.rules.find((r) => ruleMatches(r, input));
}
