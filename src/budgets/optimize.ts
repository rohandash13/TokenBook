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

export type Stance = 'save' | 'trim' | 'balanced';

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

/** Over budget: save. Near its limit: trim. Within budget, or no budget set: balanced. */
export function stanceFor(budget: TeamBudgetCheck | undefined): { stance: Stance; reason: string } {
  if (budget?.status === 'over') {
    return { stance: 'save', reason: `Over budget (${pct(budget.pctOfBudget)}): every workload gets the cheapest models that still meet its minimum tier, hard work included.` };
  }
  if (budget?.status === 'warn') {
    return { stance: 'trim', reason: `Near its limit (${pct(budget.pctOfBudget)} of budget): every workload gets cheaper models that meet its minimum tier, keeping a little headroom over the very cheapest.` };
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

/**
 * The suggestions for one workload under the team's stance, one model per provider. Save: the cheapest that meet
 * the minimum; trim: the next cheapest after those (a little more headroom); balanced: the most capable-by-price
 * in the tier the work needs. `turn` rotates which leads, so teams don't all get the same name.
 */
function pickOptions(
  stance: Stance, slice: { current: Segment[]; minTier: Tier }, catalog: CatalogModel[], announcements: PriceAnnouncement[], turn: number,
): WorkflowOption[] {
  const eligible = slice.current.filter((s) => RANK[s.tier] >= RANK[slice.minTier]);
  if (!eligible.length) return [];
  const ceiling = Math.max(...eligible.map((s) => s.blendedPerMTok));
  // Balanced: only work on a stronger tier than it needs moves, and only into the tier it needs.
  const overpowered = eligible.some((s) => RANK[s.tier] > RANK[slice.minTier]);
  if (stance === 'balanced' && !overpowered) return [];
  const pool = catalog
    .filter((m) => m.blendedPerMTok < ceiling && RANK[m.tier] >= RANK[slice.minTier])
    .filter((m) => stance !== 'balanced' || m.tier === slice.minTier)
    .sort((x, y) => stance === 'balanced' ? y.blendedPerMTok - x.blendedPerMTok : x.blendedPerMTok - y.blendedPerMTok);
  const perProvider = pool.filter((m, i) => pool.findIndex((o) => o.provider === m.provider) === i);
  // Trim skips the cheapest provider's model when there are enough others to choose from.
  const window = stance === 'save' ? perProvider.slice(0, 3) : stance === 'trim' && perProvider.length > 3 ? perProvider.slice(1, 5) : perProvider.slice(0, 4);
  // Within budget the rotation is offset by one, so a team crossing its budget sees a different lead.
  const lead = window.length ? (turn + (stance === 'balanced' ? 1 : 0)) % window.length : 0;
  return [...window.slice(lead), ...window.slice(0, lead)].slice(0, 3)
    .map((m) => option(m, slice, announcements))
    .filter((o) => o.monthlySavingsUsd > 0);
}

export function optimizeWorkflows(
  estimates: Estimate[], _usage: UsageDay[], _asOf: string, catalog: CatalogModel[],
  announcements: PriceAnnouncement[] = [], budgets: TeamBudgetCheck[] = [],
): WorkflowPlan[] {
  return TEAMS.flatMap((team): WorkflowPlan[] => {
    const est = estimates.find((e) => e.team === team && e.method === 'trueup');
    if (!est) return [];
    const { stance, reason } = stanceFor(budgets.find((b) => b.team === team));
    const slices = TEAM_WORKLOADS[team].map((w, i): SlicePlan => {
      const row = currentModel(w.runsOn, catalog);
      const spendUsd = round2(est.estimate * w.share);
      const current: Segment[] = row ? [{ model: row.model, provider: row.provider, tier: row.tier, blendedPerMTok: row.blendedPerMTok, spendUsd }] : [];
      return {
        level: w.level, task: w.task, share: w.share, minTier: w.minTier, spendUsd, current,
        options: pickOptions(stance, { current, minTier: w.minTier }, catalog, announcements, TEAMS.indexOf(team) * 4 + i),
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
