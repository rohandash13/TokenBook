// OWNER: C — synchronous JSON store. Sync means no lock: read-modify-write cycles can't interleave.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StoredMemo } from '../shared/api';
import type { JournalEntry, Month, Team, TeamContext, Variance } from '../shared/types';

type Collection = 'contexts' | 'journal' | 'variances' | 'memos';

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

export const resetStore = (seedContexts: TeamContext[]): void => {
  rmSync(storeDir(), { recursive: true, force: true });
  write('contexts', seedContexts);
};
