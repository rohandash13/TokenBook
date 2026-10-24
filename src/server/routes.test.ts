import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostContextResult, PrepareResult } from '../shared/api';
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
// put is used by later tasks (memo edits).
export const put = (path: string, body: unknown) => send('PUT', path, body);

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
