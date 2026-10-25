// OWNER: C — forward cost outlook: the next three months at this month's run-rate, on today's models and on the
// optimizer's recommended plan, with every announced price change applied from its effective date.
// Deterministic. The run-rate baseline is this month's trueup estimate; no new drivers are assumed.
import type { PriceAnnouncement } from '../integrations/apify/announcements';
import type { CatalogModel } from '../integrations/apify/catalog';
import { monthLabel, nextMonth, TEAM_INFO } from '../shared/config';
import type { Estimate, Month } from '../shared/types';
import type { WorkflowPlan } from './optimize';

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

/**
 * For each announced change on a model in the market: the team whose main task that model best fits
 * (tier is enough, and it is cheaper than the team's current model today), and what moving that task would
 * save before and after the change. Shows when a cheap-looking switch stops paying off.
 */
export function announcementWhatIfs(plans: WorkflowPlan[], announcements: PriceAnnouncement[], catalog: CatalogModel[]): WhatIf[] {
  return announcements.flatMap((a): WhatIf[] => {
    const row = catalog.find((m) => sameModel(a, m.provider, m.model));
    if (!row) return [];
    const fits = plans
      .filter((p) => RANK[row.tier] >= RANK[p.minTier] && a.currentBlendedPerMTok < p.currentBlendedPerMTok)
      .map((p) => ({
        p,
        now: round2(p.taskSpendUsd * (1 - a.currentBlendedPerMTok / p.currentBlendedPerMTok)),
        after: round2(p.taskSpendUsd * (1 - a.newBlendedPerMTok / p.currentBlendedPerMTok)),
      }))
      .sort((x, y) => y.now - x.now);
    const best = fits[0];
    if (!best) return [];
    const team = TEAM_INFO[best.p.team].label;
    const after = Math.abs(best.after) < 1 ? `nothing from ${day(a.effectiveDate)}`
      : best.after > 0 ? `only ${usd(best.after)} from ${day(a.effectiveDate)}` : `${usd(best.after)} more per month from ${day(a.effectiveDate)}`;
    return [{
      provider: a.provider, model: a.model, effectiveDate: a.effectiveDate, team: best.p.team, task: best.p.task,
      savingsNowUsd: best.now, savingsAfterUsd: best.after,
      text: `If ${team} moved its ${best.p.task} from ${best.p.currentModel} to ${a.model}, it would save ${usd(best.now)} a month at today's price, but ${after}.`,
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
      // Today's models: a team's main task re-priced if its current model has an announced change in effect.
      let teamCurrent = e.estimate;
      const onCurrent = plan && announcements.find((a) => effectiveBy(a, m) && sameModel(a, plan.currentProvider, plan.currentModel));
      if (plan && onCurrent) {
        const delta = plan.taskSpendUsd * (onCurrent.newBlendedPerMTok / onCurrent.currentBlendedPerMTok - 1);
        teamCurrent += delta;
        notes.push(`${TEAM_INFO[e.team].label}: ${onCurrent.model} price change from ${onCurrent.effectiveDate} adds ${usd(delta)}.`);
      }
      current += teamCurrent;
      // Recommended plan: the top option per team, at the price in effect that month.
      const top = plan?.options[0];
      if (!top) { planned += teamCurrent; continue; }
      const later = top.priceChange && top.priceChange.effectiveDate <= `${m}-01`;
      const saves = later ? top.priceChange!.savingsAfterUsd : top.monthlySavingsUsd;
      planned += e.estimate - saves;
      if (later) {
        notes.push(`${TEAM_INFO[e.team].label}: the suggested ${top.model} price rises from ${top.priceChange!.effectiveDate}, ` +
          `so the switch saves ${usd(top.priceChange!.savingsAfterUsd)} instead of ${usd(top.monthlySavingsUsd)}.`);
      }
    }
    out.push({ month: m, label: monthLabel(m), currentModelsUsd: round2(current), recommendedPlanUsd: round2(planned), notes });
  }
  return out;
}
