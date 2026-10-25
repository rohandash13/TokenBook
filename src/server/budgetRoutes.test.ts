// OWNER: C
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BudgetReport, Policies } from '../shared/api';
import { createApp } from './routes';
import { fakeDeps } from './testDeps';

let server: Server;
let base = '';
const send = (method: string, path: string, body?: unknown) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(async () => {
  process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), 'trueup-'));
  server = createApp(fakeDeps()).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe('budget routes', () => {
  it('starts with no limits, saves policies and checks the projection against them', async () => {
    expect(await (await send('GET', '/api/policies')).json()).toEqual({ warnAt: 0.9, teamBudgets: {}, modelCaps: [] });
    const policies: Policies = { warnAt: 0.9, teamBudgets: { support: 7000, growth: 20000 }, modelCaps: [] };
    expect((await send('PUT', '/api/policies', policies)).status).toBe(200);
    const report = (await (await send('GET', '/api/budgets')).json()) as BudgetReport;
    expect(report.teams.map((t) => [t.team, t.status])).toEqual([['support', 'over'], ['growth', 'ok']]);
    expect(report.alerts[0]).toMatch(/^support is projected at \$7,590, \$590 over its \$7,000 budget$/);
  });

  it('rejects invalid limits', async () => {
    expect((await send('PUT', '/api/policies', { warnAt: 2, teamBudgets: {}, modelCaps: [] })).status).toBe(400);
    expect((await send('PUT', '/api/policies', { warnAt: 0.9, teamBudgets: { support: -5 }, modelCaps: [] })).status).toBe(400);
  });
});
