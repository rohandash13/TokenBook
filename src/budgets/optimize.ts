// OWNER: C — workflow optimizer: for every team, its main AI task priced on its current model and on cheaper
// alternatives from the live model market, with the quality trade-off spelled out. Savings are deterministic
// (the team's own projected spend × price ratio); the trade-off text follows from the tier change.
import type { CatalogModel, Tier } from '../integrations/apify/catalog';
import type { PriceAnnouncement } from '../integrations/apify/announcements';
import { TEAM_INFO, TEAMS } from '../shared/config';
import type { Estimate, Team, UsageDay } from '../shared/types';
import { currentModel, TEAM_WORKLOADS } from './suggest';

export type WorkflowOption = {
  model: string;
  provider: string;
  tier: Tier;
  blendedPerMTok: number;
  openWeight: boolean;
  via?: string;
  url: string;
  bestFor?: string;
  monthlySavingsUsd: number;
  savingsPct: number;
  tradeoff: string;
  /** A scheduled price change for this model, from the market scrape. */
  priceChange?: { effectiveDate: string; newBlendedPerMTok: number; savingsAfterUsd: number };
};

export type WorkflowPlan = {
  team: Team;
  task: string;
  minTier: Tier;
  currentModel: string;
  currentProvider: string;
  currentTier: Tier;
  currentBlendedPerMTok: number;
  taskSpendUsd: number;
  options: WorkflowOption[];
};

const RANK: Record<Tier, number> = { light: 0, mid: 1, frontier: 2 };
const round2 = (x: number) => Math.round(x * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function tradeoffText(from: Tier, to: Tier, openWeight: boolean): string {
  const drop = RANK[from] - RANK[to];
  const base = drop <= 0
    ? 'Same tier by price: expect similar quality; check formatting and tone on a sample.'
    : drop === 1 && to === 'light'
      ? 'Lighter model: fine for classification, extraction, routing and short replies; weaker on multi-step reasoning and long, nuanced writing.'
      : drop === 1
        ? 'One tier down: keeps most everyday quality; less headroom on the hardest reasoning and long-horizon agent work.'
        : 'Two tiers down: only for simple, high-volume steps; keep the frontier model for anything that needs judgment.';
  return openWeight ? `${base} Open-weight: can be self-hosted for control over data; quality varies more by task.` : base;
}

/** Same blended-price ratio applied to an announced new price for a model. */
function announcedBlended(model: string, provider: string, anns: PriceAnnouncement[]): PriceAnnouncement | undefined {
  return anns.find((a) => a.provider === provider && a.model.toLowerCase() === model.toLowerCase());
}

export function optimizeWorkflows(
  estimates: Estimate[], usage: UsageDay[], asOf: string, catalog: CatalogModel[], announcements: PriceAnnouncement[] = [],
): WorkflowPlan[] {
  const from = addDays(asOf, -6);
  return TEAMS.flatMap((team): WorkflowPlan[] => {
    const est = estimates.find((e) => e.team === team && e.method === 'trueup');
    const recent = usage.filter((u) => u.team === team && u.date >= from && u.date <= asOf);
    const total = recent.reduce((s, u) => s + u.costUsd, 0);
    if (!est || total === 0) return [];
    const byModel = new Map<string, number>();
    for (const u of recent) byModel.set(u.model, (byModel.get(u.model) ?? 0) + u.costUsd);
    // The team's biggest-spend model that maps onto a live catalog row.
    const ranked = [...byModel].sort((a, b) => b[1] - a[1]);
    const hit = ranked.map(([m, c]) => ({ cost: c, row: currentModel(m, catalog) })).find((x) => x.row);
    if (!hit?.row) return [];
    const current = hit.row;
    const w = TEAM_WORKLOADS[team];
    const taskSpend = est.estimate * (hit.cost / total) * w.share;

    const candidates = catalog
      .filter((m) => m.blendedPerMTok < current.blendedPerMTok && RANK[m.tier] >= RANK[w.minTier])
      .map((m): WorkflowOption => {
        const saves = round2(taskSpend * (1 - m.blendedPerMTok / current.blendedPerMTok));
        const ann = announcedBlended(m.model, m.provider, announcements);
        return {
          model: m.model, provider: m.provider, tier: m.tier, blendedPerMTok: m.blendedPerMTok, openWeight: m.openWeight,
          ...(m.via ? { via: m.via } : {}), url: m.url, ...(m.bestFor ? { bestFor: m.bestFor } : {}),
          monthlySavingsUsd: saves, savingsPct: round2(1 - m.blendedPerMTok / current.blendedPerMTok),
          tradeoff: tradeoffText(current.tier, m.tier, m.openWeight),
          ...(ann ? { priceChange: {
            effectiveDate: ann.effectiveDate, newBlendedPerMTok: ann.newBlendedPerMTok,
            savingsAfterUsd: round2(taskSpend * (1 - ann.newBlendedPerMTok / current.blendedPerMTok)),
          } } : {}),
        };
      })
      .sort((a, b) => b.monthlySavingsUsd - a.monthlySavingsUsd);

    // Up to three distinct choices: the best overall, the best open-weight, and the best that stays in the same tier.
    const picks: WorkflowOption[] = [];
    const add = (o?: WorkflowOption) => { if (o && !picks.includes(o)) picks.push(o); };
    add(candidates[0]);
    add(candidates.find((o) => o.openWeight));
    add(candidates.find((o) => o.tier === current.tier));
    return [{
      team, task: w.task, minTier: w.minTier, currentModel: current.model, currentProvider: current.provider,
      currentTier: current.tier, currentBlendedPerMTok: current.blendedPerMTok, taskSpendUsd: round2(taskSpend), options: picks,
    }];
  });
}

export const planSummary = (p: WorkflowPlan): string =>
  p.options.length
    ? `${TEAM_INFO[p.team].label}: ${p.task} on ${p.currentModel} costs about $${Math.round(p.taskSpendUsd).toLocaleString('en-US')} this month; ` +
      `${p.options[0].model} would save about $${Math.round(p.options[0].monthlySavingsUsd).toLocaleString('en-US')}.`
    : `${TEAM_INFO[p.team].label}: already on the cheapest model that suits ${p.task}.`;
