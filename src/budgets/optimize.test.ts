// OWNER: C
import { describe, expect, it } from 'vitest';
import type { PriceAnnouncement } from '../integrations/apify/announcements';
import { guardAnnouncements, dateInText } from '../integrations/apify/announcements';
import type { CatalogModel } from '../integrations/apify/catalog';
import type { Estimate, UsageDay } from '../shared/types';
import type { Status, TeamBudgetCheck } from '../shared/api';
import { optimizeWorkflows, stanceFor, tradeoffText, type WorkflowPlan } from './optimize';
import { announcementWhatIfs, costOutlook } from './outlook';

const m = (provider: string, model: string, input: number, output: number, openWeight = false): CatalogModel => {
  const b = (3 * input + output) / 4;
  return { provider, model, inputPerMTok: input, outputPerMTok: output, blendedPerMTok: b, tier: b < 1 ? 'light' : b < 5 ? 'mid' : 'frontier', openWeight, url: 'https://x.example', fetchedAt: '2026-10-25T00:00:00Z' };
};
const catalog = [
  m('Anthropic', 'Claude Opus 5.5', 5, 25), m('Anthropic', 'Claude Sonnet 5.5', 2, 10), m('Anthropic', 'Claude Haiku 5.5', 0.1, 0.5),
  m('DeepSeek', 'deepseek-flash', 0.3, 1.2, true), m('Google', 'Gemini 3.8 Flash', 0.75, 3.75),
];
const est = (team: Estimate['team'], estimate: number): Estimate => ({ team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate: 0, confidence: 'high', basis: 'b' });
const budget = (team: Estimate['team'], status: Status, pctOfBudget: number): TeamBudgetCheck =>
  ({ team, status, pctOfBudget, budgetUsd: 1, projectedUsd: 1, actualToDateUsd: 0, headroomUsd: 0 });
const usage: UsageDay[] = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${19 + i}`, team: 'support' as const, model: 'claude-sonnet', costUsd: 100, inputTokens: 1, outputTokens: 1, source: 'anthropic' as const }));
const ann: PriceAnnouncement = {
  provider: 'Google', model: 'Gemini 3.8 Flash', effectiveDate: '2027-01-01', currentInputPerMTok: 0.75, newInputPerMTok: 1.5,
  currentOutputPerMTok: 3.75, newOutputPerMTok: 7.5, currentBlendedPerMTok: 1.5, newBlendedPerMTok: 3, changePct: 1,
  excerpt: '$0.75 through December 31, 2026. $1.50 starting January 1, 2027.', url: 'https://ai.google.dev', fetchedAt: '2026-10-25T00:00:00Z',
};

describe('tradeoffText', () => {
  it('explains the quality trade-off from the tier change', () => {
    expect(tradeoffText('mid', 'light', false)).toMatch(/^Lighter model: fine for classification/);
    expect(tradeoffText('mid', 'mid', true)).toMatch(/^Same tier by price.*Open-weight/);
  });
});

describe('optimizeWorkflows', () => {
  const over = budget('support', 'over', 1.18);
  const [plan] = optimizeWorkflows([est('support', 10000)], usage, '2026-10-25', catalog, [ann], [over]);
  const slice = (p: WorkflowPlan, level: string) => p.slices.find((s) => s.level === level)!;

  it('splits the team spend into high, medium and low workloads', () => {
    // Support: 15% escalations, 25% replies, 60% triage of 10,000, all on Sonnet today.
    expect(plan.slices.map((s) => [s.level, s.minTier, s.spendUsd])).toEqual([['high', 'mid', 1500], ['medium', 'mid', 2500], ['low', 'light', 6000]]);
    expect(slice(plan, 'high').current.map((c) => c.model)).toEqual(['Claude Sonnet 5.5']);
  });

  it('near or over budget: the cheapest model that meets each minimum, hard work included', () => {
    expect(plan.stance).toBe('save');
    // High needs mid: Gemini 3.8 Flash at 1.50 vs Sonnet 4.00 saves 1,500 × 62.5%.
    expect(slice(plan, 'high').options[0]).toMatchObject({ model: 'Gemini 3.8 Flash', monthlySavingsUsd: 937.5 });
    expect(slice(plan, 'low').options.map((o) => [o.model, o.monthlySavingsUsd])).toEqual([['Claude Haiku 5.5', 5700], ['deepseek-flash', 5212.5]]);
    expect(plan.monthlySavingsUsd).toBe(937.5 + 1562.5 + 5700);
  });

  it('within budget: only over-powered work moves, to the most capable model of the tier it needs', () => {
    const [p] = optimizeWorkflows([est('support', 10000)], usage, '2026-10-25', catalog, [], [budget('support', 'ok', 0.7)]);
    expect(p.stance).toBe('balanced');
    expect(slice(p, 'high').options).toEqual([]);
    expect(slice(p, 'low').options[0]).toMatchObject({ model: 'deepseek-flash', monthlySavingsUsd: 5212.5 });
  });

  it('routes a team’s hardest work to its strongest model and flags work below its minimum tier', () => {
    const mixed = usage.flatMap((u) => [{ ...u, team: 'platform' as const, model: 'claude-opus' }, { ...u, team: 'platform' as const, model: 'claude-haiku' }]);
    const [p] = optimizeWorkflows([est('platform', 10000)], mixed, '2026-10-25', catalog);
    // Opus carries 5,000: all of high (2,000) and medium (3,000); Haiku carries low.
    expect(slice(p, 'high')).toMatchObject({ options: [], current: [{ model: 'Claude Opus 5.5', spendUsd: 2000 }] });
    expect(slice(p, 'medium').options[0]).toMatchObject({ model: 'Claude Sonnet 5.5', monthlySavingsUsd: 1800 });
    expect(slice(p, 'low')).toMatchObject({ options: [], current: [{ model: 'Claude Haiku 5.5', spendUsd: 5000 }] });

    const haiku = usage.map((u) => ({ ...u, team: 'growth' as const, model: 'claude-haiku' }));
    const [g] = optimizeWorkflows([est('growth', 10000)], haiku, '2026-10-25', catalog);
    expect(slice(g, 'high').underpowered.map((s) => s.model)).toEqual(['Claude Haiku 5.5']);
  });

  it('flags an option whose price is announced to rise, with the saving after', () => {
    expect(slice(plan, 'high').options[0].priceChange).toEqual({ effectiveDate: '2027-01-01', newBlendedPerMTok: 3, savingsAfterUsd: 375 });
  });

  it('stance follows the budget status', () => {
    expect(stanceFor(undefined).stance).toBe('balanced');
    expect(stanceFor(budget('search', 'warn', 0.93)).reason).toMatch(/^Near its limit \(93% of budget\)/);
  });
});

describe('outlook and what-ifs', () => {
  const plans = optimizeWorkflows([est('support', 10000)], usage, '2026-10-25', catalog, [ann], [budget('support', 'over', 1.18)]);

  it('says what an announced change would mean for the workload it fits best', () => {
    expect(announcementWhatIfs(plans, [ann], catalog)[0].text).toBe(
      'If Support moved its ticket triage and first replies from Claude Sonnet 5.5 to Gemini 3.8 Flash, it would save $3,750 a month at today\'s price, but only $1,500 from Jan 1, 2027.',
    );
  });

  it('projects the next months on today’s models and with each workload’s switch', () => {
    const o = costOutlook('2026-10', [est('support', 10000)], plans, [ann]);
    // Savings 8,200; from January the Gemini switches save 375 + 625 instead of 937.5 + 1,562.5.
    expect(o.map((x) => [x.label, x.currentModelsUsd, x.recommendedPlanUsd])).toEqual([
      ['Nov 2026', 10000, 1800], ['Dec 2026', 10000, 1800], ['Jan 2027', 10000, 3300],
    ]);
  });
});

describe('guardAnnouncements', () => {
  const page = 'Input price $0.75 through December 31, 2026. $1.50 starting January 1, 2027. Output $3.75 then $7.50. Gemini 3.8 Flash';
  const item = { model: 'Gemini 3.8 Flash', currentInputPerMTok: 0.75, newInputPerMTok: 1.5, currentOutputPerMTok: 3.75, newOutputPerMTok: 7.5, effectiveDate: '2027-01-01', excerpt: '$0.75 through December 31, 2026. $1.50 starting January 1, 2027.' };

  it('keeps a change whose excerpt, prices, date and model are on the page', () => {
    expect(guardAnnouncements('Google', 'u', page, [item], 't')[0]).toMatchObject({ newBlendedPerMTok: 3, changePct: 1 });
    expect(dateInText(item.excerpt, '2027-01-01')).toBe(true);
  });

  it('drops invented excerpts, wrong dates, wrong prices and non-text models', () => {
    expect(guardAnnouncements('Google', 'u', page, [
      { ...item, excerpt: 'Prices double next year for everyone.' },
      { ...item, effectiveDate: '2027-02-01' },
      { ...item, newInputPerMTok: 2 },
      { ...item, model: 'Gemini 3.8 Flash TTS' },
    ], 't')).toEqual([]);
  });
});
