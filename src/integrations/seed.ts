// OWNER: C — loads integration fixtures into the store on demo reset, so the demo runs offline.
import { existsSync, readFileSync } from 'node:fs';
import { addPriceSnapshot, upsertJiraIssue, upsertMarketSignals } from '../server/store';
import { JIRA } from './config';
import type { JiraIssueSnapshot, MarketSignal, PriceSnapshot } from './types';

const DIR = new URL('../../data/fixtures/integrations/', import.meta.url);

function readFixture<T>(name: string): T[] {
  const url = new URL(name, DIR);
  return existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as T[]) : [];
}

export function seedIntegrations(): { jiraIssues: number; priceSnapshots: number; marketSignals: number } {
  // The live issue is held back: the presenter creates it in Jira and the Forge app sends it in.
  const issues = readFixture<JiraIssueSnapshot>('jira.json').filter((i) => i.key !== JIRA.liveIssueKey);
  issues.forEach(upsertJiraIssue);
  const snapshots = readFixture<PriceSnapshot>('prices.json');
  snapshots.forEach(addPriceSnapshot);
  const market = readFixture<MarketSignal>('market.json');
  if (market.length) upsertMarketSignals(market);
  return { jiraIssues: issues.length, priceSnapshots: snapshots.length, marketSignals: market.length };
}
