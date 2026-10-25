import type express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DEMO, TEAMS, asOfFor, lastDayOfMonth } from '../shared/config';
import { applyFlagReviews, flagKey, overlaps, sameWindow, type FlagReview } from '../shared/flagReviews';
import type { ContextEvent, Team } from '../shared/types';
import { listContexts, listFlagReviews, saveFlagReview, upsertContext } from './store';
import { HttpError, monthParam } from './routes';
import type { Deps } from './deps';

const Body = z.object({ month: z.string(), flagKey: z.string().min(1), action: z.enum(['confirm', 'dismiss']), reason: z.string().trim().min(3).max(1000), date: z.string().optional(), until: z.string().optional(), multiplier: z.number().min(0).max(10).optional() });
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

export function flagReviewRoutes(app: express.Express, deps: Deps) {
  app.get('/api/flag-reviews', (req, res) => res.json(listFlagReviews(monthParam(req.query.month))));
  app.post('/api/contexts/:team/resolve-flag', async (req, res) => {
    const team = req.params.team as Team;
    if (!TEAMS.includes(team)) throw new HttpError(400, 'Unknown team');
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Provide a decision and a reason of at least 3 characters.');
    const body = parsed.data;
    const month = monthParam(body.month);
    const context = listContexts(month).find((c) => c.team === team);
    if (!context) throw new HttpError(404, 'Team context not found');
    const flag = context.flags?.find((f) => flagKey(f) === body.flagKey);
    if (!flag) throw new HttpError(409, 'This item has changed or was already reviewed. Refresh and try again.');
    let event: ContextEvent | undefined;
    if (body.action === 'confirm') {
      const date = body.date ?? flag.date;
      if (!validDay(date) || date < asOfFor(month) || date > lastDayOfMonth(month) || !date.startsWith(month) || body.multiplier === undefined) throw new HttpError(400, 'Enter a usage multiplier and an effective date from the as-of date through month-end.');
      if (body.until && (!validDay(body.until) || body.until < date || body.until > lastDayOfMonth(month))) throw new HttpError(400, 'End date must be within this month and on or after the effective date.');
      event = { date, multiplier: body.multiplier, ...(body.until && { until: body.until }), note: flag.note, source: 'lead', evidence: flag.evidence };
      if (context.events.some((e) => overlaps(e, event!) && !sameWindow(e, event!))) throw new HttpError(409, 'This overlaps an existing driver. Use the manual forecast override to replace the team plan.');
    }
    const before = (await deps.estimateAll(month, asOfFor(month))).find((e) => e.team === team && e.method === 'trueup') ?? null;
    const latest = listContexts(month).find((c) => c.team === team);
    if (JSON.stringify(latest) !== JSON.stringify(context)) throw new HttpError(409, 'The team context changed during review. Refresh and try again.');
    const review: FlagReview = { id: randomUUID(), month, team, flagKey: body.flagKey, action: body.action, reason: body.reason, reviewedBy: DEMO.controller, reviewedAt: new Date().toISOString(), flag, ...(event && { event }) };
    const updated = { ...context, ...applyFlagReviews(context.events, context.flags ?? [], [review]) };
    saveFlagReview(review);
    upsertContext(updated);
    const after = (await deps.estimateAll(month, asOfFor(month))).find((e) => e.team === team && e.method === 'trueup') ?? null;
    res.json({ review, context: updated, before, after });
  });
}
