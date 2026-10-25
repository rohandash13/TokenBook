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

// Integrations (Atlassian Jira via Forge; Apify scrapes). Shapes served to the web app.
export type JiraIssueView = { issue: import('../integrations/types').JiraIssueSnapshot; team: Team | null; event: import('./types').ContextEvent | null };
export type PriceImpact = { team: Team; multiplier: number; indicativeUsd: number };
export type MarketReport = {
  priceChanges: (import('../integrations/types').PriceChange & { impacts: PriceImpact[] })[];
  signals: import('../integrations/types').MarketSignal[];
};

// Budgets and spend policies (src/budgets). Status: ok, warn (at or above warnAt of the limit), over.
export type Status = 'ok' | 'warn' | 'over';
export type Policies = { warnAt: number; teamBudgets: Partial<Record<Team, number>>; modelCaps: { model: string; capUsd: number }[] };
export type TeamBudgetCheck = {
  team: Team; budgetUsd: number; projectedUsd: number; actualToDateUsd: number; pctOfBudget: number; headroomUsd: number; status: Status;
};
export type ModelCapCheck = { model: string; capUsd: number; actualToDateUsd: number; projectedUsd: number; pctOfCap: number; status: Status };
export type BudgetReport = { month: Month; asOf: string; warnAt: number; teams: TeamBudgetCheck[]; models: ModelCapCheck[]; alerts: string[] };
