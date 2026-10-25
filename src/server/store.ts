// OWNER: C — synchronous JSON store. Sync means no lock: read-modify-write cycles can't interleave.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Policies, StoredMemo } from '../shared/api';
import type { CatalogModel } from '../integrations/apify/catalog';
import type { JiraIssueSnapshot, MarketSignal, PriceSnapshot } from '../integrations/types';
import type { JournalEntry, Month, Team, TeamContext, Variance } from '../shared/types';

type Collection = 'contexts' | 'journal' | 'variances' | 'memos' | 'jiraIssues' | 'priceSnapshots' | 'marketSignals' | 'policies' | 'modelCatalog';

// Resolved on every call so tests can point TRUEUP_STORE_DIR at a fresh temp dir.
export const storeDir = (): string => process.env.TRUEUP_STORE_DIR ?? path.resolve('data/store');
const file = (name: Collection) => path.join(storeDir(), `${name}.json`);

function read<T>(name: Collection): T[] {
  try {
    return JSON.parse(readFileSync(file(name), 'utf8')) as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

function write<T>(name: Collection, items: T[]): void {
  mkdirSync(storeDir(), { recursive: true });
  const tmp = `${file(name)}.tmp`;
  writeFileSync(tmp, JSON.stringify(items, null, 2));
  renameSync(tmp, file(name));
}

const update = <T>(name: Collection, fn: (items: T[]) => T[]): void => write(name, fn(read<T>(name)));

// Contexts: one per (team, month); the latest reply wins.
export const listContexts = (month?: Month): TeamContext[] =>
  read<TeamContext>('contexts').filter((c) => !month || c.month === month);
export const upsertContext = (ctx: TeamContext): void =>
  update<TeamContext>('contexts', (xs) => [...xs.filter((x) => !(x.team === ctx.team && x.month === ctx.month)), ctx]);

// Journal entries: upsert by id.
export const listEntries = (month?: Month): JournalEntry[] =>
  read<JournalEntry>('journal').filter((e) => !month || e.month === month);
export const getEntry = (id: string): JournalEntry | null =>
  read<JournalEntry>('journal').find((e) => e.id === id) ?? null;
export const saveEntries = (...entries: JournalEntry[]): void =>
  update<JournalEntry>('journal', (xs) => [...xs.filter((x) => !entries.some((e) => e.id === x.id)), ...entries]);

// Variances: replaced wholesale per month.
export const listVariances = (month: Month): Variance[] =>
  read<Variance>('variances').filter((v) => v.month === month);
export const replaceVariances = (month: Month, vs: Variance[]): void =>
  update<Variance>('variances', (xs) => [...xs.filter((x) => x.month !== month), ...vs]);

// Memos: keyed by (month, team).
export const listMemos = (month?: Month): StoredMemo[] =>
  read<StoredMemo>('memos').filter((m) => !month || m.month === month);
export const getMemo = (month: Month, team: Team): StoredMemo | null =>
  read<StoredMemo>('memos').find((m) => m.month === month && m.team === team) ?? null;
export const saveMemo = (memo: StoredMemo): void =>
  update<StoredMemo>('memos', (xs) => [...xs.filter((x) => !(x.month === memo.month && x.team === memo.team)), memo]);
export const replaceMemos = (month: Month, ms: StoredMemo[]): void =>
  update<StoredMemo>('memos', (xs) => [...xs.filter((x) => x.month !== month), ...ms]);

// Integrations (Jira issues from the Forge app; Apify price snapshots and market signals).
export const listJiraIssues = (): JiraIssueSnapshot[] => read<JiraIssueSnapshot>('jiraIssues');
export const upsertJiraIssue = (issue: JiraIssueSnapshot): void =>
  update<JiraIssueSnapshot>('jiraIssues', (xs) => [...xs.filter((x) => x.key !== issue.key), issue]);
export const listPriceSnapshots = (): PriceSnapshot[] => read<PriceSnapshot>('priceSnapshots');
export const addPriceSnapshot = (s: PriceSnapshot): void =>
  update<PriceSnapshot>('priceSnapshots', (xs) => [...xs.filter((x) => !(x.provider === s.provider && x.fetchedAt === s.fetchedAt)), s]);
export const listMarketSignals = (): MarketSignal[] => read<MarketSignal>('marketSignals');
export const upsertMarketSignals = (ms: MarketSignal[]): void =>
  update<MarketSignal>('marketSignals', (xs) => [...xs.filter((x) => !ms.some((m) => m.id === x.id)), ...ms]);

// Model market (Apify): one row per scraped model; a refresh replaces a provider's rows.
export const listCatalog = (): CatalogModel[] => read<CatalogModel>('modelCatalog');
export const replaceCatalogProvider = (provider: string, rows: CatalogModel[]): void =>
  update<CatalogModel>('modelCatalog', (xs) => [...xs.filter((x) => x.provider !== provider), ...rows]);

// Budgets and spend policies: a single record, edited from the Budgets screen.
export const getPolicies = (): Policies | null => read<Policies>('policies')[0] ?? null;
export const savePolicies = (p: Policies): void => write<Policies>('policies', [p]);

export const resetStore = (seedContexts: TeamContext[]): void => {
  rmSync(storeDir(), { recursive: true, force: true });
  write('contexts', seedContexts);
};
