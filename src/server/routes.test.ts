import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActualsResult, HistoryReport, PostContextResult, PrepareResult, StoredMemo } from '../shared/api';
import type { Estimate, JournalEntry } from '../shared/types';
import type { Deps } from './deps';
import { createApp } from './routes';
import { saveEntries } from './store';
import { fakeDeps } from './testDeps';

let server: Server | undefined;
let base = '';

const close = () =>
  new Promise<void>((r) => (server ? server.close(() => r()) : r())).then(() => { server = undefined; });

// Start the app on an ephemeral port. Call again to swap in different deps.
async function setup(overrides: Partial<Deps> = {}) {
  await close();
  server = createApp(fakeDeps(overrides)).listen(0);
  await new Promise((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = (path: string) => fetch(base + path);
const send = (method: string, path: string, body: unknown = {}) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const post = (path: string, body: unknown = {}) => send('POST', path, body);
const put = (path: string, body: unknown) => send('PUT', path, body);

beforeEach(async () => {
  process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), 'trueup-'));
  await setup();
});
afterEach(close);

describe('health and usage', () => {
  it('GET /api/health', async () => {
    expect(await (await get('/api/health')).json()).toEqual({ ok: true });
  });
  it('GET /api/usage returns usage days and rejects a bad asOf', async () => {
    const res = await get('/api/usage');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect((await get('/api/usage?asOf=10-25')).status).toBe(400);
  });
});

describe('estimates and contexts', () => {
  it('GET /api/estimates defaults to the demo month and as-of', async () => {
    const res = await get('/api/estimates');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Estimate[];
    expect(body).toHaveLength(12);
    expect(body[0].asOf).toBe('2026-10-25');
    expect(body[0].month).toBe('2026-10');
  });

  it('rejects a bad month', async () => {
    const res = await get('/api/estimates?month=2026-13');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/month/i);
  });

  it('turns unexpected errors into a JSON 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setup({ estimateAll: () => { throw new Error('boom'); } });
    const res = await get('/api/estimates');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('boom');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('maps malformed JSON to 400 and passes other 4xx errors through', async () => {
    const bad = await fetch(base + '/api/contexts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('Invalid JSON body');
    const big = await post('/api/contexts', { quote: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
  });

  it('POST /api/contexts stores the reply and returns before/after estimates', async () => {
    const res = await post('/api/contexts', {
      team: 'support', month: '2026-10', replied: true, quote: 'launching Oct 27, expect about 3x',
      events: [{ date: '2026-10-27', multiplier: 3, note: 'Support launch' }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PostContextResult;
    expect(body.before?.method).toBe('trueup');
    expect(body.before?.estimate).toBe(7590);
    expect(body.after?.estimate).toBe(10040);
    expect(body.context.leadName).toBe('Priya');
    expect(body.context.repliedAt).toBeTruthy();

    const list = (await (await get('/api/contexts?month=2026-10')).json()) as unknown[];
    expect(list).toHaveLength(1);
  });

  it('POST /api/contexts validates the body', async () => {
    const res = await post('/api/contexts', { team: 'marketing', month: '2026-10' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/team/);
  });
});

describe('evidence url validation', () => {
  const body = (url: string) => ({
    team: 'support', month: '2026-10', replied: false,
    events: [{ date: '2026-10-27', multiplier: 3, note: 'launch', evidence: [{ source: 'slack', id: 'x', url, text: 't', date: '2026-10-20' }] }],
  });
  it('rejects javascript: urls and urls containing |', async () => {
    expect((await post('/api/contexts', body('javascript:alert(1)'))).status).toBe(400);
    expect((await post('/api/contexts', body('https://example.com/a|b'))).status).toBe(400);
    expect((await post('/api/contexts', body('http://example.com/a'))).status).toBe(400);
  });
  it('accepts a plain https url', async () => {
    expect((await post('/api/contexts', body('https://slack.com/archives/C1/p1'))).status).toBe(201);
  });
});

const ACCRUAL = 'JE-2026-10-ACCRUAL';
const lineFor = (entry: JournalEntry, team: string) => entry.lines.find((l) => l.team === team)!;

describe('accrual close', () => {
  it('prepares a balanced accrual from trueup estimates', async () => {
    const res = await post('/api/close/2026-10/prepare');
    expect(res.status).toBe(200);
    const { entry, estimates } = (await res.json()) as PrepareResult;
    expect(entry).toMatchObject({ id: ACCRUAL, status: 'prepared', date: '2026-10-31' });
    expect(lineFor(entry, 'support').debit).toBe(7590);
    expect(estimates).toHaveLength(4);
    expect(estimates.every((e) => e.method === 'trueup')).toBe(true);
  });

  it('applies controller overrides', async () => {
    const { entry } = (await (await post('/api/close/2026-10/prepare', { overrides: { growth: 7000 } })).json()) as PrepareResult;
    expect(lineFor(entry, 'growth').debit).toBe(7000);
    expect(lineFor(entry, 'growth').evidence).toContain('override:controller');
  });

  it('rejects negative overrides', async () => {
    expect((await post('/api/close/2026-10/prepare', { overrides: { growth: -1 } })).status).toBe(400);
  });

  it('blocks export until approved, then exports CSV and marks exported', async () => {
    await post('/api/close/2026-10/prepare');
    expect((await get(`/api/journal/${ACCRUAL}/export.csv`)).status).toBe(409);

    const approved = (await (await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: 'Dana' })).json()) as JournalEntry;
    expect(approved).toMatchObject({ status: 'approved', approvedBy: 'Dana' });

    const csv = await get(`/api/journal/${ACCRUAL}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toBe(`attachment; filename="${ACCRUAL}.csv"`);
    expect((await csv.text()).split('\n')[0]).toBe('date,je_id,account,team,debit,credit,memo,evidence');

    const list = (await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[];
    expect(list[0].status).toBe('exported');
  });

  it('requires approvedBy to approve', async () => {
    await post('/api/close/2026-10/prepare');
    expect((await post(`/api/journal/${ACCRUAL}/approve`, {})).status).toBe(400);
    expect((await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: '  ' })).status).toBe(400);
  });

  it('refuses to approve an exported entry and leaves it unchanged', async () => {
    await approveAccrual();
    await get(`/api/journal/${ACCRUAL}/export.csv`);
    const res = await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: 'Mallory' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/exported/);
    const [entry] = (await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[];
    expect(entry).toMatchObject({ status: 'exported', approvedBy: 'Dana' });
  });

  it('refuses to approve twice', async () => {
    await post('/api/close/2026-10/prepare');
    expect((await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: 'Dana' })).status).toBe(200);
    expect((await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: 'Other' })).status).toBe(409);
    const [entry] = (await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[];
    expect(entry.approvedBy).toBe('Dana');
  });

  it('refuses to re-prepare an approved or exported accrual', async () => {
    await post('/api/close/2026-10/prepare');
    await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: 'Dana' });
    expect((await post('/api/close/2026-10/prepare')).status).toBe(409);
    await get(`/api/journal/${ACCRUAL}/export.csv`);
    expect((await post('/api/close/2026-10/prepare')).status).toBe(409);
  });

  it('re-preparing a prepared accrual replaces it', async () => {
    await post('/api/close/2026-10/prepare');
    const { entry } = (await (await post('/api/close/2026-10/prepare', { overrides: { growth: 1 } })).json()) as PrepareResult;
    expect(lineFor(entry, 'growth').debit).toBe(1);
    expect(((await (await get('/api/journal?month=2026-10')).json()) as unknown[])).toHaveLength(1);
  });

  it('404s on unknown entries, 400s on non-accruals, and lists the month journal', async () => {
    expect((await post('/api/journal/JE-nope/approve', { approvedBy: 'Dana' })).status).toBe(404);
    expect((await get('/api/journal/JE-nope/export.csv')).status).toBe(404);
    expect((await get('/api/journal?month=2026-10')).status).toBe(200);
    await post('/api/close/2026-10/prepare');
    const list = (await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[];
    expect(list.map((e) => e.id)).toEqual([ACCRUAL]);
    saveEntries({ ...list[0], id: 'JE-2026-10-REVERSAL', kind: 'reversal' });
    expect((await post('/api/journal/JE-2026-10-REVERSAL/approve', { approvedBy: 'Dana' })).status).toBe(400);
  });
});

async function approveAccrual() {
  await post('/api/close/2026-10/prepare');
  await post(`/api/journal/${ACCRUAL}/approve`, { approvedBy: 'Dana' });
}

describe('actuals and reports', () => {
  it('requires an approved accrual', async () => {
    expect((await post('/api/close/2026-10/actuals')).status).toBe(409);
    await post('/api/close/2026-10/prepare');
    expect((await post('/api/close/2026-10/actuals')).status).toBe(409);
  });

  it('404s when there are no actuals', async () => {
    await setup({ loadActuals: () => [] });
    await approveAccrual();
    expect((await post('/api/close/2026-10/actuals')).status).toBe(404);
  });

  it('404s when the actuals are for another month', async () => {
    await setup({ loadActuals: () => [{ team: 'support', month: '2026-09', actualUsd: 1 }] });
    await approveAccrual();
    expect((await post('/api/close/2026-10/actuals')).status).toBe(404);
  });

  it('posts reversal and actual, computes variances and drafts memos for flagged teams', async () => {
    await approveAccrual();
    const res = await post('/api/close/2026-10/actuals');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActualsResult;
    expect(body.reversal).toMatchObject({ id: 'JE-2026-10-REVERSAL', date: '2026-11-01', status: 'approved', approvedBy: 'Dana' });
    expect(body.actual).toMatchObject({ id: 'JE-2026-10-ACTUAL', date: '2026-11-01', status: 'approved', approvedBy: 'Dana' });
    expect(body.variances).toHaveLength(4);
    expect(body.variances.filter((v) => v.needsMemo).map((v) => v.team).sort()).toEqual(['growth', 'support']);
    expect(body.memos.map((m) => m.team).sort()).toEqual(['growth', 'support']);
    expect(body.memos[0]).toMatchObject({ attached: false, month: '2026-10' });
    expect(body.memos.find((m) => m.team === 'growth')?.text).toBe('LLM memo for growth');

    expect(((await (await get('/api/journal?month=2026-10')).json()) as unknown[])).toHaveLength(3);
    expect(((await (await get('/api/variances?month=2026-10')).json()) as unknown[])).toHaveLength(4);
    expect(((await (await get('/api/memos?month=2026-10')).json()) as unknown[])).toHaveLength(2);
  });

  it('is idempotent and works once the accrual is exported', async () => {
    await approveAccrual();
    await get(`/api/journal/${ACCRUAL}/export.csv`);
    await post('/api/close/2026-10/actuals');
    await post('/api/close/2026-10/actuals');
    expect(((await (await get('/api/journal?month=2026-10')).json()) as unknown[])).toHaveLength(3);
    expect(((await (await get('/api/memos?month=2026-10')).json()) as unknown[])).toHaveLength(2);
    expect(((await (await get('/api/variances?month=2026-10')).json()) as unknown[])).toHaveLength(4);
    // reversal and actual entries can be exported too
    expect((await get('/api/journal/JE-2026-10-REVERSAL/export.csv')).status).toBe(200);
    await post('/api/close/2026-10/actuals');
    const rev = ((await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[]).find((e) => e.kind === 'reversal');
    expect(rev?.status).toBe('exported');
  });

  it('falls back to a placeholder memo when draftMemo throws', async () => {
    await setup({ draftMemo: async () => { throw new Error('LLM down'); } });
    await approveAccrual();
    const { memos } = (await (await post('/api/close/2026-10/actuals')).json()) as ActualsResult;
    expect(memos).toHaveLength(2);
    expect(memos.every((m) => m.text.length > 0)).toBe(true);
    expect(memos.find((m) => m.team === 'support')?.text).toContain('did not reply');
  });

  it('edits and attaches memos', async () => {
    await approveAccrual();
    await post('/api/close/2026-10/actuals');
    const edited = (await (await put('/api/memos/2026-10/growth', { text: '  Campaign slipped to November.  ' })).json()) as StoredMemo;
    expect(edited).toMatchObject({ text: 'Campaign slipped to November.', attached: false });
    expect(edited.editedAt).toBeTruthy();
    const attached = (await (await post('/api/memos/2026-10/growth/attach')).json()) as StoredMemo;
    expect(attached).toMatchObject({ attached: true, text: 'Campaign slipped to November.' });
    expect((await put('/api/memos/2026-10/growth', { text: '   ' })).status).toBe(400);
    expect((await put('/api/memos/2026-10/growth', {})).status).toBe(400);
    expect((await put('/api/memos/2026-10/search', { text: 'x' })).status).toBe(404);
    expect((await post('/api/memos/2026-10/search/attach')).status).toBe(404);
    expect((await post('/api/memos/2026-10/marketing/attach')).status).toBe(404);
  });

  it('keeps memo edits and attachments when actuals are re-run', async () => {
    const draftMemo = vi.fn(fakeDeps().draftMemo);
    await setup({ draftMemo });
    await approveAccrual();
    await post('/api/close/2026-10/actuals');
    expect(draftMemo).toHaveBeenCalledTimes(2);
    const edited = (await (await put('/api/memos/2026-10/growth', { text: 'Campaign slipped.' })).json()) as StoredMemo;
    await post('/api/memos/2026-10/growth/attach');

    const { memos } = (await (await post('/api/close/2026-10/actuals')).json()) as ActualsResult;
    expect(draftMemo).toHaveBeenCalledTimes(2);
    const stored = (await (await get('/api/memos?month=2026-10')).json()) as StoredMemo[];
    for (const list of [memos, stored]) {
      expect(list).toHaveLength(2);
      expect(list.find((m) => m.team === 'growth')).toMatchObject({ text: 'Campaign slipped.', editedAt: edited.editedAt, attached: true });
    }
  });

  it('returns entries as stored on re-run, keeping exported status', async () => {
    await approveAccrual();
    await post('/api/close/2026-10/actuals');
    await get('/api/journal/JE-2026-10-REVERSAL/export.csv');
    const body = (await (await post('/api/close/2026-10/actuals')).json()) as ActualsResult;
    const stored = (await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[];
    expect(body.reversal.status).toBe('exported');
    expect(stored.find((e) => e.id === body.reversal.id)).toEqual(body.reversal);
    expect(stored.find((e) => e.id === body.actual.id)).toEqual(body.actual);
  });

  it('reports history by method and bias by team', async () => {
    const base = fakeDeps();
    await setup({
      estimateAll: (month, asOf) =>
        Promise.resolve(base.estimateAll(month, asOf)).then((es) =>
          es.map((e) => (e.month === '2026-10' && e.method === 'trueup' && e.team === 'growth' ? { ...e, biasSuggestionPct: 0.3 } : e))),
    });
    const res = await get('/api/history');
    expect(res.status).toBe(200);
    const report = (await res.json()) as HistoryReport;
    expect(report.byMethod.map((m) => m.method)).toEqual(['lastmonth', 'runrate', 'trueup']);
    expect(report.months[0]).toBe('2026-03');
    expect(report.months.at(-1)).toBe('2026-09');
    expect(report.rows).toHaveLength(28);
    expect(report.biasByTeam).toEqual({ growth: 0.3 });
  });
});

describe('history robustness', () => {
  it('skips a month whose estimates throw and still returns the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = fakeDeps();
    await setup({
      estimateAll: (month, asOf) => {
        if (month === '2026-05') throw new Error('boom');
        return base.estimateAll(month, asOf);
      },
    });
    const res = await get('/api/history');
    expect(res.status).toBe(200);
    const report = (await res.json()) as HistoryReport;
    expect(report.months).not.toContain('2026-05');
    expect(report.months).toHaveLength(6);
    expect(report.rows).toHaveLength(24);
    warn.mockRestore();
  });

  it('includes the demo month once its actuals are loaded', async () => {
    await approveAccrual();
    await post('/api/close/2026-10/actuals');
    const report = (await (await get('/api/history')).json()) as HistoryReport;
    expect(report.months.at(-1)).toBe('2026-10');
    expect(report.rows).toHaveLength(32);
  });
});

describe('prepare guards', () => {
  it('rejects overrides above the cap', async () => {
    expect((await post('/api/close/2026-10/prepare', { overrides: { support: 1_000_000_001 } })).status).toBe(400);
    expect((await post('/api/close/2026-10/prepare', { overrides: { support: 1_000_000_000 } })).status).toBe(200);
  });

  it('409s and keeps the entry when it was approved while estimates were loading', async () => {
    const base = fakeDeps();
    await post('/api/close/2026-10/prepare');
    await setup({
      estimateAll: async (month, asOf) => {
        await post('/api/journal/JE-2026-10-ACCRUAL/approve', { approvedBy: 'Dana' });
        return base.estimateAll(month, asOf);
      },
    });
    expect((await post('/api/close/2026-10/prepare')).status).toBe(409);
    const [entry] = (await (await get('/api/journal?month=2026-10')).json()) as JournalEntry[];
    expect(entry.status).toBe('approved');
  });
});

describe('demo routes', () => {
  it('reset clears the store and seeds contexts except the live team for the demo month', async () => {
    await approveAccrual();
    expect(await (await post('/api/demo/reset')).json()).toMatchObject({ ok: true, contexts: 1, inferred: 0, jiraIssues: 4 });
    expect(await (await get('/api/journal?month=2026-10')).json()).toEqual([]);
    const ctxs = (await (await get('/api/contexts?month=2026-10')).json()) as { team: string }[];
    expect(ctxs.map((c) => c.team)).toEqual(['growth']);
  });

  it('checkin calls sendCheckIn, validates the team and reports Slack failures as 502', async () => {
    const calls: string[] = [];
    await setup({ sendCheckIn: async (team, month) => { calls.push(`${team}:${month}`); } });
    expect((await post('/api/demo/checkin', { team: 'support' })).status).toBe(200);
    expect(calls).toEqual(['support:2026-10']);
    expect((await post('/api/demo/checkin', { team: 'marketing' })).status).toBe(400);
    expect(calls).toHaveLength(1);

    await setup({ sendCheckIn: async () => { throw new Error('no token'); } });
    const res = await post('/api/demo/checkin', { team: 'support' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('no token');
  });
});

describe('signals', () => {
  it('POST /api/signals/refresh returns results from deps and passes offline', async () => {
    const refreshSignals = vi.fn(async () => [{ team: 'support' as const, signals: 2, events: 1, usedLlm: false }]);
    await setup({ refreshSignals });
    const res = await post('/api/signals/refresh?month=2026-10', { offline: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ team: 'support', signals: 2, events: 1, usedLlm: false }] });
    expect(refreshSignals).toHaveBeenCalledWith('2026-10', { offline: true });
  });

  it('GET /api/signals requires a team and returns an array', async () => {
    expect((await get('/api/signals?month=2026-10')).status).toBe(400);
    const res = await get('/api/signals?month=2026-10&team=search');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
