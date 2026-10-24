import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostContextResult } from '../shared/api';
import type { Estimate } from '../shared/types';
import type { Deps } from './deps';
import { createApp } from './routes';
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
    await setup({ estimateAll: () => { throw new Error('boom'); } });
    const res = await get('/api/estimates');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('boom');
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
