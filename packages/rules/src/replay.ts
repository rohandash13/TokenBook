import type { Decision, Hold, ReplayResult, Rule, Task } from "@countersign/shared";
import { instantiateAttack, type AttackCase } from "./attack-corpus";
import { matchTier1, type Tier1Input } from "./match";

export interface ReplayContext {
  decisions: Decision[];
  tasks: Map<string, Task>;
  holds: Hold[];
  attackCorpus: AttackCase[];
  activeRules: Rule[];
  now: number;
}

/** A logged decision as Tier 1 saw it. Floor = approve iff no floor check fired. Unknown task -> "" (never matches). */
export function decisionTier1Input(d: Decision, taskType: string, rules: Rule[], now: number): Tier1Input {
  return {
    floor: d.floorReasons.length === 0 ? "approve" : "hold",
    origins: d.fieldOrigins,
    payee: d.payeeDomain,
    category: d.category,
    taskType,
    amountUsd: d.amountUsd,
    rules,
    now,
  };
}

/** Spec §9 replay (D30): the same matcher Tier 1 uses, over every stored verdict decision and the attack corpus. */
export function replayRule(candidate: Rule, ctx: ReplayContext): ReplayResult {
  const asActive: Rule = { ...candidate, status: "active" };
  const existing = ctx.activeRules.filter((r) => r.status === "active" && r.ruleId !== candidate.ruleId);
  const rejected = new Map(ctx.holds.filter((h) => h.status === "rejected").map((h) => [h.decisionId, h]));

  let decisionsChecked = 0;
  let wouldAutoApprove = 0;
  let newlyAutoApproved = 0;
  const knownBadMatched: ReplayResult["knownBadMatched"] = [];

  for (const d of ctx.decisions) {
    if (d.kind !== "verdict") continue;
    decisionsChecked++;
    const taskType = ctx.tasks.get(d.taskId)?.taskType ?? "";
    const base = decisionTier1Input(d, taskType, [], ctx.now);
    if (taskType === "") continue; // unknown task: never matches
    const byExisting = matchTier1({ ...base, rules: existing }) !== undefined;
    const byCandidate = matchTier1({ ...base, rules: [asActive] }) !== undefined;
    if (byExisting || byCandidate) wouldAutoApprove++;
    if (byCandidate && !byExisting) newlyAutoApproved++;
    if (!byCandidate) continue;
    const hold = rejected.get(d.decisionId);
    if (hold) {
      knownBadMatched.push({ decisionId: d.decisionId, why: `hold ${hold.holdId} was rejected by ${hold.resolvedBy ?? "an approver"}` });
    } else if (d.verdict === "block") {
      knownBadMatched.push({ decisionId: d.decisionId, why: `blocked: ${d.reasons.join("; ") || "block"}` });
    }
  }

  const attacksMatched = ctx.attackCorpus
    .filter((c) => matchTier1(instantiateAttack(c, asActive, ctx.now)) !== undefined)
    .map((c) => ({ caseId: c.caseId, name: c.name }));
  const attacksChecked = ctx.attackCorpus.length;
  const casesChecked = decisionsChecked + attacksChecked;

  return {
    ranAt: ctx.now,
    decisionsChecked,
    attacksChecked,
    casesChecked,
    wouldAutoApprove,
    newlyAutoApproved,
    knownBadMatched,
    attacksMatched,
    summary: `${casesChecked} ${casesChecked === 1 ? "case" : "cases"}, ${attacksMatched.length} attacks matched, ${knownBadMatched.length} known-bad matched`,
  };
}

/** Activation gate: refuse if any attack or known-bad decision would be auto-approved. */
export function replayPassed(r: ReplayResult): boolean {
  return r.attacksMatched.length === 0 && r.knownBadMatched.length === 0;
}
