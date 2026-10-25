// OWNER: C — forward cost outlook: the next three months at this month's run-rate, on today's models and on the
// optimizer's recommended plan, with every announced price change applied from its effective date.
// Deterministic. The run-rate baseline is this month's trueup estimate; no new drivers are assumed.
import type { PriceAnnouncement } from '../integrations/apify/announcements';
import type { CatalogModel } from '../integrations/apify/catalog';
import { monthLabel, nextMonth, TEAM_INFO } from '../shared/config';
import type { Estimate, Month } from '../shared/types';
import { savingsAt, type Segment, type WorkflowPlan } from './optimize';

export type OutlookMonth = {
  month: Month;
  label: string;
  currentModelsUsd: number;
  recommendedPlanUsd: number;
  /** Plain-English effect of each announced price change that touches today's models or the plan. */
  notes: string[];
};

const round2 = (x: number) => Math.round(x * 100) / 100;
const usd = (x: number) => `$${Math.round(Math.abs(x)).toLocaleString('en-US')}`;
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const effectiveBy = (a: PriceAnnouncement, month: Month) => a.effectiveDate <= `${month}-01`;
const sameModel = (a: PriceAnnouncement, provider: string, model: string) =>
  a.provider === provider && a.model.toLowerCase() === model.toLowerCase();

export type WhatIf = {
  provider: string;
  model: string;
  effectiveDate: string;
  team: WorkflowPlan['team'];
  task: string;
  /** Saving per month at today's price, and after the announced change (negative = would cost more). */
  savingsNowUsd: number;
  savingsAfterUsd: number;
  text: string;
};

const RANK = { light: 0, mid: 1, frontier: 2 } as const;
const models = (segs: Segment[]) => [...new Set(segs.map((s) => s.model))].join(' and ');

/**
 * For each announced change on a model in the market: the team workload it best fits (tier is enough and it
 * is cheaper than what serves that work today), and what moving that work would save before and after the
 * change. Shows when a cheap-looking switch stops paying off.
 */
export function announcementWhatIfs(plans: WorkflowPlan[], announcements: PriceAnnouncement[], catalog: CatalogModel[]): WhatIf[] {
  return announcements.flatMap((a): WhatIf[] => {
    const row = catalog.find((m) => sameModel(a, m.provider, m.model));
    if (!row) return [];
    const fits = plans
      .flatMap((p) => p.slices.map((s) => ({ p, s })))
      .filter(({ s }) => RANK[row.tier] >= RANK[s.minTier])
      .map(({ p, s }) => ({ p, s, now: savingsAt(s.current, s.minTier, a.currentBlendedPerMTok), after: savingsAt(s.current, s.minTier, a.newBlendedPerMTok) }))
      .filter((f) => f.now > 0)
      .sort((x, y) => y.now - x.now);
    const best = fits[0];
    if (!best) return [];
    const team = TEAM_INFO[best.p.team].label;
    const from = best.s.current.filter((x) => RANK[x.tier] >= RANK[best.s.minTier] && x.blendedPerMTok > a.currentBlendedPerMTok);
    const after = best.after < 1 ? `nothing from ${day(a.effectiveDate)}` : `only ${usd(best.after)} from ${day(a.effectiveDate)}`;
    return [{
      provider: a.provider, model: a.model, effectiveDate: a.effectiveDate, team: best.p.team, task: best.s.task,
      savingsNowUsd: best.now, savingsAfterUsd: best.after,
      text: `If ${team} moved its ${best.s.task} from ${models(from)} to ${a.model}, it would save ${usd(best.now)} a month at today's price, but ${after}.`,
    }];
  });
}

export function costOutlook(
  month: Month, estimates: Estimate[], plans: WorkflowPlan[], announcements: PriceAnnouncement[], _catalog: CatalogModel[] = [], months = 3,
): OutlookMonth[] {
  const base = estimates.filter((e) => e.month === month && e.method === 'trueup');
  const out: OutlookMonth[] = [];
  for (let m = nextMonth(month), i = 0; i < months; m = nextMonth(m), i++) {
    let current = 0;
    let planned = 0;
    const notes: string[] = [];
    for (const e of base) {
      const plan = plans.find((p) => p.team === e.team);
      const label = TEAM_INFO[e.team].label;
      // Today's models: each model's share of the team's spend re-priced if it has an announced change in effect.
      let teamCurrent = e.estimate;
      for (const seg of plan?.slices.flatMap((s) => s.current) ?? []) {
        const change = announcements.find((a) => effectiveBy(a, m) && sameModel(a, seg.provider, seg.model));
        if (change) teamCurrent += seg.spendUsd * (change.newBlendedPerMTok / change.currentBlendedPerMTok - 1);
      }
      if (teamCurrent !== e.estimate) notes.push(`${label}: price changes on today's models add ${usd(teamCurrent - e.estimate)}.`);
      current += teamCurrent;
      // Recommended plan: each workload's suggested switch, at the price in effect that month.
      let saves = 0;
      for (const s of plan?.slices ?? []) {
        const top = s.options[0];
        if (!top) continue;
        const later = top.priceChange && top.priceChange.effectiveDate <= `${m}-01`;
        saves += later ? top.priceChange!.savingsAfterUsd : top.monthlySavingsUsd;
        if (later) {
          notes.push(`${label}: the suggested ${top.model} price rises from ${top.priceChange!.effectiveDate}, ` +
            `so moving ${s.task} saves ${usd(top.priceChange!.savingsAfterUsd)} instead of ${usd(top.monthlySavingsUsd)}.`);
        }
      }
      planned += saves ? e.estimate - saves : teamCurrent;
    }
    out.push({ month: m, label: monthLabel(m), currentModelsUsd: round2(current), recommendedPlanUsd: round2(planned), notes });
  }
  return out;
}
