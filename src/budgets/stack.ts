// OWNER: C — model stack: each team's real mix of models over the last 7 days of usage, and a proposed stack that
// swaps every model for the cheapest model of the SAME tier on the live market (any provider). Savings apply only
// to the spend still to come this month (TokenBook estimate − actual to date), split by the observed mix.
// Deterministic; a suggestion only: quality on the team's own workload is not verified.
import type { CatalogModel } from '../integrations/apify/catalog';
import type { Status, StackLine, StackModel, TeamBudgetCheck, TeamStack } from '../shared/api';
import { TEAMS } from '../shared/config';
import type { Estimate, UsageDay } from '../shared/types';
import { currentModel } from './suggest';

const MIX_DAYS = 7;
const round2 = (x: number) => Math.round(x * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const view = (m: CatalogModel): StackModel => ({
  model: m.model, provider: m.provider, tier: m.tier, blendedPerMTok: m.blendedPerMTok, url: m.url, openWeight: m.openWeight,
});

/** The cheapest model of the same tier, from any provider, that is cheaper than `current`. */
export function cheapestSameTier(current: CatalogModel, catalog: CatalogModel[]): CatalogModel | null {
  return catalog
    .filter((c) => c.tier === current.tier && c.model !== current.model && c.blendedPerMTok < current.blendedPerMTok)
    .sort((a, b) => a.blendedPerMTok - b.blendedPerMTok)[0] ?? null;
}

/** The first and last day of the window the mix is read from. */
export const mixWindow = (asOf: string) => ({ from: addDays(asOf, -(MIX_DAYS - 1)), to: asOf });

export function proposeStacks(
  estimates: Estimate[], usage: UsageDay[], asOf: string, catalog: CatalogModel[], budgets: TeamBudgetCheck[] = [],
): TeamStack[] {
  const { from, to } = mixWindow(asOf);
  return TEAMS.flatMap((team): TeamStack[] => {
    const est = estimates.find((e) => e.team === team && e.method === 'trueup');
    if (!est) return [];
    const byModel = new Map<string, number>();
    for (const u of usage) {
      if (u.team === team && u.date >= from && u.date <= to) byModel.set(u.model, (byModel.get(u.model) ?? 0) + u.costUsd);
    }
    const mixTotal = [...byModel.values()].reduce((s, c) => s + c, 0);
    const remaining = Math.max(0, est.estimate - est.actualToDate);
    const lines: StackLine[] = mixTotal <= 0 ? [] : [...byModel.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([usageModel, cost]) => {
        const share = cost / mixTotal;
        const remainingUsd = remaining * share;
        const cur = currentModel(usageModel, catalog);
        const next = cur ? cheapestSameTier(cur, catalog) : null;
        const after = cur && next ? remainingUsd * (next.blendedPerMTok / cur.blendedPerMTok) : remainingUsd;
        return {
          usageModel, share: round2(share), current: cur ? view(cur) : null, proposed: next ? view(next) : null,
          remainingUsd: round2(remainingUsd), remainingAfterUsd: round2(after), savingUsd: round2(remainingUsd - after),
        };
      });
    const savingUsd = round2(lines.reduce((s, l) => s + l.savingUsd, 0));
    const status: Status | undefined = budgets.find((b) => b.team === team)?.status;
    return [{
      team, status, mixFrom: from, mixTo: to,
      spentUsd: round2(est.actualToDate), projectedUsd: round2(est.estimate), remainingUsd: round2(remaining),
      lines, savingUsd, proposedProjectedUsd: round2(est.estimate - savingUsd),
    }];
  });
}
