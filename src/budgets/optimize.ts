// OWNER: C — workflow optimizer: each team's AI work split into high, medium and low workloads, each priced on
// the models serving it today and on cheaper models from the live market that still meet its minimum tier.
// Two inputs decide the suggestion: how hard the work is (the minimum tier per workload) and how close the
// team is to its budget (near or over: the cheapest model that meets the minimum; within: only work on a
// stronger model than it needs moves down, to the most capable-by-price model of the tier it needs).
// Savings are deterministic: the workload's share of the team's projected spend × price ratio.
import type { CatalogModel, Tier } from '../integrations/apify/catalog';
import type { PriceAnnouncement } from '../integrations/apify/announcements';
import type { TeamBudgetCheck } from '../shared/api';
import { TEAM_INFO, TEAMS } from '../shared/config';
import type { Estimate, Team, UsageDay } from '../shared/types';
import { currentModel, TEAM_WORKLOADS, type Level } from './suggest';

export type Stance = 'save' | 'balanced';

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

/** One model serving part of a workload today, with the spend it carries. */
export type Segment = { model: string; provider: string; tier: Tier; blendedPerMTok: number; spendUsd: number };

export type SlicePlan = {
  level: Level;
  task: string;
  share: number;
  minTier: Tier;
  spendUsd: number;
  current: Segment[];
  /** First is the suggestion for the team's stance; the rest are alternatives. Empty: keep as is. */
  options: WorkflowOption[];
  /** Spend on models below the workload's minimum tier: a quality risk, not a saving. */
  underpowered: Segment[];
};

export type WorkflowPlan = {
  team: Team;
  stance: Stance;
  stanceReason: string;
  spendUsd: number;
  slices: SlicePlan[];
  /** Sum of each workload's suggested switch. */
  monthlySavingsUsd: number;
};

const RANK: Record<Tier, number> = { light: 0, mid: 1, frontier: 2 };
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => `${Math.round(x * 100)}%`;
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

/** Near or over budget: save. Within budget, or no budget set: balanced. */
export function stanceFor(budget: TeamBudgetCheck | undefined): { stance: Stance; reason: string } {
  if (budget?.status === 'over' || budget?.status === 'warn') {
    const where = budget.status === 'over' ? `Over budget (${pct(budget.pctOfBudget)})` : `Near its limit (${pct(budget.pctOfBudget)} of budget)`;
    return { stance: 'save', reason: `${where}: every workload gets the cheapest model that still meets its minimum tier, hard work included.` };
  }
  const where = budget ? `Within budget (${pct(budget.pctOfBudget)})` : 'No budget set';
  return { stance: 'balanced', reason: `${where}: only work running on a stronger model than it needs moves down, to the most capable model of the tier it needs.` };
}

/** What moving a workload's eligible segments to a model at `price` saves: segments at or above the minimum tier that cost more. */
export function savingsAt(current: Segment[], minTier: Tier, price: number): number {
  return round2(current
    .filter((s) => RANK[s.tier] >= RANK[minTier] && s.blendedPerMTok > price)
    .reduce((t, s) => t + s.spendUsd * (1 - price / s.blendedPerMTok), 0));
}

/**
 * Splits the team's spend across its workloads, hardest first, filling each from the strongest models first:
 * a team that routes sends its hard work to its strongest model. Returns segments per workload.
 */
function allocate(models: Segment[], shares: number[]): Segment[][] {
  const pool = [...models].sort((a, b) => RANK[b.tier] - RANK[a.tier] || b.blendedPerMTok - a.blendedPerMTok).map((m) => ({ ...m }));
  const total = pool.reduce((t, m) => t + m.spendUsd, 0);
  return shares.map((share) => {
    let need = share * total;
    const out: Segment[] = [];
    for (const m of pool) {
      if (need <= 1e-9) break;
      const take = Math.min(m.spendUsd, need);
      if (take <= 1e-9) continue;
      out.push({ ...m, spendUsd: round2(take) });
      m.spendUsd -= take;
      need -= take;
    }
    return out;
  });
}

function option(m: CatalogModel, slice: { current: Segment[]; minTier: Tier }, announcements: PriceAnnouncement[]): WorkflowOption {
  const movable = slice.current.filter((s) => RANK[s.tier] >= RANK[slice.minTier] && s.blendedPerMTok > m.blendedPerMTok);
  const before = movable.reduce((t, s) => t + s.spendUsd, 0);
  const saves = savingsAt(slice.current, slice.minTier, m.blendedPerMTok);
  const from = movable.reduce((a, b) => (b.spendUsd > a.spendUsd ? b : a), movable[0]);
  const ann = announcements.find((a) => a.provider === m.provider && a.model.toLowerCase() === m.model.toLowerCase());
  return {
    model: m.model, provider: m.provider, tier: m.tier, blendedPerMTok: m.blendedPerMTok, openWeight: m.openWeight,
    ...(m.via ? { via: m.via } : {}), url: m.url, ...(m.bestFor ? { bestFor: m.bestFor } : {}),
    monthlySavingsUsd: saves, savingsPct: before ? round2(saves / before) : 0,
    tradeoff: tradeoffText(from?.tier ?? m.tier, m.tier, m.openWeight),
    ...(ann ? { priceChange: {
      effectiveDate: ann.effectiveDate, newBlendedPerMTok: ann.newBlendedPerMTok,
      savingsAfterUsd: savingsAt(slice.current, slice.minTier, ann.newBlendedPerMTok),
    } } : {}),
  };
}

/** The suggestion for one workload under the team's stance, then the cheapest open-weight and same-provider alternatives. */
function pickOptions(stance: Stance, slice: { current: Segment[]; minTier: Tier }, catalog: CatalogModel[], announcements: PriceAnnouncement[]): WorkflowOption[] {
  const eligible = slice.current.filter((s) => RANK[s.tier] >= RANK[slice.minTier]);
  if (!eligible.length) return [];
  const ceiling = Math.max(...eligible.map((s) => s.blendedPerMTok));
  // Balanced: only work on a stronger tier than it needs moves, and only into the tier it needs.
  const overpowered = eligible.some((s) => RANK[s.tier] > RANK[slice.minTier]);
  if (stance === 'balanced' && !overpowered) return [];
  const pool = catalog
    .filter((m) => m.blendedPerMTok < ceiling && RANK[m.tier] >= RANK[slice.minTier])
    .filter((m) => stance === 'save' || m.tier === slice.minTier)
    .map((m) => option(m, slice, announcements))
    .filter((o) => o.monthlySavingsUsd > 0);
  if (!pool.length) return [];
  const cheapest = [...pool].sort((a, b) => a.blendedPerMTok - b.blendedPerMTok || b.monthlySavingsUsd - a.monthlySavingsUsd);
  const top = stance === 'save' ? cheapest[0] : [...pool].sort((a, b) => b.blendedPerMTok - a.blendedPerMTok)[0];
  const picks: WorkflowOption[] = [top];
  const add = (o?: WorkflowOption) => { if (o && !picks.some((p) => p.model === o.model && p.provider === o.provider)) picks.push(o); };
  add(cheapest.find((o) => o.openWeight));
  add(cheapest.find((o) => o.provider === eligible[0].provider));
  return picks;
}

export function optimizeWorkflows(
  estimates: Estimate[], usage: UsageDay[], asOf: string, catalog: CatalogModel[],
  announcements: PriceAnnouncement[] = [], budgets: TeamBudgetCheck[] = [],
): WorkflowPlan[] {
  const from = addDays(asOf, -6);
  return TEAMS.flatMap((team): WorkflowPlan[] => {
    const est = estimates.find((e) => e.team === team && e.method === 'trueup');
    const recent = usage.filter((u) => u.team === team && u.date >= from && u.date <= asOf);
    if (!est) return [];
    // Recent cost per model that maps onto a live catalog row; the team's projected spend split by that mix.
    const byRow = new Map<CatalogModel, number>();
    for (const u of recent) {
      const row = currentModel(u.model, catalog);
      if (row) byRow.set(row, (byRow.get(row) ?? 0) + u.costUsd);
    }
    const mapped = [...byRow.values()].reduce((t, c) => t + c, 0);
    if (mapped === 0) return [];
    const models: Segment[] = [...byRow].map(([r, c]) => ({
      model: r.model, provider: r.provider, tier: r.tier, blendedPerMTok: r.blendedPerMTok, spendUsd: est.estimate * (c / mapped),
    }));
    const work = TEAM_WORKLOADS[team];
    const parts = allocate(models, work.map((w) => w.share));
    const { stance, reason } = stanceFor(budgets.find((b) => b.team === team));
    const slices = work.map((w, i): SlicePlan => {
      const current = parts[i];
      const slice = { current, minTier: w.minTier };
      return {
        level: w.level, task: w.task, share: w.share, minTier: w.minTier,
        spendUsd: round2(current.reduce((t, s) => t + s.spendUsd, 0)), current,
        options: pickOptions(stance, slice, catalog, announcements),
        underpowered: current.filter((s) => RANK[s.tier] < RANK[w.minTier]),
      };
    });
    return [{
      team, stance, stanceReason: reason, spendUsd: round2(est.estimate), slices,
      monthlySavingsUsd: round2(slices.reduce((t, s) => t + (s.options[0]?.monthlySavingsUsd ?? 0), 0)),
    }];
  });
}

export const planSummary = (p: WorkflowPlan): string => {
  const moves = p.slices.filter((s) => s.options.length);
  return moves.length
    ? `${TEAM_INFO[p.team].label}: ${moves.map((s) => `${s.task} to ${s.options[0].model}`).join(', ')} would save about ` +
      `$${Math.round(p.monthlySavingsUsd).toLocaleString('en-US')} a month.`
    : `${TEAM_INFO[p.team].label}: every workload is already on a model that fits it.`;
};
