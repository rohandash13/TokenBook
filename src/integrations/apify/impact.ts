// OWNER: C — deterministic effect of a model price change on each team's daily AI API cost.
import { TEAMS } from '../../shared/config';
import type { Team, UsageDay } from '../../shared/types';
import type { ExternalEvent } from '../merge';
import type { PriceChange } from '../types';

const WINDOW_DAYS = 7;
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * 1 + (team's share of the last 7 days' cost on that model) × (new cost / old cost − 1),
 * where new/old cost reprices the team's own input and output tokens. Null when the team doesn't use the model.
 */
export function teamPriceMultiplier(team: Team, change: PriceChange, usage: UsageDay[], asOf: string): number | null {
  const from = addDays(asOf, -(WINDOW_DAYS - 1));
  const window = usage.filter((u) => u.team === team && u.date >= from && u.date <= asOf);
  const total = sum(window.map((u) => u.costUsd));
  const onModel = window.filter((u) => u.model === change.model);
  const modelCost = sum(onModel.map((u) => u.costUsd));
  if (total === 0 || modelCost === 0) return null;
  const inTok = sum(onModel.map((u) => u.inputTokens));
  const outTok = sum(onModel.map((u) => u.outputTokens));
  const oldCost = inTok * change.from.inputPerMTok + outTok * change.from.outputPerMTok;
  const ratio = oldCost > 0
    ? (inTok * change.to.inputPerMTok + outTok * change.to.outputPerMTok) / oldCost
    : change.to.inputPerMTok / change.from.inputPerMTok;
  return round4(1 + (modelCost / total) * (ratio - 1));
}

/** One event per affected team, from the effective date, for changes announced by asOf. */
export function priceEvents(changes: PriceChange[], usage: UsageDay[], asOf: string): ExternalEvent[] {
  return changes
    .filter((c) => c.announcedAt <= asOf)
    .flatMap((c) => TEAMS.flatMap((team): ExternalEvent[] => {
      const multiplier = teamPriceMultiplier(team, c, usage, asOf);
      if (multiplier === null || multiplier === 1) return [];
      const pct = Math.round((c.to.inputPerMTok / c.from.inputPerMTok - 1) * 100);
      return [{
        team, date: c.effectiveDate, multiplier,
        note: `${c.model} price ${pct > 0 ? '+' : ''}${pct}%`,
        source: 'web',
        evidence: [{ source: 'web', id: `price:${c.provider}:${c.model}:${c.effectiveDate}`, url: c.url, text: c.excerpt, date: c.announcedAt }],
      }];
    }));
}
