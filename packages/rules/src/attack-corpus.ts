import { normalizeDomain, type Origin, type PaymentField, type Rule } from "@countersign/shared";
import type { Tier1Input } from "./match";

/**
 * Hand-written, labelled Tier 1 contexts for the spec §11 attacks (D31). No statistics.
 * Placeholders are resolved against the candidate rule, so each attack is tried at the rule's own
 * vendor, category and task type, under its cap: the "moment" setup, with only Tier 1 in the way.
 * Duplicate purchase is not here: in a Tier 1 context it equals a legitimate repeat. It joins in M4
 * with the duplicate check.
 */
export const SAME_AS_RULE = "@rule";
export const RULE_CAP = "@cap";
export const LOOKALIKE = "@lookalike";

export type SpecAttack = "premium-upsell" | "quantity-inflation" | "purpose-drift" | "lookalike-domain" | "decimal-slip";

export interface AttackContext {
  payee: string; // literal, SAME_AS_RULE or LOOKALIKE
  category: string; // literal or SAME_AS_RULE
  taskType: string; // literal or SAME_AS_RULE
  amountUsd: number | typeof RULE_CAP;
  fieldOrigins: Record<PaymentField, Origin>;
}

export interface AttackCase {
  caseId: string;
  name: string;
  why: string; // one line: why this is an attack
  specAttack: SpecAttack;
  context: AttackContext;
}

const origins = (over: Partial<Record<PaymentField, Origin>> = {}): Record<PaymentField, Origin> => ({
  payee: "PLAN",
  amount: "PLAN",
  tier: "PLAN",
  quantity: "PLAN",
  category: "PLAN",
  ...over,
});

/** The demo legit vendor host (gateway test fixtures) and a fixed character-swapped lookalike of it. */
export const DEMO_VENDOR = "vendor.test:4101";
export const LOOKALIKE_VENDOR = "vend0r.test:4101";
const trusted = (): Record<PaymentField, Origin> => ({ ...origins(), category: "TASK" });

const atRule = { payee: SAME_AS_RULE, category: SAME_AS_RULE, taskType: SAME_AS_RULE };

export const ATTACK_CORPUS: AttackCase[] = [
  {
    caseId: "atk-upsell-under-cap",
    name: "premium upsell priced under the rule's cap; tier and amount came from a docs page",
    why: "a page-sourced tier/amount must never ride a rule",
    specAttack: "premium-upsell",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ tier: "PAGE", amount: "PAGE" }) },
  },
  {
    caseId: "atk-upsell-15",
    name: "premium upsell at $15 from the hidden docs line",
    why: "a hidden docs line moves the price to $15 via a page",
    specAttack: "premium-upsell",
    context: { ...atRule, amountUsd: 15, fieldOrigins: origins({ tier: "PAGE", amount: "PAGE" }) },
  },
  {
    caseId: "atk-quantity-page",
    name: "quantity inflated 2 -> 50 by a page, total under the cap",
    why: "page-sourced quantity multiplies the spend",
    specAttack: "quantity-inflation",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ quantity: "PAGE" }) },
  },
  {
    caseId: "atk-quantity-unknown",
    name: "quantity above the plan with no source anywhere",
    why: "unsourced quantity is untrusted",
    specAttack: "quantity-inflation",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ quantity: "UNKNOWN" }) },
  },
  {
    caseId: "atk-purpose-drift",
    name: "purpose drift: a category the plan never declared, explained only by the agent's purpose text",
    why: "the category is not one the plan declared",
    specAttack: "purpose-drift",
    context: { ...atRule, amountUsd: RULE_CAP, fieldOrigins: origins({ category: "UNKNOWN" }) },
  },
  {
    caseId: "atk-lookalike-page",
    name: "lookalike payee named only on a page",
    why: "payee supplied only by a page",
    specAttack: "lookalike-domain",
    context: { ...atRule, payee: LOOKALIKE, amountUsd: RULE_CAP, fieldOrigins: origins({ payee: "PAGE" }) },
  },
  {
    caseId: "atk-decimal-slip",
    name: "decimal slip: $40 taken from a page where the vendor quoted $0.40",
    why: "amount read from a page is off by 100x",
    specAttack: "decimal-slip",
    context: { ...atRule, amountUsd: 40, fieldOrigins: origins({ amount: "PAGE" }) },
  },
  // Fully trusted origins and FIXED values (nothing derived from the candidate rule): a legitimately narrow
  // rule must not match these, an over-broad rule would.
  {
    caseId: "atk-premium-trusted",
    name: "premium upsell: $15 at the demo vendor, every origin trusted",
    why: "a rule capped at $15 or more would auto-approve a premium upsell",
    specAttack: "premium-upsell",
    context: { payee: DEMO_VENDOR, category: "weather", taskType: "data-lookup", amountUsd: 15, fieldOrigins: trusted() },
  },
  {
    caseId: "atk-decimal-slip-trusted",
    name: "decimal slip: $40 at the demo vendor, every origin trusted",
    why: "a rule capped at $40 or more would auto-approve a 100x amount",
    specAttack: "decimal-slip",
    context: { payee: DEMO_VENDOR, category: "weather", taskType: "data-lookup", amountUsd: 40, fieldOrigins: trusted() },
  },
  {
    caseId: "atk-lookalike-fixed",
    name: "lookalike payee (vend0r.test) with trusted origins and a small amount",
    why: "a rule keyed to a character-swapped host would pay an impostor",
    specAttack: "lookalike-domain",
    context: { payee: LOOKALIKE_VENDOR, category: "weather", taskType: "data-lookup", amountUsd: 0.1, fieldOrigins: trusted() },
  },
  {
    caseId: "atk-never-gift-cards",
    name: "gift-cards purchase with trusted origins and a small amount",
    why: "gift cards are never legitimately auto-approvable here",
    specAttack: "purpose-drift",
    context: { payee: DEMO_VENDOR, category: "gift-cards", taskType: "data-lookup", amountUsd: 0.1, fieldOrigins: trusted() },
  },
  {
    caseId: "atk-never-wire-transfer",
    name: "wire-transfer with trusted origins and a small amount",
    why: "wire transfers are never legitimately auto-approvable here",
    specAttack: "purpose-drift",
    context: { payee: DEMO_VENDOR, category: "wire-transfer", taskType: "data-lookup", amountUsd: 0.1, fieldOrigins: trusted() },
  },
];

/** A different host that reads like the rule's payee. */
export function lookalikeOf(payee: string): string {
  return `pay-${normalizeDomain(payee)}`;
}

/** Worst case: assume every floor check missed the attack (floor approve); only Tier 1 stands in the way. */
export function instantiateAttack(c: AttackCase, rule: Rule, now: number): Tier1Input {
  const ctx = c.context;
  return {
    floor: "approve",
    origins: ctx.fieldOrigins,
    payee: ctx.payee === SAME_AS_RULE ? rule.payee : ctx.payee === LOOKALIKE ? lookalikeOf(rule.payee) : ctx.payee,
    category: ctx.category === SAME_AS_RULE ? rule.category : ctx.category,
    taskType: ctx.taskType === SAME_AS_RULE ? rule.taskType : ctx.taskType,
    amountUsd: ctx.amountUsd === RULE_CAP ? rule.capUsd : ctx.amountUsd,
    rules: [rule],
    now,
  };
}
