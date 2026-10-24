import {
  PAYMENT_FIELDS,
  isTainted,
  normalizeCategory,
  normalizeDomain,
  toAtomic,
  type Decision,
  type Rule,
  type Task,
} from "@countersign/shared";

/** D29: proposed rules expire after 7 days unless RULE_TTL_MS says otherwise. */
export const DEFAULT_RULE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProposeInput {
  decision: Decision;
  task: Pick<Task, "taskType">;
  approver: string;
  now: number;
  ttlMs: number;
  ruleId: string;
  holdId?: string;
}

export type Proposal = { rule: Rule; reason: string } | { rule: null; reason: string };

/**
 * Spec §9 rule chips: the narrowest rule that would have approved this exact purchase.
 * INV3: a decision with any tainted field teaches nothing; the human approval stays one-off.
 */
export function proposeRule(input: ProposeInput): Proposal {
  const { decision } = input;
  const tainted = PAYMENT_FIELDS.filter((f) => isTainted(decision.fieldOrigins[f]));
  if (tainted.length > 0) return { rule: null, reason: `tainted fields: ${tainted.join(", ")}; one-off approval only` };
  if (decision.category === null) return { rule: null, reason: "no category for this endpoint; one-off approval only" };
  if (!(input.ttlMs > 0)) throw new Error(`ttlMs must be > 0, got ${input.ttlMs}`);

  const rule: Rule = {
    ruleId: input.ruleId,
    payee: normalizeDomain(decision.payeeDomain),
    category: normalizeCategory(decision.category),
    capUsd: decision.amountUsd,
    taskType: input.task.taskType,
    expiresAt: input.now + input.ttlMs,
    createdBy: input.approver,
    status: "proposed",
    ...(input.holdId ? { sourceHoldId: input.holdId } : {}),
  };
  return {
    rule,
    reason: `narrow rule: ${rule.payee} / ${rule.category} / up to $${rule.capUsd} / ${rule.taskType} / expires ${new Date(rule.expiresAt).toISOString()}`,
  };
}

export class NarrowError extends Error {}

export interface Narrow {
  capUsd?: number;
  expiresAt?: number;
}

const NARROWABLE = new Set(["capUsd", "expiresAt"]);

/** D29: the approver may only tighten. Payee, category and task type never change; widening throws. */
export function narrowRule(rule: Rule, narrow: Narrow, now: number): Rule {
  for (const key of Object.keys(narrow)) {
    if (!NARROWABLE.has(key)) throw new NarrowError(`only capUsd and expiresAt can be narrowed; '${key}' cannot change`);
  }
  const out: Rule = { ...rule };
  if (narrow.capUsd !== undefined) {
    const cap = narrow.capUsd;
    if (typeof cap !== "number" || !Number.isFinite(cap) || toAtomic(cap) <= 0) throw new NarrowError("capUsd must be a number > 0");
    if (toAtomic(cap) > toAtomic(rule.capUsd)) throw new NarrowError(`capUsd $${cap} would widen the rule (cap is $${rule.capUsd})`);
    out.capUsd = cap;
  }
  if (narrow.expiresAt !== undefined) {
    const at = narrow.expiresAt;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= now) throw new NarrowError("expiresAt must be in the future");
    if (at > rule.expiresAt) {
      throw new NarrowError(`expiresAt would widen the rule (it expires at ${new Date(rule.expiresAt).toISOString()})`);
    }
    out.expiresAt = at;
  }
  return out;
}
