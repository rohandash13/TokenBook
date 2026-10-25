// OWNER: C — everything the routes need from lanes A, B and D, injectable for tests.
import { estimateAll } from '../estimate/estimate';
import { loadActuals, loadContexts, loadUsage } from '../ingest/loadUsage';
import { draftMemo } from '../llm/draftMemo';
import { DEMO, monthsBetween } from '../shared/config';
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
  // Seed contexts for every fixture month (Junghwan's loader is per month).
  loadContexts: () => monthsBetween(DEMO.firstMonth, DEMO.month).flatMap((m) => loadContexts(m)),
  draftMemo,
  // The Slack app sends check-ins from its own process; this server cannot DM.
  sendCheckIn: async (team) => {
    throw new Error(`Check-ins are sent by the Slack app — run: npm run slack -- --checkin ${team}`);
  },
};
