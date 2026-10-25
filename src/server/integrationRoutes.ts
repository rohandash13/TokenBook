// OWNER: C — REST endpoints for the Atlassian (Jira Forge app) and Apify integrations.
import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { z } from 'zod';
import { jiraEvents, teamOf } from '../integrations/jira/events';
import { teamPriceMultiplier } from '../integrations/apify/impact';
import { priceChanges } from '../integrations/apify/prices';
import type { MarketReport } from '../shared/api';
import { DEMO, monthLabel, TEAM_INFO, TEAMS } from '../shared/config';
import type { Estimate, Team } from '../shared/types';
import type { Deps } from './deps';
import { HttpError } from './routes';
import { getEntry, listJiraIssues, listMarketSignals, listPriceSnapshots, upsertJiraIssue } from './store';

const JiraIssueBody = z.object({
  key: z.string().min(1),
  url: z.string().url(),
  projectKey: z.string(),
  summary: z.string(),
  description: z.string().default(''),
  labels: z.array(z.string()).default([]),
  components: z.array(z.string()).default([]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueDateHistory: z.array(z.object({ at: z.string(), from: z.string().nullable(), to: z.string().nullable() })).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** The Forge app and TrueUp share JIRA_WEBHOOK_SECRET (Forge: `forge variables set --encrypt TRUEUP_SECRET`). */
function requireSecret(req: express.Request): void {
  const want = process.env.JIRA_WEBHOOK_SECRET;
  if (!want) throw new HttpError(503, 'Jira integration not configured: set JIRA_WEBHOOK_SECRET in .env');
  const got = Buffer.from(req.get('x-trueup-secret') ?? '');
  const expected = Buffer.from(want);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new HttpError(401, 'Bad x-trueup-secret');
}

export function integrationRoutes(app: express.Express, deps: Deps): void {
  const month = DEMO.month;
  const asOf = DEMO.asOf;
  const trueupFor = async (team: Team): Promise<Estimate | null> =>
    (await deps.estimateAll(month, asOf)).find((e) => e.team === team && e.method === 'trueup') ?? null;
  const labels = (team: Team) => ({ teamLabel: TEAM_INFO[team].label, monthLabel: monthLabel(month) });

  // From the Forge trigger: an issue was created or updated. Returns the team's estimate before and after.
  app.post('/api/integrations/jira/issues', async (req, res) => {
    requireSecret(req);
    const parsed = JiraIssueBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const issue = parsed.data;
    const team = teamOf(issue);
    if (!team) {
      upsertJiraIssue(issue);
      res.json({ team: null, event: null, before: null, after: null });
      return;
    }
    const before = await trueupFor(team);
    upsertJiraIssue(issue);
    const after = await trueupFor(team);
    const accrualStatus = getEntry(`JE-${month}-ACCRUAL`)?.status ?? null;
    res.json({ team, ...labels(team), event: jiraEvents([issue], asOf)[0] ?? null, before, after, accrualStatus });
  });

  // For the Forge issue panel.
  app.get('/api/integrations/jira/impact', async (req, res) => {
    requireSecret(req);
    const key = String(req.query.issue ?? '');
    const issue = listJiraIssues().find((i) => i.key === key);
    if (!issue) throw new HttpError(404, `TrueUp hasn't seen ${key || 'that issue'} yet: give it a team-* label`);
    const team = teamOf(issue);
    if (!team) throw new HttpError(404, `${key} has no team: add a label like team-support`);
    res.json({ key, team, ...labels(team), event: jiraEvents([issue], asOf)[0] ?? null, estimate: await trueupFor(team) });
  });

  // Apify: model price changes with each team's deterministic impact, plus market news (context only).
  app.get('/api/integrations/market', async (_req, res) => {
    const usage = await deps.loadUsage(month, asOf);
    const estimates = await deps.estimateAll(month, asOf);
    const report: MarketReport = {
      priceChanges: priceChanges(listPriceSnapshots()).filter((c) => c.announcedAt <= asOf).map((c) => ({
        ...c,
        impacts: TEAMS.flatMap((team) => {
          const multiplier = teamPriceMultiplier(team, c, usage, asOf);
          const base = estimates.find((e) => e.team === team && e.method === 'trueup')?.estimate ?? 0;
          // Indicative only: what this month's trueup would be worth at the new prices. Not booked.
          return multiplier === null ? [] : [{ team, multiplier, indicativeUsd: Math.round((multiplier - 1) * base * 100) / 100 }];
        }),
      })),
      signals: listMarketSignals().sort((a, b) => b.date.localeCompare(a.date)),
    };
    res.json(report);
  });

  app.post('/api/integrations/apify/refresh', async (_req, res) => {
    res.json(await deps.refreshApify());
  });

  // For the web app: every Jira issue TrueUp knows, with the driver it contributes.
  app.get('/api/integrations/jira/issues', (_req, res) => {
    res.json(listJiraIssues().map((issue) => ({ issue, team: teamOf(issue), event: jiraEvents([issue], asOf)[0] ?? null })));
  });
}
