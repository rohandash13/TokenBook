// OWNER: C
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from '../integrations/apify/catalog';
import type { Estimate, UsageDay } from '../shared/types';
import { cheapestSameTier, mixWindow, proposeStacks } from './stack';

const cat = (provider: string, model: string, blendedPerMTok: number, tier: CatalogModel['tier']): CatalogModel => ({
  provider, model, blendedPerMTok, tier, inputPerMTok: blendedPerMTok, outputPerMTok: blendedPerMTok,
  openWeight: false, url: `https://x/${model}`, fetchedAt: '2026-10-24T00:00:00Z',
});
const catalog = [
  cat('Anthropic', 'Claude Sonnet 5.5', 4, 'mid'),
  cat('Google', 'Gemini Flash', 1, 'mid'),
  cat('Anthropic', 'Claude Haiku 5.5', 0.2, 'light'),
  cat('Anthropic', 'Claude Opus 5.5', 15, 'frontier'),
  cat('Moonshot', 'kimi-k3', 6, 'frontier'),
];
const day = (date: string, model: string, costUsd: number, team: UsageDay['team'] = 'search'): UsageDay =>
  ({ date, team, model, costUsd, inputTokens: 0, outputTokens: 0, source: 'anthropic' });
const est = (team: Estimate['team'], estimate: number, actualToDate: number): Estimate =>
  ({ team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate, confidence: 'medium', basis: '' });

describe('cheapestSameTier', () => {
  it('picks the cheapest cheaper model of the same tier, from any provider', () => {
    expect(cheapestSameTier(catalog[0], catalog)?.model).toBe('Gemini Flash');
    expect(cheapestSameTier(catalog[3], catalog)?.model).toBe('kimi-k3');
  });

  it('returns null when the model is already the cheapest of its tier', () => {
    expect(cheapestSameTier(catalog[2], catalog)).toBeNull();
  });
});

describe('proposeStacks', () => {
  // Last 7 days: 75% Sonnet, 25% Haiku. Spent $6,000 of a $10,000 projection: $4,000 still to come.
  const usage = [
    day('2026-10-19', 'claude-sonnet', 300), day('2026-10-25', 'claude-sonnet', 450),
    day('2026-10-22', 'claude-haiku', 250),
    day('2026-10-10', 'claude-opus', 9999), // outside the 7-day window: not part of the stack
  ];

  it('prices only the rest of the month, split by the observed mix', () => {
    const [s] = proposeStacks([est('search', 10000, 6000)], usage, '2026-10-25', catalog);
    expect(s).toMatchObject({ team: 'search', spentUsd: 6000, projectedUsd: 10000, remainingUsd: 4000, mixFrom: '2026-10-19', mixTo: '2026-10-25' });
    expect(s.lines.map((l) => l.usageModel)).toEqual(['claude-sonnet', 'claude-haiku']);
    // Sonnet: 75% of $4,000 = $3,000, on Gemini Flash at 1/4 the price = $750, saving $2,250.
    expect(s.lines[0]).toMatchObject({ share: 0.75, remainingUsd: 3000, remainingAfterUsd: 750, savingUsd: 2250, proposed: { model: 'Gemini Flash' } });
    // Haiku is already the cheapest lightweight model: no swap, no saving.
    expect(s.lines[1]).toMatchObject({ share: 0.25, remainingUsd: 1000, remainingAfterUsd: 1000, savingUsd: 0, proposed: null });
    expect(s).toMatchObject({ savingUsd: 2250, proposedProjectedUsd: 7750 });
  });

  it('saves nothing when the month is already spent', () => {
    const [s] = proposeStacks([est('search', 6000, 6000)], usage, '2026-10-25', catalog);
    expect(s.remainingUsd).toBe(0);
    expect(s.savingUsd).toBe(0);
  });

  it('keeps a model it cannot find on the market, with no saving', () => {
    const [s] = proposeStacks([est('search', 10000, 6000)], [day('2026-10-24', 'mystery-model', 100)], '2026-10-25', catalog);
    expect(s.lines[0]).toMatchObject({ current: null, proposed: null, savingUsd: 0, remainingUsd: 4000 });
  });

  it('offers frontier models a step down to the strongest mid model, outside the team total', () => {
    // $4,000 left, all on Opus ($15). Same tier: kimi-k3 ($6). Step down: Sonnet ($4), the priciest mid.
    const [s] = proposeStacks([est('search', 10000, 6000)], [day('2026-10-24', 'claude-opus', 100)], '2026-10-25', catalog);
    expect(s.lines[0]).toMatchObject({ proposed: { model: 'kimi-k3' }, remainingAfterUsd: 1600, savingUsd: 2400 });
    expect(s.lines[0].stepDown).toMatchObject({ model: { model: 'Claude Sonnet 5.5', tier: 'mid' }, afterUsd: 1066.67, savingUsd: 2933.33 });
    expect(s.savingUsd).toBe(2400);
  });

  it('offers no step down below frontier', () => {
    const [s] = proposeStacks([est('search', 10000, 6000)], usage, '2026-10-25', catalog);
    expect(s.lines.every((l) => l.stepDown === undefined)).toBe(true);
  });

  it('carries the budget status through', () => {
    const [s] = proposeStacks([est('search', 10000, 6000)], usage, '2026-10-25', catalog,
      [{ team: 'search', budgetUsd: 9000, projectedUsd: 10000, actualToDateUsd: 6000, pctOfBudget: 1.11, headroomUsd: -1000, status: 'over' }]);
    expect(s.status).toBe('over');
  });

  it('reads the mix from the 7 days ending asOf', () => {
    expect(mixWindow('2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });
});
