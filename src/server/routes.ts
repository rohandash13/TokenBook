// OWNER: C — Express app. Routes are grouped by area inside createApp; later tasks append their
// groups where marked, before the error handler.
import express from 'express';
import { z } from 'zod';
import type { ActualsResult, HistoryRow, PostContextResult, PrepareResult, StoredMemo } from '../shared/api';
import { asOfFor, DEMO, monthsBetween, nextMonth, prevMonth, TEAM_INFO, TEAMS } from '../shared/config';
import type { JournalEntry, Method, MemoInput, Month, Team, TeamContext } from '../shared/types';
import { toCsv } from '../close/csv';
import { computeHistory, historyRow } from '../close/history';
import { applyOverrides, assertBalanced, buildAccrual } from '../close/journal';
import { draftMemos, placeholderMemo } from '../close/memoTrigger';
import { closeActuals } from '../close/trueup';
import { lastSignals } from '../signals/refresh';
import type { Deps } from './deps';
import { demoReset } from './demoReset';
import { integrationRoutes } from './integrationRoutes';
import {
  getEntry, getMemo, listContexts, listEntries, listMemos, listVariances, replaceMemos, replaceVariances,
  saveEntries, saveMemo, upsertContext,
} from './store';

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 404 | 409 | 502 | 503, message: string) {
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
    source: z.enum(['lead', 'slack', 'github']).optional(),
    evidence: z.array(z.object({
      source: z.enum(['slack', 'github']),
      id: z.string(),
        url: z.string().url().refine((u) => u.startsWith('https://') && !/[|<>\s]/.test(u), 'url must be https and contain no | < > or spaces'),
        text: z.string(), date: z.string(),
      author: z.string().optional(),
    })).optional(),
  })).default([]),
  quote: z.string().optional(),
  repliedAt: z.string().optional(),
  leadName: z.string().optional(),
  inferred: z.boolean().optional(),
  inferredAt: z.string().optional(),
});

const Override = z.number().nonnegative().max(1_000_000_000).optional();
const PrepareBody = z.object({
  overrides: z.object({ support: Override, search: Override, growth: Override, platform: Override }).default({}),
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
      ...(b.inferred !== undefined && { inferred: b.inferred }),
      ...(b.inferredAt !== undefined && { inferredAt: b.inferredAt }),
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
    const assertStillPrepared = () => {
      const existing = getEntry(accrualId(month));
      if (existing && existing.status !== 'prepared') throw new HttpError(409, `${existing.id} is already ${existing.status}`);
    };
    assertStillPrepared();

    const estimates = applyOverrides(await deps.estimateAll(month, asOfFor(month)), parsed.data.overrides);
    assertStillPrepared(); // approval or export may have landed while we awaited
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
    if (entry.status !== 'prepared') throw new HttpError(409, `${entry.id} is already ${entry.status}`);
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

  // --- actuals close, variances, memos ---
  // Re-running must not un-export an entry that was already exported.
  const saveClosingEntries = (...entries: JournalEntry[]): JournalEntry[] => {
    const toSave = entries.map((e) => (getEntry(e.id)?.status === 'exported' ? { ...e, status: 'exported' as const } : e));
    saveEntries(...toSave);
    return toSave;
  };

  // Keep stored memos (edits, attachments) for teams that still need one; draft only the new ones.
  // Stored memos are re-read after the drafting await so edits made meanwhile are not lost.
  const reconcileMemos = async (month: Month, inputs: MemoInput[]): Promise<StoredMemo[]> => {
    const had = new Set(listMemos(month).map((m) => m.team));
    const fresh = inputs.filter((i) => !had.has(i.team));
    const drafted = new Map((await draftMemos(fresh, deps.draftMemo)).map((m) => [m.team, { ...m, attached: false }]));
    const kept = new Map(listMemos(month).map((m) => [m.team, m]));
    return inputs.map((i) => kept.get(i.team) ?? drafted.get(i.team) ?? { ...placeholderMemo(i), attached: false });
  };

  app.post('/api/close/:month/actuals', async (req, res) => {
    const month = monthParam(req.params.month);
    const accrual = getEntry(accrualId(month));
    if (!accrual || accrual.status === 'prepared') throw new HttpError(409, `Approve the ${month} accrual before loading actuals`);
    const actuals = (await deps.loadActuals(month)).filter((a) => a.month === month);
    if (actuals.length === 0) throw new HttpError(404, `No actuals for ${month}`);

    const { reversal, actual, variances, memoInputs } = closeActuals(accrual, actuals, listContexts(month));
    const memos = await reconcileMemos(month, memoInputs);
    const [savedReversal, savedActual] = saveClosingEntries(reversal, actual);
    replaceVariances(month, variances);
    replaceMemos(month, memos);
    const result: ActualsResult = { reversal: savedReversal, actual: savedActual, variances, memos };
    res.json(result);
  });

  app.get('/api/variances', (req, res) => { res.json(listVariances(monthParam(req.query.month))); });
  app.get('/api/memos', (req, res) => { res.json(listMemos(monthParam(req.query.month))); });

  const requireMemo = (monthRaw: string, teamRaw: string): StoredMemo => {
    const month = monthParam(monthRaw);
    const memo = TEAMS.includes(teamRaw as Team) ? getMemo(month, teamRaw as Team) : null;
    if (!memo) throw new HttpError(404, `No memo for ${teamRaw} in ${month}`);
    return memo;
  };

  app.put('/api/memos/:month/:team', (req, res) => {
    const text = z.string().trim().min(1).safeParse(req.body?.text);
    if (!text.success) throw new HttpError(400, 'Memo text is required');
    const edited: StoredMemo = { ...requireMemo(req.params.month, req.params.team), text: text.data, editedAt: new Date().toISOString() };
    saveMemo(edited);
    res.json(edited);
  });

  app.post('/api/memos/:month/:team/attach', (req, res) => {
    const attached: StoredMemo = { ...requireMemo(req.params.month, req.params.team), attached: true };
    saveMemo(attached);
    res.json(attached);
  });

  // --- history ---
  app.get('/api/history', async (_req, res) => {
    // Start one month after the first fixture month: lastmonth has no prior actual before that.
    const rows: HistoryRow[] = [];
    const months = monthsBetween(nextMonth(DEMO.firstMonth), prevMonth(DEMO.month));
    if (listVariances(DEMO.month).length > 0) months.push(DEMO.month); // demo month is scored once its actuals are loaded
    for (const month of months) {
      let estimates: Awaited<ReturnType<Deps['estimateAll']>>;
      let actuals: Awaited<ReturnType<Deps['loadActuals']>>;
      try {
        estimates = await deps.estimateAll(month, asOfFor(month));
        actuals = (await deps.loadActuals(month)).filter((a) => a.month === month);
      } catch (err) {
        console.warn(`history: skipping ${month}:`, err instanceof Error ? err.message : String(err));
        continue;
      }
      for (const a of actuals) {
        const byMethod: Partial<Record<Method, number>> = {};
        for (const e of estimates) if (e.team === a.team) byMethod[e.method] = e.estimate;
        rows.push(historyRow(month, a.team, a.actualUsd, byMethod));
      }
    }
    const biasByTeam: Partial<Record<Team, number>> = {};
    try {
      for (const e of await deps.estimateAll(DEMO.month, DEMO.asOf)) {
        if (e.method === 'trueup' && e.biasSuggestionPct !== undefined) biasByTeam[e.team] = e.biasSuggestionPct;
      }
    } catch (err) {
      console.warn('history: no bias suggestions:', err instanceof Error ? err.message : String(err));
    }
    res.json(computeHistory(rows, biasByTeam));
  });

  // --- demo ---
  app.post('/api/demo/reset', async (_req, res) => {
    res.json({ ok: true, ...(await demoReset(deps.loadContexts, (month) => deps.refreshSignals(month, { offline: true }))) });
  });

  app.post('/api/demo/checkin', async (req, res) => {
    const team = z.enum(TEAMS as [string, ...string[]]).safeParse(req.body?.team);
    if (!team.success) throw new HttpError(400, 'team is required');
    try {
      await deps.sendCheckIn(team.data as Team, DEMO.month);
    } catch (err) {
      throw new HttpError(502, `Slack check-in failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.json({ ok: true });
  });

  // --- signals ---
  app.post('/api/signals/refresh', async (req, res) => {
    const month = monthParam(req.query.month);
    const offline = req.body?.offline === true;
    res.json({ results: await deps.refreshSignals(month, { offline }) });
  });

  app.get('/api/signals', (req, res) => {
    const month = monthParam(req.query.month);
    const team = one(req.query.team);
    if (!team || !TEAMS.includes(team as Team)) throw new HttpError(400, 'team is required');
    res.json(lastSignals(team as Team, month));
  });

  integrationRoutes(app, deps);

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
