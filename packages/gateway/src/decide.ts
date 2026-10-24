import type { Payee, Decision, Rule, Verdict } from "@countersign/shared";
import { maxVerdict, type FloorResult } from "./floors";
import {
  JUDGE_INVALID_REASON,
  NO_JUDGE_REASON,
  buildJudgeInput,
  type Judge,
  type JudgeHistory,
  type JudgeResult,
} from "./judge";
import { runTier1 } from "./tier1";
import { PAYMENT_FIELDS, isTainted, type TraceResult } from "./tracer";

export interface DecideInput {
  trace: TraceResult;
  floor: FloorResult;
  taskType: string;
  rules: Rule[];
  now: number;
  judge?: Judge;
  payeeRecord?: Payee;
  budgetRemainingUsd: number;
  history: JudgeHistory;
}

export interface DecideOutput {
  verdict: Verdict;
  tier: 1 | 2 | null;
  ruleId?: string;
  reasons: string[];
  costUsd: number | null;
  judge?: { verdict: Verdict; reasons: string[] };
}

const isVerdict = (v: unknown): v is Verdict => v === "approve" || v === "hold" || v === "block";

/** Past approve/hold counts for the same payee + category (judge context only). */
export function similarHistory(decisions: Decision[], payee: string, category: string | null): JudgeHistory {
  const similar = decisions.filter((d) => d.kind === "verdict" && d.payeeDomain === payee && d.category === category);
  return {
    approvedSimilar: similar.filter((d) => d.verdict === "approve").length,
    heldSimilar: similar.filter((d) => d.verdict === "hold").length,
  };
}

async function askJudge(input: DecideInput): Promise<JudgeResult> {
  if (!input.judge) return { verdict: "hold", reasons: [NO_JUDGE_REASON], costUsd: 0, tokens: null };
  try {
    const out = await input.judge.judge(
      buildJudgeInput({
        taskType: input.taskType,
        trace: input.trace,
        budgetRemainingUsd: input.budgetRemainingUsd,
        history: input.history,
        payeeRecord: input.payeeRecord,
      }),
    );
    if (!isVerdict(out?.verdict)) return { verdict: "hold", reasons: [JUDGE_INVALID_REASON], costUsd: out?.costUsd ?? null, tokens: null };
    const reasons = Array.isArray(out.reasons) ? out.reasons.map(String) : [];
    return { ...out, reasons };
  } catch (e) {
    return { verdict: "hold", reasons: [JUDGE_INVALID_REASON, `judge error: ${e instanceof Error ? e.message : String(e)}`], costUsd: null, tokens: null };
  }
}

/** Floors -> Tier 1 -> Tier 2 -> max severity -> INV3 guard (D4, D20, D25). */
export async function decide(input: DecideInput): Promise<DecideOutput> {
  const reasons = [...input.floor.reasons];
  if (input.floor.verdict === "block") return { verdict: "block", tier: null, reasons, costUsd: 0 };

  const t1 = runTier1({
    floor: input.floor.verdict,
    origins: input.trace.origins,
    payee: input.trace.payee,
    category: input.trace.category,
    taskType: input.taskType,
    amountUsd: input.trace.amountUsd,
    rules: input.rules,
    now: input.now,
  });

  let out: DecideOutput;
  if (t1.approved) {
    reasons.push(`tier 1: active rule ${t1.ruleId} matched`);
    out = { verdict: maxVerdict(input.floor.verdict, "approve"), tier: 1, ruleId: t1.ruleId, reasons, costUsd: 0 };
  } else {
    const j = await askJudge(input);
    reasons.push(...j.reasons.map((r) => `judge: ${r}`));
    out = {
      verdict: maxVerdict(input.floor.verdict, j.verdict),
      tier: 2,
      reasons,
      costUsd: j.costUsd,
      judge: { verdict: j.verdict, reasons: j.reasons },
    };
  }

  const tainted = PAYMENT_FIELDS.filter((f) => isTainted(input.trace.origins[f]));
  if (out.verdict === "approve" && tainted.length > 0) {
    out.verdict = "hold";
    out.reasons.push(`INV3: tainted field(s) ${tainted.join(", ")} cannot be auto-approved`);
  }
  return out;
}
