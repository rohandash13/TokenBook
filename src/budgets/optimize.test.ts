// OWNER: C
import { describe, expect, it } from 'vitest';
import type { PriceAnnouncement } from '../integrations/apify/announcements';
import { guardAnnouncements, dateInText } from '../integrations/apify/announcements';
import type { CatalogModel } from '../integrations/apify/catalog';
import type { Estimate, UsageDay } from '../shared/types';
import { optimizeWorkflows, tradeoffText } from './optimize';
import { announcementWhatIfs, costOutlook } from './outlook';

const m = (provider: string, model: string, input: number, output: number, openWeight = false): CatalogModel => {
  const b = (3 * input + output) / 4;
  return { provider, model, inputPerMTok: input, outputPerMTok: output, blendedPerMTok: b, tier: b < 1 ? 'light' : b < 5 ? 'mid' : 'frontier', openWeight, url: 'https://x.example', fetchedAt: '2026-10-25T00:00:00Z' };
};
const catalog = [
  m('Anthropic', 'Claude Sonnet 5.5', 2, 10), m('Anthropic', 'Claude Haiku 5.5', 0.1, 0.5),
  m('DeepSeek', 'deepseek-flash', 0.3, 1.2, true), m('Google', 'Gemini 3.8 Flash', 0.75, 3.75),
];
const est = (team: Estimate['team'], estimate: number): Estimate => ({ team, month: '2026-10', asOf: '2026-10-25', method: 'trueup', estimate, actualToDate: 0, confidence: 'high', basis: 'b' });
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
  const [plan] = optimizeWorkflows([est('support', 10000)], usage, '2026-10-25', catalog, [ann]);

  it('prices the team task on its current model and picks best, open-weight and same-tier options', () => {
    // Task = 10,000 × 100% on Sonnet × 60% triage = 6,000 at Sonnet's 4.00 blended.
    expect(plan).toMatchObject({ team: 'support', currentModel: 'Claude Sonnet 5.5', taskSpendUsd: 6000 });
    expect(plan.options.map((o) => [o.model, o.monthlySavingsUsd])).toEqual([
      ['Claude Haiku 5.5', 5700], ['deepseek-flash', 5212.5], ['Gemini 3.8 Flash', 3750],
    ]);
  });

  it('flags an option whose price is announced to rise, with the saving after', () => {
    expect(plan.options[2].priceChange).toEqual({ effectiveDate: '2027-01-01', newBlendedPerMTok: 3, savingsAfterUsd: 1500 });
  });
});

describe('outlook and what-ifs', () => {
  const plans = optimizeWorkflows([est('support', 10000)], usage, '2026-10-25', catalog, [ann]);

  it('says what an announced change would mean for the team it fits best', () => {
    expect(announcementWhatIfs(plans, [ann], catalog)[0].text).toBe(
      'If Support moved its ticket triage and first replies from Claude Sonnet 5.5 to Gemini 3.8 Flash, it would save $3,750 a month at today\'s price, but only $1,500 from 2027-01-01.',
    );
  });

  it('projects the next months on today’s models and with the top switch', () => {
    const o = costOutlook('2026-10', [est('support', 10000)], plans, [ann]);
    expect(o.map((x) => [x.label, x.currentModelsUsd, x.recommendedPlanUsd])).toEqual([
      ['Nov 2026', 10000, 4300], ['Dec 2026', 10000, 4300], ['Jan 2027', 10000, 4300],
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
