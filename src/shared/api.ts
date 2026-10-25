// OWNER: C — REST request/response shapes. Not part of the types.ts contract; D's Slack flow reads PostContextResult.
import type { Estimate, JournalEntry, Memo, Method, Month, Team, TeamContext, Variance } from './types';

// POST /api/contexts takes a TeamContext and returns the team's trueup estimate before and after it.
export type PostContextResult = { context: TeamContext; before: Estimate | null; after: Estimate | null };

// Controller edits on the accrual screen: team -> trueup amount in USD.
export type Overrides = Partial<Record<Team, number>>;
export type PrepareResult = { entry: JournalEntry; estimates: Estimate[] };

// Memos as stored and served: the contract Memo plus close-workflow state.
export type StoredMemo = Memo & { attached: boolean; editedAt?: string; jiraTaskKey?: string };
export type ActualsResult = { reversal: JournalEntry; actual: JournalEntry; variances: Variance[]; memos: StoredMemo[] };

export type HistoryRow = {
  month: Month;
  team: Team;
  actual: number;
  estimates: Partial<Record<Method, number>>;
  errorPct: Partial<Record<Method, number>>; // (estimate - actual) / actual
};
export type MethodError = { method: Method; maeUsd: number; maePct: number; n: number };
export type HistoryReport = { months: Month[]; rows: HistoryRow[]; byMethod: MethodError[]; biasByTeam: Partial<Record<Team, number>> };
