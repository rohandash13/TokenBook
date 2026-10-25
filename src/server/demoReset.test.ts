import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamContext } from '../shared/types';
import { demoReset } from './demoReset';
import { listContexts, listEntries, saveEntries } from './store';

const ctx = (team: TeamContext['team'], month: string): TeamContext => ({ team, month, replied: true, events: [] });

const noRefresh = async () => [];

beforeEach(() => {
  process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), 'trueup-reset-'));
});

describe('demoReset', () => {
  it('wipes the store and seeds everything except the live team in the demo month', async () => {
    saveEntries({ id: 'JE-x', month: '2026-10', date: '2026-10-31', kind: 'accrual', status: 'prepared', lines: [] });
    const out = await demoReset(() => [ctx('support', '2026-10'), ctx('support', '2026-09'), ctx('growth', '2026-10')], noRefresh);
    expect(out).toEqual({ contexts: 2, inferred: 0 });
    expect(listEntries()).toEqual([]);
    expect(listContexts().map((c) => `${c.team}:${c.month}`)).toEqual(['support:2026-09', 'growth:2026-10']);
  });

  it("keeps the live team's demo-month context when it has not replied", async () => {
    const noReply: TeamContext = { ...ctx('support', '2026-10'), replied: false };
    const out = await demoReset(() => [noReply, ctx('growth', '2026-10')], noRefresh);
    expect(out).toEqual({ contexts: 2, inferred: 0 });
    expect(listContexts('2026-10').find((c) => c.team === 'support')?.replied).toBe(false);
  });

  it('runs the refresh after seeding and counts teams with inferred events', async () => {
    const refresh = async () => [
      { team: 'support' as const, signals: 2, events: 1, usedLlm: false },
      { team: 'growth' as const, signals: 1, events: 0, usedLlm: false },
    ];
    const out = await demoReset(() => [ctx('growth', '2026-10')], refresh);
    expect(out).toEqual({ contexts: 1, inferred: 1 });
  });
});
