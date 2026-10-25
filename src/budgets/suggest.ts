// OWNER: C — "over budget → here's a cheaper model": deterministic savings from each team's own spend,
// re-priced at live scraped prices. A suggestion only: quality on the team's workload is not verified.
import type { CatalogModel, Tier } from '../integrations/apify/catalog';
import type { ModelSuggestion, TeamBudgetCheck } from '../shared/api';
import { TEAM_INFO } from '../shared/config';
import type { Team, UsageDay } from '../shared/types';

export type Level = 'high' | 'medium' | 'low';
export type WorkloadSlice = { level: Level; task: string; share: number; minTier: Tier };

/**
 * SYNTHETIC: each Northwind team's AI work split into high, medium and low difficulty, the share of the
 * team's spend each takes, and the lightest tier that can do it. Real usage isn't tagged by task, so this is
 * a labelled assumption. Shares sum to 1.
 */
export const TEAM_WORKLOADS: Record<Team, WorkloadSlice[]> = {
  support: [
    { level: 'high', task: 'escalations and refund decisions', share: 0.15, minTier: 'mid' },
    { level: 'medium', task: 'multi-turn customer replies', share: 0.25, minTier: 'mid' },
    { level: 'low', task: 'ticket triage and first replies', share: 0.6, minTier: 'light' },
  ],
  search: [
    { level: 'high', task: 'answer synthesis over long documents', share: 0.2, minTier: 'mid' },
    { level: 'medium', task: 'result reranking', share: 0.3, minTier: 'mid' },
    { level: 'low', task: 'query rewriting', share: 0.5, minTier: 'light' },
  ],
  growth: [
    { level: 'high', task: 'brand and launch copy', share: 0.3, minTier: 'mid' },
    { level: 'medium', task: 'personalised campaign emails', share: 0.4, minTier: 'light' },
    { level: 'low', task: 'subject lines and A/B variants', share: 0.3, minTier: 'light' },
  ],
  platform: [
    { level: 'high', task: 'incident root-cause analysis', share: 0.2, minTier: 'frontier' },
    { level: 'medium', task: 'log summarisation', share: 0.3, minTier: 'mid' },
    { level: 'low', task: 'embeddings prep and tagging', share: 0.5, minTier: 'light' },
  ],
};

/** A team's biggest workload by share of spend (the first on a tie). */
export const mainWorkload = (team: Team): WorkloadSlice =>
  TEAM_WORKLOADS[team].reduce((a, b) => (b.share > a.share ? b : a));

/** Fixture model ids → the model family on each provider's live pricing page. */
const FAMILY: Record<string, { provider: string; pattern: RegExp }> = {
  'claude-haiku': { provider: 'Anthropic', pattern: /haiku/i },
  'claude-sonnet': { provider: 'Anthropic', pattern: /sonnet/i },
  'claude-opus': { provider: 'Anthropic', pattern: /opus/i },
  'gpt-4.1-mini': { provider: 'OpenAI', pattern: /luna/i },
};

const RANK: Record<Tier, number> = { light: 0, mid: 1, frontier: 2 };
const round2 = (x: number) => Math.round(x * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The newest-listed row for a family: pricing pages list the current model first. */
export function currentModel(fixtureModel: string, catalog: CatalogModel[]): CatalogModel | null {
  const f = FAMILY[fixtureModel];
  return f ? catalog.find((m) => m.provider === f.provider && f.pattern.test(m.model)) ?? null : null;
}

/**
 * For each team that is over or near its budget: take its biggest-spend model, assume the team's main task
 * is TEAM_WORKLOADS.share of that spend, and price the task on every cheaper catalog model of a sufficient tier.
 * Returns the best same-provider option and the best other option (often open-weight), by savings.
 */
export function suggestModels(
  checks: TeamBudgetCheck[], usage: UsageDay[], asOf: string, catalog: CatalogModel[],
): ModelSuggestion[] {
  const from = addDays(asOf, -6);
  return checks.filter((c) => c.status !== 'ok').flatMap((c): ModelSuggestion[] => {
    const recent = usage.filter((u) => u.team === c.team && u.date >= from && u.date <= asOf);
    const total = recent.reduce((s, u) => s + u.costUsd, 0);
    if (total === 0) return [];
    const byModel = new Map<string, number>();
    for (const u of recent) byModel.set(u.model, (byModel.get(u.model) ?? 0) + u.costUsd);
    const [topModel, topCost] = [...byModel].sort((a, b) => b[1] - a[1])[0];
    const current = currentModel(topModel, catalog);
    if (!current) return [];
    const w = mainWorkload(c.team);
    const taskSpend = c.projectedUsd * (topCost / total) * w.share;
    const options = catalog
      .filter((m) => m.blendedPerMTok < current.blendedPerMTok && RANK[m.tier] >= RANK[w.minTier])
      .map((m) => ({ m, saves: round2(taskSpend * (1 - m.blendedPerMTok / current.blendedPerMTok)) }))
      .sort((a, b) => b.saves - a.saves);
    const same = options.find((o) => o.m.provider === current.provider);
    const other = options.find((o) => o.m.provider !== current.provider);
    return [same, other].filter((o): o is { m: CatalogModel; saves: number } => !!o).map(({ m, saves }) => ({
      team: c.team,
      task: w.task,
      fromModel: current.model,
      fromBlendedPerMTok: current.blendedPerMTok,
      toModel: m.model,
      toProvider: m.provider,
      toBlendedPerMTok: m.blendedPerMTok,
      toTier: m.tier,
      openWeight: m.openWeight,
      taskSpendUsd: round2(taskSpend),
      monthlySavingsUsd: saves,
      coversOverage: c.headroomUsd < 0 ? saves >= -c.headroomUsd : undefined,
      sourceUrl: m.url,
      fetchedAt: m.fetchedAt,
      text: `Move ${TEAM_INFO[c.team].label}'s ${w.task} (about ${Math.round(w.share * 100)}% of its ${current.model} spend) ` +
        `to ${m.model}${m.openWeight ? ' (open-weight)' : ''}: about $${Math.round(saves).toLocaleString('en-US')} less this month.`,
    }));
  });
}
