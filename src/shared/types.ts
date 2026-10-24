// OWNER: C (copied verbatim from docs/SPEC.md; Rohan's skeleton version wins on merge)
export type Team = "support" | "search" | "growth" | "platform";
export type Month = string; // "2026-10"

export type UsageDay = { date: string; team: Team; model: string; costUsd: number; inputTokens: number; outputTokens: number; source: "anthropic" | "openai" };

export type TeamContext = {
  team: Team; month: Month; replied: boolean;
  events: { date: string; multiplier: number; note: string }[]; // e.g. launch on 2026-10-27, 3x
  quote?: string; repliedAt?: string; leadName?: string;
};

export type Method = "lastmonth" | "runrate" | "trueup";
export type Estimate = {
  team: Team; month: Month; asOf: string; method: Method;
  actualToDate: number; estimate: number;
  confidence: "high" | "medium" | "low"; basis: string; biasSuggestionPct?: number;
};

export type Actual = { team: Team; month: Month; actualUsd: number };

export type JournalLine = { account: string; team?: Team; debit: number; credit: number; memo: string; evidence: string[] };
export type JournalEntry = { id: string; month: Month; date: string; kind: "accrual" | "reversal" | "actual"; lines: JournalLine[]; status: "prepared" | "approved" | "exported"; approvedBy?: string };

export type Variance = { team: Team; month: Month; estimate: number; actual: number; varianceUsd: number; variancePct: number; needsMemo: boolean };

export type MemoInput = { team: Team; month: Month; estimate: number; actual: number; variancePct: number; basis: string; quote?: string; approvedBy: string; sources: string[] };
export type Memo = MemoInput & { text: string; createdAt: string };
