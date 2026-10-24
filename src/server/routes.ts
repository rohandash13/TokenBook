// OWNER: C — Express app. Routes are grouped by area inside createApp; later tasks append their
// groups where marked, before the error handler.
import express from 'express';
import { z } from 'zod';
import type { PostContextResult } from '../shared/api';
import { asOfFor, DEMO, TEAM_INFO, TEAMS } from '../shared/config';
import type { Month, TeamContext } from '../shared/types';
import type { Deps } from './deps';
import { listContexts, upsertContext } from './store';

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

  // --- APPEND NEW ROUTE GROUPS ABOVE THIS LINE ---

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
    // express.json() parse failures carry a 4xx status.
    const status = (err as { status?: number }).status;
    if (status === 400) { res.status(400).json({ error: 'Invalid JSON body' }); return; }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
