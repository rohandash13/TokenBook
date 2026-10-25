// OWNER: C
import { mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectExternalEvents } from '../integrations/collect';
import { withExternalEvents } from '../integrations/merge';
import type { JiraIssueSnapshot } from '../integrations/types';
import type { Estimate } from '../shared/types';
import { createApp } from './routes';
import { fakeDeps } from './testDeps';

const fixtures = JSON.parse(
  readFileSync(new URL('../../data/fixtures/integrations/jira.json', import.meta.url), 'utf8'),
) as JiraIssueSnapshot[];
const NW5 = fixtures.find((i) => i.key === 'NW-5')!;
const SECRET = 'test-secret';

// Search's trueup is $3,000 times the multipliers of the integration events in its context.
const estimateAll = (month: string, asOf: string): Estimate[] => {
  const ctx = withExternalEvents([], collectExternalEvents(asOf, [])).find((c) => c.team === 'search' && c.month === month);
  const estimate = 3000 * (ctx?.events.reduce((m, e) => m * e.multiplier, 1) ?? 1);
  return [{ team: 'search', month, asOf, method: 'trueup', actualToDate: 2000, estimate, confidence: 'medium', basis: 'b' }];
};

let server: Server | undefined;
let base = '';
const send = (method: string, path: string, body?: unknown, secret: string | null = SECRET) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-trueup-secret': secret } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(async () => {
  process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), 'trueup-'));
  process.env.JIRA_WEBHOOK_SECRET = SECRET;
  server = createApp(fakeDeps({ estimateAll })).listen(0);
  await new Promise((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server!.close(() => r()));
  delete process.env.JIRA_WEBHOOK_SECRET;
});

describe('Jira integration routes', () => {
  it('takes an issue from the Forge app and returns the estimate before and after', async () => {
    const res = await send('POST', '/api/integrations/jira/issues', NW5);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { before: Estimate; after: Estimate; event: unknown };
    expect(body).toMatchObject({ team: 'search', teamLabel: 'Search', monthLabel: 'Oct 2026', accrualStatus: null });
    expect(body.before.estimate).toBe(3000);
    expect(body.after.estimate).toBe(6000);
    expect(body.event).toMatchObject({ date: '2026-10-29', multiplier: 2, source: 'jira' });
  });

  it('rejects a missing or wrong secret, and says when the integration is not configured', async () => {
    expect((await send('POST', '/api/integrations/jira/issues', NW5, null)).status).toBe(401);
    expect((await send('POST', '/api/integrations/jira/issues', NW5, 'nope-nope-n')).status).toBe(401);
    delete process.env.JIRA_WEBHOOK_SECRET;
    expect((await send('POST', '/api/integrations/jira/issues', NW5)).status).toBe(503);
  });

  it('validates the issue body', async () => {
    expect((await send('POST', '/api/integrations/jira/issues', { ...NW5, dueDate: 'Oct 29' })).status).toBe(400);
  });

  it('stores an issue with no team but adds no driver', async () => {
    const res = await send('POST', '/api/integrations/jira/issues', { ...NW5, key: 'NW-9', labels: ['load-test'] });
    expect(await res.json()).toEqual({ team: null, event: null, before: null, after: null });
    const list = await (await send('GET', '/api/integrations/jira/issues', undefined, null)).json();
    expect(list).toEqual([expect.objectContaining({ team: null, event: null })]);
  });

  it('serves the issue panel', async () => {
    await send('POST', '/api/integrations/jira/issues', NW5);
    const impact = await (await send('GET', '/api/integrations/jira/impact?issue=NW-5')).json();
    expect(impact).toMatchObject({ key: 'NW-5', team: 'search', event: { multiplier: 2 }, estimate: { estimate: 6000 } });
    expect((await send('GET', '/api/integrations/jira/impact?issue=NW-404')).status).toBe(404);
  });
});
