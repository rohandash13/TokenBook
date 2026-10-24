// OWNER: C — Express app. Routes are grouped by area inside createApp; later tasks append their
// groups where marked, before the error handler.
import express from 'express';
import { z } from 'zod';
import type { PostContextResult, PrepareResult } from '../shared/api';
import { asOfFor, DEMO, TEAM_INFO, TEAMS } from '../shared/config';
import type { Month, TeamContext } from '../shared/types';
import { toCsv } from '../close/csv';
import { applyOverrides, assertBalanced, buildAccrual } from '../close/journal';
import type { Deps } from './deps';
import { getEntry, listContexts, listEntries, saveEntries, upsertContext } from './store';

export class HttpError extends Error {
  constructor(public status: 400 | 404 | 409 | 502, message: string) {
    super(message);
  }
}

const one = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function monthParam(v: unknown): Month {
  const m = one(v) ?? DEMO.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, `Bad month "${m}", expected YYYY-MM`);
  return m;
}

export function dateParam(v: unknown): string | undefined {
  const d = one(v);
  if (d === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, `Bad date "${d}", expected YYYY-MM-DD`);
  return d;
}

const ContextBody = z.object({
  team: z.enum(TEAMS as [string, ...string[]]),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  replied: z.boolean(),
  events: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    multiplier: z.number().positive(),
    note: z.string(),
  })).default([]),
  quote: z.string().optional(),
  repliedAt: z.string().optional(),
  leadName: z.string().optional(),
});

const PrepareBody = z.object({
  overrides: z.object({
    support: z.number().nonnegative().optional(),
    search: z.number().nonnegative().optional(),
    growth: z.number().nonnegative().optional(),
    platform: z.number().nonnegative().optional(),
  }).default({}),
});

export function createApp(deps: Deps): express.Express {
  const app = express();
  app.use(express.json());

  // --- health, usage, estimates, contexts ---
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  app.get('/api/usage', async (req, res) => {
    const month = monthParam(req.query.month);
    res.json(await deps.loadUsage(month, dateParam(req.query.asOf) ?? asOfFor(month)));
  });

  app.get('/api/estimates', async (req, res) => {
    const month = monthParam(req.query.month);
    res.json(await deps.estimateAll(month, dateParam(req.query.asOf) ?? asOfFor(month)));
  });

  app.get('/api/contexts', (req, res) => { res.json(listContexts(monthParam(req.query.month))); });

  app.post('/api/contexts', async (req, res) => {
    const parsed = ContextBody.safeParse(req.body ?? null);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const b = parsed.data;
    const team = b.team as TeamContext['team'];
    const trueupFor = async () =>
      (await deps.estimateAll(b.month, asOfFor(b.month))).find((e) => e.team === team && e.method === 'trueup') ?? null;

    const before = await trueupFor();
    const repliedAt = b.repliedAt ?? (b.replied ? new Date().toISOString() : undefined);
    const context: TeamContext = {
      team, month: b.month, replied: b.replied, events: b.events,
      leadName: b.leadName ?? TEAM_INFO[team].leadName,
      ...(b.quote !== undefined && { quote: b.quote }),
      ...(repliedAt !== undefined && { repliedAt }),
    };
    upsertContext(context);
    const after = await trueupFor();
    const result: PostContextResult = { context, before, after };
    res.status(201).json(result);
  });

  // --- close: journal list, prepare, approve, export ---
  const accrualId = (month: Month) => `JE-${month}-ACCRUAL`;
  const requireEntry = (id: string) => {
    const entry = getEntry(id);
    if (!entry) throw new HttpError(404, `No journal entry ${id}`);
    return entry;
  };

  app.get('/api/journal', (req, res) => { res.json(listEntries(monthParam(req.query.month))); });

  app.post('/api/close/:month/prepare', async (req, res) => {
    const month = monthParam(req.params.month);
    const parsed = PrepareBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const existing = getEntry(accrualId(month));
    if (existing && existing.status !== 'prepared') throw new HttpError(409, `${existing.id} is already ${existing.status}`);

    const estimates = applyOverrides(await deps.estimateAll(month, asOfFor(month)), parsed.data.overrides);
    const entry = buildAccrual(month, estimates, listContexts(month));
    saveEntries(entry);
    const result: PrepareResult = { entry, estimates: estimates.filter((e) => e.method === 'trueup') };
    res.json(result);
  });

  app.post('/api/journal/:id/approve', (req, res) => {
    const approvedBy = z.string().trim().min(1).safeParse(req.body?.approvedBy);
    if (!approvedBy.success) throw new HttpError(400, 'approvedBy is required');
    const entry = requireEntry(req.params.id);
    if (entry.kind !== 'accrual') throw new HttpError(400, `Only accruals need approval; ${entry.id} is ${entry.kind}`);
    const approved = assertBalanced({ ...entry, status: 'approved', approvedBy: approvedBy.data });
    saveEntries(approved);
    res.json(approved);
  });

  app.get('/api/journal/:id/export.csv', (req, res) => {
    const entry = requireEntry(req.params.id);
    if (entry.status === 'prepared') throw new HttpError(409, `Approve ${entry.id} before exporting`);
    if (entry.status === 'approved') saveEntries({ ...entry, status: 'exported' });
    res
      .status(200)
      .set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${entry.id}.csv"` })
      .send(toCsv(entry));
  });

  // --- APPEND NEW ROUTE GROUPS ABOVE THIS LINE ---

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    const e = err as { type?: string; status?: number; message?: string };
    if (e.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON body' }); return; }
    // Other body-parser / http-errors failures (e.g. 413) carry their own 4xx status.
    if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      res.status(e.status).json({ error: e.message ?? 'Bad request' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
