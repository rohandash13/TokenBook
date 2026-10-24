import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredMemo } from '../shared/api';
import type { JournalEntry, TeamContext } from '../shared/types';
import {
  getEntry, getMemo, listContexts, listEntries, listMemos, listVariances, replaceMemos,
  replaceVariances, resetStore, saveEntries, saveMemo, upsertContext,
} from './store';

const ctx = (team: TeamContext['team'], quote: string, month = '2026-10'): TeamContext => ({
  team, month, replied: true, leadName: 'X', quote, events: [], repliedAt: '2026-10-25T00:00:00Z',
});
const entry = (id: string, month = '2026-10'): JournalEntry => ({
  id, month, date: `${month}-31`, kind: 'accrual', lines: [], status: 'prepared',
});
const memo = (team: StoredMemo['team'], text: string, month = '2026-10'): StoredMemo => ({
  team, month, estimate: 1, actual: 2, variancePct: 1, basis: 'b', approvedBy: 'Dana', sources: [],
  text, createdAt: '2026-11-01T00:00:00Z', attached: false,
});

beforeEach(() => {
  process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), 'trueup-'));
});

describe('store', () => {
  it('returns empty lists before anything is written', () => {
    expect(listContexts()).toEqual([]);
    expect(listEntries()).toEqual([]);
    expect(listMemos()).toEqual([]);
    expect(listVariances('2026-10')).toEqual([]);
  });
  it('upserts contexts by team and month (latest wins)', () => {
    upsertContext(ctx('support', 'first'));
    upsertContext(ctx('support', 'second'));
    upsertContext(ctx('support', 'september', '2026-09'));
    const oct = listContexts('2026-10');
    expect(oct).toHaveLength(1);
    expect(oct[0].quote).toBe('second');
    expect(listContexts()).toHaveLength(2);
  });
  it('keeps both months when a second upsert is for another month', () => {
    upsertContext(ctx('support', 'oct'));
    upsertContext(ctx('support', 'nov', '2026-11'));
    expect(listContexts('2026-10')[0].quote).toBe('oct');
    expect(listContexts('2026-11')[0].quote).toBe('nov');
  });
  it('saves entries by id and filters by month', () => {
    saveEntries(entry('A'), entry('B'));
    saveEntries({ ...entry('A'), status: 'approved' }, entry('C', '2026-09'));
    expect(listEntries('2026-10').map((e) => e.id).sort()).toEqual(['A', 'B']);
    expect(getEntry('A')?.status).toBe('approved');
    expect(getEntry('nope')).toBeNull();
  });
  it('replaces variances per month', () => {
    const v = (team: 'support' | 'search', month: string) => ({
      team, month, estimate: 1, actual: 2, varianceUsd: 1, variancePct: 1, needsMemo: false,
    });
    replaceVariances('2026-10', [v('support', '2026-10'), v('search', '2026-10')]);
    replaceVariances('2026-09', [v('support', '2026-09')]);
    replaceVariances('2026-10', [v('search', '2026-10')]);
    expect(listVariances('2026-10').map((x) => x.team)).toEqual(['search']);
    expect(listVariances('2026-09')).toHaveLength(1);
  });
  it('keys memos by month and team', () => {
    saveMemo(memo('support', 'one'));
    saveMemo(memo('support', 'two'));
    saveMemo(memo('search', 'other'));
    saveMemo(memo('support', 'sep', '2026-09'));
    expect(listMemos('2026-10')).toHaveLength(2);
    expect(getMemo('2026-10', 'support')?.text).toBe('two');
    expect(getMemo('2026-10', 'growth')).toBeNull();
    replaceMemos('2026-10', [memo('growth', 'g')]);
    expect(listMemos('2026-10').map((m) => m.team)).toEqual(['growth']);
    expect(listMemos('2026-09')).toHaveLength(1);
  });
  it('reset wipes everything and seeds contexts', () => {
    upsertContext(ctx('support', 'old'));
    saveEntries(entry('A'));
    resetStore([ctx('growth', 'seed')]);
    expect(listContexts().map((c) => c.quote)).toEqual(['seed']);
    expect(listEntries()).toEqual([]);
  });
});
