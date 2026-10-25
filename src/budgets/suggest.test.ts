// OWNER: C
import { describe, expect, it } from 'vitest';
import type { CatalogModel } from '../integrations/apify/catalog';
import type { TeamBudgetCheck } from '../shared/api';
import type { UsageDay } from '../shared/types';
import { currentModel, suggestModels } from './suggest';

const m = (provider: string, model: string, input: number, output: number, openWeight = false): CatalogModel => {
  const b = (3 * input + output) / 4;
  return { provider, model, inputPerMTok: input, outputPerMTok: output, blendedPerMTok: b, tier: b < 1 ? 'light' : b < 5 ? 'mid' : 'frontier', openWeight, url: `https://${provider}.example/pricing`, fetchedAt: '2026-10-25T04:00:00Z' };
};
const catalog = [
  m('Anthropic', 'Claude Opus 5.5', 4, 20), m('Anthropic', 'Claude Sonnet 5.5', 2, 10), m('Anthropic', 'Claude Haiku 5.5', 0.1, 0.5),
  m('DeepSeek', 'deepseek-flash', 0.3, 1.2, true), m('xAI', 'grok-4.7', 2, 6),
];
const day = (date: string, model: string, costUsd: number): UsageDay => ({ date, team: 'support', model, costUsd, inputTokens: 1, outputTokens: 1, source: 'anthropic' });
const usage = Array.from({ length: 7 }, (_, i) => [day(`2026-10-${19 + i}`, 'claude-sonnet', 300), day(`2026-10-${19 + i}`, 'claude-haiku', 100)]).flat();
const over: TeamBudgetCheck = { team: 'support', budgetUsd: 8500, projectedUsd: 10040, actualToDateUsd: 6120, pctOfBudget: 1.18, headroomUsd: -1540, status: 'over' };

describe('currentModel', () => {
  it('maps a fixture model to the first matching row of its provider’s live page', () => {
    expect(currentModel('claude-sonnet', catalog)?.model).toBe('Claude Sonnet 5.5');
    expect(currentModel('gpt-4.1-mini', catalog)).toBeNull(); // no OpenAI row in this catalog
    expect(currentModel('llama-3', catalog)).toBeNull();
  });
});

describe('suggestModels', () => {
  const s = suggestModels([over], usage, '2026-10-25', catalog);

  it('re-prices the team’s main task on its top model at live prices: same provider and another provider', () => {
    // Task spend = 10,040 × (300/400 on Sonnet) × 60% triage = 4,518. Haiku blended 0.2 vs Sonnet 4.
    expect(s.map((x) => [x.toModel, x.monthlySavingsUsd])).toEqual([['Claude Haiku 5.5', 4292.1], ['deepseek-flash', 3925.01]]);
    expect(s[0]).toMatchObject({ fromModel: 'Claude Sonnet 5.5', taskSpendUsd: 4518, coversOverage: true, openWeight: false });
    expect(s[1]).toMatchObject({ toProvider: 'DeepSeek', openWeight: true });
    expect(s[0].text).toBe("Move Support's ticket triage and first replies (about 60% of its Claude Sonnet 5.5 spend) to Claude Haiku 5.5: about $4,292 less this month.");
  });

  it('respects the minimum tier for the work and skips teams within budget', () => {
    // Search's main workload (query rewriting) needs only light; its result reranking needs mid.
    const search = { ...over, team: 'search' as const };
    const searchUsage = usage.map((u) => ({ ...u, team: 'search' as const }));
    expect(suggestModels([search], searchUsage, '2026-10-25', catalog)[0].task).toBe('query rewriting');
    expect(suggestModels([{ ...over, status: 'ok' }], usage, '2026-10-25', catalog)).toEqual([]);
  });
});
