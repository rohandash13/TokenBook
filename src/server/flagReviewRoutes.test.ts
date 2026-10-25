import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './routes';
import { fakeDeps } from './testDeps';
import { getEntry, listContexts, listFlagReviews, saveEntries, upsertContext } from './store';
import { applyFlagReviews, flagKey, type FlagReviewResult } from '../shared/flagReviews';
import { defaultRefreshDeps } from '../signals/refresh';
import type { DriverFlag, JournalEntry } from '../shared/types';

const flag: DriverFlag = { date: '2026-10-29', note: 'planned load test', reason: 'size unknown', evidence: [{ id: 'gmail:review-test', source: 'gmail', date: '2026-10-25', text: 'Platform API usage increases October 29, size unconfirmed.', url: 'https://example.com/evidence' }] };
let server: Server;
let base: string;
const post = (body: unknown) => fetch(`${base}/api/contexts/platform/resolve-flag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const body = { month: '2026-10', flagKey: flagKey(flag), action: 'confirm', date: '2026-10-29', until: '2026-10-29', multiplier: 2, reason: 'Sam confirmed a one-day load test.' };
beforeEach(async () => {
  process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), 'flag-review-'));
  upsertContext({ team: 'platform', month: '2026-10', replied: false, inferred: true, leadName: 'Sam', events: [], flags: [flag] });
  server = createApp(fakeDeps()).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('controller flag review', () => {
  it('confirms one flag with an audit trail and leaves approved accounting records untouched', async () => {
    const approved: JournalEntry = { id: 'approved', kind: 'accrual', month: '2026-10', date: '2026-10-31', status: 'approved', approvedBy: 'Dana', lines: [] };
    saveEntries(approved);
    const res = await post(body);
    expect(res.status).toBe(200);
    const result = await res.json() as FlagReviewResult;
    expect(result.review).toMatchObject({ reviewedBy: 'Dana', action: 'confirm', reason: body.reason });
    expect(result.review.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.context.events).toEqual([expect.objectContaining({ date: body.date, until: body.until, multiplier: 2, evidence: flag.evidence })]);
    expect(result.context.flags).toEqual([]);
    expect(getEntry('approved')).toEqual(approved);
    expect((await post(body)).status).toBe(409);
  });
  it('dismisses without adding a driver, and the decision survives refresh', async () => {
    expect((await post({ ...body, action: 'dismiss', reason: 'Sam cancelled the load test.' })).status).toBe(200);
    const current = listContexts('2026-10')[0];
    expect(current.events).toEqual([]);
    expect(current.flags).toEqual([]);
    const refreshed = await defaultRefreshDeps({ deterministic: true }).infer('platform', '2026-10', [{ id: 'gmail:review-test', source: 'gmail', kind: 'message', team: 'platform', date: '2026-10-25', author: 'Sam', text: 'Platform load test starts October 29, 2026. API usage will increase, but the expected multiplier is not yet confirmed.', url: 'https://example.com/evidence' }]);
    expect(refreshed.flags).toEqual([]);
    expect(refreshed.events).toEqual([]);
  });
  it('preserves unrelated flags and existing drivers', async () => {
    const other = { ...flag, date: '2026-10-30', note: 'another claim' };
    upsertContext({ team: 'platform', month: '2026-10', replied: false, events: [{ date: '2026-10-26', until: '2026-10-26', multiplier: 3, note: 'earlier spike' }], flags: [flag, other] });
    expect((await post(body)).status).toBe(200);
    expect(listContexts('2026-10')[0].events).toHaveLength(2);
    expect(listContexts('2026-10')[0].flags).toEqual([other]);
    const reviewed = applyFlagReviews([], [flag], listFlagReviews('2026-10', 'platform'));
    expect(reviewed.events[0].multiplier).toBe(2);
    expect(reviewed.flags).toEqual([]);
  });
  it('rejects dates already in usage, impossible dates, invalid windows, missing sizes, and blank reasons', async () => {
    for (const change of [{ date: '2026-10-24' }, { date: '2026-10-32' }, { until: '2026-10-28' }, { multiplier: undefined }, { multiplier: 11 }, { reason: '' }]) expect((await post({ ...body, ...change })).status).toBe(400);
    expect(listFlagReviews('2026-10')).toEqual([]);
    expect(listContexts('2026-10')[0].flags).toHaveLength(1);
  });
  it('includes the decision reason in newly prepared journal evidence', async () => {
    expect((await post(body)).status).toBe(200);
    const prepared = await fetch(`${base}/api/close/2026-10/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(prepared.status).toBe(200);
    const result = await prepared.json() as { entry: JournalEntry };
    expect(result.entry.lines.find((line) => line.team === 'platform')?.evidence.some((text) => text.includes(body.reason) && text.includes('Dana'))).toBe(true);
  });
  it('reopens refreshed evidence that conflicts with an earlier confirmation', async () => {
    expect((await post(body)).status).toBe(200);
    const refreshed = applyFlagReviews([{ date: body.date, until: body.until, multiplier: 4, note: 'new estimate' }], [flag], listFlagReviews('2026-10', 'platform'));
    expect(refreshed.events).toHaveLength(1);
    expect(refreshed.events[0].multiplier).toBe(4);
    expect(refreshed.flags).toEqual([expect.objectContaining({ note: 'Previously reviewed change conflicts with refreshed evidence' })]);
  });
  it('rejects overlapping drivers' , async () => {
    upsertContext({ team: 'platform', month: '2026-10', replied: false, events: [{ date: '2026-10-28', multiplier: 3, note: 'existing rollout' }], flags: [flag] });
    expect((await post(body)).status).toBe(409);
    expect(listFlagReviews('2026-10')).toEqual([]);
  });
});
