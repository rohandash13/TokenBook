// OWNER: C
import type { ActualsResult, HistoryReport, JiraIssueView, MarketReport, Overrides, PostContextResult, PrepareResult, StoredMemo } from '../../src/shared/api';
import type { ContextEvent, Estimate, JournalEntry, Month, Team, TeamContext, Variance } from '../../src/shared/types';
import { DEMO } from '../../src/shared/config';

export type SignalRefreshResult = {
  team: Team; signals: number | unknown[]; events: ContextEvent[] | number; usedLlm: boolean; skipped?: 'lead replied';
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

export type ApifyRefreshResult = { priceSnapshots: number; marketSignals: number; errors: string[]; skipped?: string };

export const api = {
  jiraIssues: () => req<JiraIssueView[]>('/api/integrations/jira/issues'),
  market: () => req<MarketReport>('/api/integrations/market'),
  refreshApify: () => req<ApifyRefreshResult>('/api/integrations/apify/refresh', { method: 'POST', body: '{}' }),
  estimates: (month: Month) => req<Estimate[]>(`/api/estimates?month=${month}`),
  contexts: (month: Month) => req<TeamContext[]>(`/api/contexts?month=${month}`),
  getContexts: (month: Month) => req<TeamContext[]>(`/api/contexts?month=${month}`),
  refreshSignals: (month: Month, offline?: boolean) =>
    post<{ results: SignalRefreshResult[] }>(`/api/signals/refresh?month=${month}`, offline === undefined ? {} : { offline }),
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
  history: () => req<HistoryReport>('/api/history'),
  checkin: (team: Team) => post<{ ok: true }>('/api/demo/checkin', { team }),
  reset: () => post<{ ok: true; contexts: number }>('/api/demo/reset'),
};
