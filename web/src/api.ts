import type { FlagReviewBody, FlagReviewResult, FlagReview } from '../../src/shared/flagReviews';
// OWNER: C
import type { ActualsResult, BudgetReport, HistoryReport, JiraIssueView, MarketReport, Policies, Overrides, PostContextResult, PrepareResult, StoredMemo } from '../../src/shared/api';
import type { ContextEvent, Estimate, JournalEntry, Month, Team, TeamContext, Variance } from '../../src/shared/types';
import { DEMO } from '../../src/shared/config';
import type { Signal } from '../../src/signals/types';

export type SignalItem = Signal;

export type SignalRefreshResult = {
  team: Team; signals: number | unknown[]; events: ContextEvent[] | number; usedLlm: boolean; skipped?: 'lead replied' | 'source unavailable';
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
const post = <T>(path: string, body: unknown = {}) => req<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => req<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export type CatalogModelView = {
  provider: string; model: string; inputPerMTok: number; outputPerMTok: number; blendedPerMTok: number;
  tier: 'light' | 'mid' | 'frontier'; openWeight: boolean; contextWindow?: string; bestFor?: string; url: string; via?: string; fetchedAt: string;
};

export type WorkflowOptionView = {
  model: string; provider: string; tier: 'light' | 'mid' | 'frontier'; blendedPerMTok: number; openWeight: boolean; via?: string;
  url: string; bestFor?: string; monthlySavingsUsd: number; savingsPct: number; tradeoff: string;
  priceChange?: { effectiveDate: string; newBlendedPerMTok: number; savingsAfterUsd: number };
};
export type WorkflowPlanView = {
  team: Team; task: string; minTier: 'light' | 'mid' | 'frontier'; currentModel: string; currentProvider: string;
  currentTier: 'light' | 'mid' | 'frontier'; currentBlendedPerMTok: number; taskSpendUsd: number; options: WorkflowOptionView[];
};
export type AnnouncementView = {
  provider: string; model: string; effectiveDate: string; currentInputPerMTok: number; newInputPerMTok: number;
  currentOutputPerMTok?: number; newOutputPerMTok?: number; currentBlendedPerMTok: number; newBlendedPerMTok: number;
  changePct: number; excerpt: string; url: string; fetchedAt: string;
};
export type OptimizerReport = {
  month: Month; asOf: string; plans: WorkflowPlanView[];
  outlook: { month: Month; label: string; currentModelsUsd: number; recommendedPlanUsd: number; notes: string[] }[];
  announcements: AnnouncementView[];
  whatIfs: { provider: string; model: string; effectiveDate: string; team: Team; task: string; savingsNowUsd: number; savingsAfterUsd: number; text: string }[];
};

export type ApifyRefreshResult = { priceSnapshots: number; marketSignals: number; errors: string[]; skipped?: string };

export const api = {
  jiraIssues: () => req<JiraIssueView[]>('/api/integrations/jira/issues'),
  jiraProject: () => req<{ projectKey: string; url: string; siteUrl: string }>('/api/integrations/jira/project'),
  budgets: (month: Month) => req<BudgetReport>(`/api/budgets?month=${month}`),
  models: () => req<CatalogModelView[]>('/api/integrations/models'),
  optimizer: () => req<OptimizerReport>('/api/integrations/optimizer'),
  refreshModels: () => req<{ models: number; announcements: number; byProvider: Record<string, number>; errors: string[]; skipped?: string }>('/api/integrations/models/refresh', { method: 'POST', body: '{}' }),
  policies: () => req<Policies>('/api/policies'),
  savePolicies: (p: Policies) => req<Policies>('/api/policies', { method: 'PUT', body: JSON.stringify(p) }),
  market: () => req<MarketReport>('/api/integrations/market'),
  refreshApify: () => req<ApifyRefreshResult>('/api/integrations/apify/refresh', { method: 'POST', body: '{}' }),
  estimates: (month: Month) => req<Estimate[]>(`/api/estimates?month=${month}`),
  contexts: (month: Month) => req<TeamContext[]>(`/api/contexts?month=${month}`),
  getContexts: (month: Month) => req<TeamContext[]>(`/api/contexts?month=${month}`),
  refreshSignals: (month: Month, offline?: boolean) =>
    post<{ results: SignalRefreshResult[] }>(`/api/signals/refresh?month=${month}`, offline === undefined ? {} : { offline }),
  signals: (month: Month, team: Team) => req<SignalItem[]>(`/api/signals?month=${month}&team=${team}`),
  postContext: (body: TeamContext) => post<PostContextResult>('/api/contexts', body),
  journal: (month: Month) => req<JournalEntry[]>(`/api/journal?month=${month}`),
  prepare: (month: Month, overrides: Overrides) => post<PrepareResult>(`/api/close/${month}/prepare`, { overrides }),
  approve: (id: string) => post<JournalEntry>(`/api/journal/${id}/approve`, { approvedBy: DEMO.controller }),
  exportUrl: (id: string) => `/api/journal/${id}/export.csv`,
  loadActuals: (month: Month) => post<ActualsResult>(`/api/close/${month}/actuals`),
  variances: (month: Month) => req<Variance[]>(`/api/variances?month=${month}`),
  memos: (month: Month) => req<StoredMemo[]>(`/api/memos?month=${month}`),
  editMemo: (month: Month, team: Team, text: string) => put<StoredMemo>(`/api/memos/${month}/${team}`, { text }),
  attachMemo: (month: Month, team: Team) => post<StoredMemo>(`/api/memos/${month}/${team}/attach`),
  resolveFlag: (team: Team, body: FlagReviewBody) => post<FlagReviewResult>(`/api/contexts/${team}/resolve-flag`, body),
  flagReviews: (month: Month) => req<FlagReview[]>(`/api/flag-reviews?month=${month}`),
  history: () => req<HistoryReport>('/api/history'),
  checkin: (team: Team) => post<{ ok: true }>('/api/demo/checkin', { team }),
  reset: () => post<{ ok: true; contexts: number }>('/api/demo/reset'),
};
