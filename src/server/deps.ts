// OWNER: C — everything the routes need from lanes A, B and D, injectable for tests.
import { estimateAll } from '../estimate/estimate';
import { loadActuals, loadContexts, loadUsage, loadUsageRange } from '../ingest/loadUsage';
import { draftMemo } from '../llm/draftMemo';
import { DEMO, monthsBetween } from '../shared/config';
import type { Actual, Estimate, Memo, MemoInput, Month, Team, TeamContext, UsageDay } from '../shared/types';
import { defaultRefreshDeps, refreshSignals, type RefreshResult } from '../signals/refresh';
import { collectExternalEvents } from '../integrations/collect';
import { withExternalEvents } from '../integrations/merge';
import { refreshApify, type ApifyRefreshResult } from '../integrations/apify/refresh';
import { notifyVariance, type NotifyResult } from '../integrations/jira/notify';
import { getLlm } from '../llm/client';
import type { StoredMemo } from '../shared/api';
import type { Signal } from '../signals/types';
import { listContexts, listJiraIssues } from './store';

export interface Deps {
  estimateAll(month: Month, asOf: string): Estimate[] | Promise<Estimate[]>;
  loadUsage(month: Month, asOf?: string): UsageDay[] | Promise<UsageDay[]>;
  loadActuals(month: Month): Actual[] | Promise<Actual[]>;
  loadContexts(): TeamContext[] | Promise<TeamContext[]>;
  draftMemo(input: MemoInput): Promise<Memo>;
  sendCheckIn(team: Team, month: Month): Promise<void>;
  refreshSignals(month: Month, opts?: { offline?: boolean; teams?: readonly Team[] }): Promise<RefreshResult[]>;
  /** Opens a Jira task per variance memo via the Forge web trigger; [] when not configured. */
  notifyVariance(memos: StoredMemo[]): Promise<NotifyResult[]>;
  /** A team's Slack and GitHub signals for the month (live, or fixtures offline), cited in variance memos. */
  readSignals(team: Team, month: Month): Promise<Signal[]>;
  /** Live Apify scrape of pricing and news pages (skipped without APIFY_TOKEN). */
  refreshApify(): Promise<ApifyRefreshResult>;
}

export const defaultDeps: Deps = {
  readSignals: async (team, month) => {
    const r = defaultRefreshDeps();
    const [slack, github] = await Promise.all([r.readSlack(team, month), r.readGithub(team, month)]);
    return [...slack, ...github];
  },
  refreshSignals: (month, opts) => refreshSignals(month, defaultRefreshDeps(opts), opts?.teams),
  refreshApify: () => refreshApify({ token: process.env.APIFY_TOKEN, llm: getLlm() }),
  notifyVariance: (memos) =>
    notifyVariance(memos, listJiraIssues(), { url: process.env.FORGE_WEBTRIGGER_URL, secret: process.env.JIRA_WEBHOOK_SECRET }),
  // Contexts come from the store so a Slack reply (POST /api/contexts) moves the estimate.
  // All months are passed: the engine backtests prior months for bias.
  // Events collected by the Jira (Forge) and Apify integrations are layered onto those contexts.
  estimateAll: (month, asOf) => {
    const usage = loadUsageRange(DEMO.firstMonth, month);
    return estimateAll(month, asOf, {
      usage: () => usage,
      contexts: () => withExternalEvents(listContexts(), collectExternalEvents(asOf, usage)),
      actuals: () => loadActuals(),
    });
  },
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
