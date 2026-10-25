// OWNER: C — loads integration fixtures into the store on demo reset, so the demo runs offline.
import { existsSync, readFileSync } from 'node:fs';
import { addPriceSnapshot, replaceAnnouncementsProvider, replaceCatalogProvider, savePolicies, upsertJiraIssue, upsertMarketSignals } from '../server/store';
import type { PriceAnnouncement } from './apify/announcements';
import type { CatalogModel } from './apify/catalog';
import type { Policies } from '../shared/api';
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
  // The model market's last live scrape, saved so the offline demo shows real prices with their scrape date.
  const catalog = readFixture<CatalogModel>('models.json');
  for (const provider of new Set(catalog.map((m) => m.provider))) replaceCatalogProvider(provider, catalog.filter((m) => m.provider === provider));
  const anns = readFixture<PriceAnnouncement>('announcements.json');
  for (const provider of new Set(anns.map((a) => a.provider))) replaceAnnouncementsProvider(provider, anns.filter((a) => a.provider === provider));
  const policies = new URL('../../data/fixtures/policies.json', import.meta.url);
  if (existsSync(policies)) {
    const { warnAt, teamBudgets, modelCaps } = JSON.parse(readFileSync(policies, 'utf8')) as Policies;
    savePolicies({ warnAt, teamBudgets, modelCaps });
  }
  return { jiraIssues: issues.length, priceSnapshots: snapshots.length, marketSignals: market.length };
}
