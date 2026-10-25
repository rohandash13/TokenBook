// OWNER: C — REST endpoints for the Atlassian (Jira Forge app) and Apify integrations.
import { timingSafeEqual } from 'node:crypto';
import type express from 'express';
import { z } from 'zod';
import { JIRA, jiraIssueUrl, jiraProjectUrl } from '../integrations/config';
import { jiraEvents, teamOf } from '../integrations/jira/events';
import { announcementWhatIfs, costOutlook } from '../budgets/outlook';
import { checkBudgets } from '../budgets/check';
import { optimizeWorkflows } from '../budgets/optimize';
import { proposeStacks } from '../budgets/stack';
import { teamPriceMultiplier } from '../integrations/apify/impact';
import { priceChanges } from '../integrations/apify/prices';
import type { MarketReport, StackReport } from '../shared/api';
import { DEMO, monthLabel, TEAM_INFO, TEAMS } from '../shared/config';
import type { Estimate, Team } from '../shared/types';
import type { Deps } from './deps';
import { HttpError } from './routes';
import { getEntry, getPolicies, listAnnouncements, listCatalog, listContexts, listJiraIssues, listMarketSignals, listPriceSnapshots, upsertJiraIssue } from './store';

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
    // Links are built from the site, never taken from Forge (whose issue URLs point at the API gateway).
    const issue = { ...parsed.data, url: jiraIssueUrl(parsed.data.key, parsed.data.projectKey) };
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
    const event = jiraEvents([issue], asOf)[0] ?? null;
    // What happened, so the Forge app's reply on the ticket is accurate.
    const ctx = listContexts(month).filter((c) => c.team === team).at(-1);
    const outcome = !event ? 'none'
      : !event.date.startsWith(month) ? 'other-month'
        : Math.round(before?.estimate ?? 0) !== Math.round(after?.estimate ?? 0) ? 'moved'
          : ctx && !ctx.replied && !ctx.inferred ? 'pending'
            : 'corroborated';
    res.json({ team, ...labels(team), event, before, after, accrualStatus, outcome });
  });

  // For the Forge issue panel.
  app.get('/api/integrations/jira/impact', async (req, res) => {
    requireSecret(req);
    const key = String(req.query.issue ?? '');
    const issue = listJiraIssues().find((i) => i.key === key);
    if (!issue) throw new HttpError(404, `TokenBook hasn't seen ${key || 'that issue'} yet: give it a team-* label`);
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

  // Model market: models and prices scraped from provider pages, cheapest blended price first.
  app.get('/api/integrations/models', (_req, res) => {
    res.json([...listCatalog()].sort((a, b) => a.blendedPerMTok - b.blendedPerMTok));
  });

  // Workflow optimizer: per team and workload, cheaper models with savings and trade-offs (how aggressive depends on
  // the team's budget status), plus a 3-month cost outlook
  // with announced price changes applied from their effective dates.
  app.get('/api/integrations/optimizer', async (_req, res) => {
    const [estimates, usage] = await Promise.all([deps.estimateAll(month, asOf), deps.loadUsage(month, asOf)]);
    const catalog = listCatalog();
    const announcements = listAnnouncements().sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const policies = getPolicies();
    const budgets = policies ? checkBudgets(policies, estimates, usage, month, asOf).teams : [];
    const plans = optimizeWorkflows(estimates, usage, asOf, catalog, announcements, budgets);
    res.json({ month, asOf, plans, outlook: costOutlook(month, estimates, plans, announcements), announcements, whatIfs: announcementWhatIfs(plans, announcements, catalog) });
  });

  // Model stack: each team's observed model mix (last 7 days of usage) and a same-tier cheaper stack, with the
  // saving on the spend still to come this month.
  app.get('/api/integrations/stack', async (_req, res) => {
    const [estimates, usage] = await Promise.all([deps.estimateAll(month, asOf), deps.loadUsage(month, asOf)]);
    const policies = getPolicies();
    const budgets = policies ? checkBudgets(policies, estimates, usage, month, asOf).teams : [];
    const report: StackReport = { month, asOf, teams: proposeStacks(estimates, usage, asOf, listCatalog(), budgets) };
    res.json(report);
  });

  app.post('/api/integrations/models/refresh', async (_req, res) => {
    res.json(await deps.refreshCatalog());
  });

  app.post('/api/integrations/apify/refresh', async (_req, res) => {
    res.json(await deps.refreshApify());
  });

  // For the web app: every Jira issue TrueUp knows, with the driver it contributes.
  app.get('/api/integrations/jira/issues', (_req, res) => {
    res.json(listJiraIssues().map((stored) => {
      const issue = { ...stored, url: jiraIssueUrl(stored.key, stored.projectKey) };
      return { issue, team: teamOf(issue), event: jiraEvents([issue], asOf)[0] ?? null };
    }));
  });

  app.get('/api/integrations/jira/project', (_req, res) => {
    res.json({ projectKey: JIRA.projectKey, url: jiraProjectUrl(), siteUrl: JIRA.siteUrl });
  });
}
