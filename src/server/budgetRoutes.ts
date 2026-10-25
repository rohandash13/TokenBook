// OWNER: C — budgets and spend policies.
import type express from 'express';
import { z } from 'zod';
import { checkBudgets } from '../budgets/check';
import { suggestModels } from '../budgets/suggest';
import type { Policies } from '../shared/api';
import { asOfFor, TEAMS } from '../shared/config';
import type { Deps } from './deps';
import { HttpError, monthParam } from './routes';
import { getPolicies, listCatalog, savePolicies } from './store';

const Usd = z.number().positive().max(10_000_000);
const PoliciesBody = z.object({
  warnAt: z.number().gt(0).lte(1),
  teamBudgets: z.object(Object.fromEntries(TEAMS.map((t) => [t, Usd.optional()]))),
  modelCaps: z.array(z.object({ model: z.string().min(1), capUsd: Usd })),
});

const EMPTY: Policies = { warnAt: 0.9, teamBudgets: {}, modelCaps: [] };

export function budgetRoutes(app: express.Express, deps: Deps): void {
  app.get('/api/policies', (_req, res) => { res.json(getPolicies() ?? EMPTY); });

  app.put('/api/policies', (req, res) => {
    const parsed = PoliciesBody.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    savePolicies(parsed.data as Policies);
    res.json(parsed.data);
  });

  app.get('/api/budgets', async (req, res) => {
    const month = monthParam(req.query.month);
    const asOf = asOfFor(month);
    const [estimates, usage] = await Promise.all([deps.estimateAll(month, asOf), deps.loadUsage(month, asOf)]);
    const report = checkBudgets(getPolicies() ?? EMPTY, estimates, usage, month, asOf);
    res.json({ ...report, suggestions: suggestModels(report.teams, usage, asOf, listCatalog()) });
  });
}
