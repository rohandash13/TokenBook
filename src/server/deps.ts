// OWNER: C — everything the routes need from lanes A, B and D, injectable for tests.
import { estimateAll } from '../estimate/estimate';
import { loadActuals } from '../ingest/loadActuals';
import { loadContexts } from '../ingest/loadContexts';
import { loadUsage } from '../ingest/loadUsage';
import { draftMemo } from '../llm/draftMemo';
import type { Actual, Estimate, Memo, MemoInput, Month, Team, TeamContext, UsageDay } from '../shared/types';

export interface Deps {
  estimateAll(month: Month, asOf: string): Estimate[] | Promise<Estimate[]>;
  loadUsage(month: Month, asOf?: string): UsageDay[] | Promise<UsageDay[]>;
  loadActuals(month: Month): Actual[] | Promise<Actual[]>;
  loadContexts(): TeamContext[] | Promise<TeamContext[]>;
  draftMemo(input: MemoInput): Promise<Memo>;
  sendCheckIn(team: Team, month: Month): Promise<void>;
}

export const defaultDeps: Deps = {
  estimateAll,
  loadUsage,
  loadActuals,
  loadContexts,
  draftMemo,
  // Lazy so Bolt only loads if a check-in is actually sent.
  sendCheckIn: async (team, month) => (await import('../slack/checkin')).sendCheckIn(team, month),
};
