import type { Origin, PaymentField, Rule, Verdict } from "@countersign/shared";
import { normalizeCategory, normalizeDomain, toAtomic } from "./normalize";
import { PAYMENT_FIELDS, isTainted } from "./tracer";

export interface Tier1Input {
  floor: Verdict;
  origins: Record<PaymentField, Origin>;
  payee: string;
  category: string | null;
  taskType: string;
  amountUsd: number;
  rules: Rule[];
  now: number;
}

export interface Tier1Result {
  approved: boolean;
  ruleId?: string;
  tier: 1;
  latencyMs: number;
  costUsd: 0;
}

export function ruleMatches(rule: Rule, input: Tier1Input): boolean {
  return (
    rule.status === "active" &&
    rule.expiresAt > input.now &&
    input.category !== null &&
    normalizeDomain(rule.payee) === input.payee &&
    normalizeCategory(rule.category) === input.category &&
    rule.taskType === input.taskType &&
    toAtomic(input.amountUsd) <= toAtomic(rule.capUsd)
  );
}

/** Spec §9 Tier 1: ms, $0. Only on an approve floor with no tainted field (INV3). */
export function runTier1(input: Tier1Input): Tier1Result {
  const started = performance.now();
  const eligible = input.floor === "approve" && !PAYMENT_FIELDS.some((f) => isTainted(input.origins[f]));
  const rule = eligible ? input.rules.find((r) => ruleMatches(r, input)) : undefined;
  return {
    approved: rule !== undefined,
    ...(rule ? { ruleId: rule.ruleId } : {}),
    tier: 1,
    latencyMs: performance.now() - started,
    costUsd: 0,
  };
}
