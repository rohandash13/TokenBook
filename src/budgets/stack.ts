// OWNER: C — model stack: each team's real mix of models over the last 7 days of usage, and a proposed stack that
// swaps every model for a cheaper model of the SAME tier on the live market (any provider). How far down the price
// list it goes depends on the team's budget room: over budget takes the cheapest options, near the limit a
// balanced middle, within budget the options closest in price (the smallest change). Savings apply only to the
// spend still to come this month (TokenBook estimate − actual to date), split by the observed mix.
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

// Special-purpose variants (coding, agent-orchestration and build models) aren't general substitutes.
const SPECIAL = /multi-agent|build|code/i;
const general = (catalog: CatalogModel[]) => {
  const seen = new Set<string>();
  return catalog.filter((c) => !SPECIAL.test(c.model) && !seen.has(c.model) && seen.add(c.model));
};

/** General-purpose models of the same tier that are cheaper than `current`, cheapest first. */
export function sameTierCandidates(current: CatalogModel, catalog: CatalogModel[]): CatalogModel[] {
  return general(catalog)
    .filter((c) => c.tier === current.tier && c.model !== current.model && c.blendedPerMTok < current.blendedPerMTok)
    .sort((a, b) => a.blendedPerMTok - b.blendedPerMTok);
}

export const APPROACH: Record<Status, string> = {
  over: 'Biggest savings',
  warn: 'Balanced savings',
  ok: 'Smallest change',
};

/**
 * Pick from the cheapest third (over budget), the middle third (near the limit) or the third closest in price
 * (within budget). `turn` rotates through the band so teams in the same position get different models.
 */
export function pickForBudget(candidates: CatalogModel[], status: Status, turn: number): CatalogModel | null {
  const n = candidates.length;
  if (!n) return null;
  const third = Math.ceil(n / 3);
  const band = status === 'over' ? candidates.slice(0, third)
    : status === 'warn' ? candidates.slice(third, Math.min(n, third * 2))
    : candidates.slice(n - third);
  const from = band.length ? band : candidates;
  return from[turn % from.length];
}

/** For a frontier model: one of the strongest mid-tier models (the priciest third), as a step-down alternative. */
export function stepDownMid(current: CatalogModel, catalog: CatalogModel[], turn: number): CatalogModel | null {
  if (current.tier !== 'frontier') return null;
  const mids = general(catalog).filter((c) => c.tier === 'mid').sort((a, b) => b.blendedPerMTok - a.blendedPerMTok);
  const top = mids.slice(0, Math.ceil(mids.length / 3));
  return top.length ? top[turn % top.length] : null;
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
    const status: Status | undefined = budgets.find((b) => b.team === team)?.status;
    const turn = TEAMS.indexOf(team);
    const lines: StackLine[] = mixTotal <= 0 ? [] : [...byModel.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([usageModel, cost]) => {
        const share = cost / mixTotal;
        const remainingUsd = remaining * share;
        const cur = currentModel(usageModel, catalog);
        const next = cur ? pickForBudget(sameTierCandidates(cur, catalog), status ?? 'ok', turn) : null;
        const after = cur && next ? remainingUsd * (next.blendedPerMTok / cur.blendedPerMTok) : remainingUsd;
        const mid = cur ? stepDownMid(cur, catalog, turn) : null;
        const midAfter = cur && mid ? remainingUsd * (mid.blendedPerMTok / cur.blendedPerMTok) : 0;
        return {
          usageModel, share: round2(share), current: cur ? view(cur) : null, proposed: next ? view(next) : null,
          remainingUsd: round2(remainingUsd), remainingAfterUsd: round2(after), savingUsd: round2(remainingUsd - after),
          ...(mid && { stepDown: { model: view(mid), afterUsd: round2(midAfter), savingUsd: round2(remainingUsd - midAfter) } }),
        };
      });
    const savingUsd = round2(lines.reduce((s, l) => s + l.savingUsd, 0));
    return [{
      team, status, approach: APPROACH[status ?? 'ok'], mixFrom: from, mixTo: to,
      spentUsd: round2(est.actualToDate), projectedUsd: round2(est.estimate), remainingUsd: round2(remaining),
      lines, savingUsd, proposedProjectedUsd: round2(est.estimate - savingUsd),
    }];
  });
}
