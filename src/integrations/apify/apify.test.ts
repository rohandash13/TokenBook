// OWNER: C
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UsageDay } from '../../shared/types';
import type { PriceSnapshot } from '../types';
import { teamPriceMultiplier, priceEvents } from './impact';
import { extractMarketSignals } from './market';
import { effectiveDate, extractPrices, extractPricesRegex, priceChanges } from './prices';

const snapshots = JSON.parse(
  readFileSync(new URL('../../../data/fixtures/integrations/prices.json', import.meta.url), 'utf8'),
) as PriceSnapshot[];

describe('prices from a scraped page', () => {
  it('reads input and output prices per model from the page text', () => {
    expect(extractPricesRegex('anthropic', snapshots[1].text)).toEqual(snapshots[1].rows);
  });

  it('reads prices listed on the lines below the model name, stopping at the next model', () => {
    const card = 'Claude Sonnet 4.5\nInput\n$3 / MTok\nOutput\n$15 / MTok\nClaude Opus 4.1\nInput\n$15 / MTok\nOutput\n$75 / MTok';
    expect(extractPricesRegex('anthropic', card)).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet', inputPerMTok: 3, outputPerMTok: 15 },
      { provider: 'anthropic', model: 'claude-opus', inputPerMTok: 15, outputPerMTok: 75 },
    ]);
    expect(extractPricesRegex('anthropic', 'Claude Haiku\nInput $1 / MTok\nClaude Sonnet\n$3 / MTok $15 / MTok')).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet', inputPerMTok: 3, outputPerMTok: 15 },
    ]);
  });

  it('ignores plan prices that are not per million tokens', () => {
    expect(extractPricesRegex('anthropic', 'Claude Haiku in Max\nfrom $100/month\nor $200/month')).toEqual([]);
  });

  it('finds the effective date in prose or ISO form', () => {
    expect(effectiveDate(snapshots[1].text)).toBe('2026-11-01');
    expect(effectiveDate('Prices change, effective 2026-12-01.')).toBe('2026-12-01');
    expect(effectiveDate('nothing here')).toBeNull();
  });

  it('keeps an LLM price only if it is printed on the page', async () => {
    const text = 'Claude Haiku costs $0.80 in and $4 out per MTok';
    const llm = { complete: async () => JSON.stringify({ rows: [{ model: 'claude-haiku', inputPerMTok: 0.8, outputPerMTok: 4 }, { model: 'claude-opus', inputPerMTok: 99, outputPerMTok: 1 }] }) };
    expect(extractPricesRegex('anthropic', 'Haiku is cheap')).toEqual([]);
    const rows = await extractPrices('anthropic', text, llm);
    expect(rows.map((r) => r.model)).toEqual(['claude-haiku']);
  });

  it('diffs consecutive snapshots: Sonnet −20% announced Oct 20, effective Nov 1', () => {
    const [c] = priceChanges(snapshots);
    expect(priceChanges(snapshots)).toHaveLength(1);
    expect(c).toMatchObject({ model: 'claude-sonnet', announcedAt: '2026-10-20', effectiveDate: '2026-11-01' });
    expect(c.excerpt).toBe('New Claude Sonnet pricing takes effect November 1, 2026.');
  });

  it('never diffs a live scrape against a fixture', () => {
    const live = { ...snapshots[1], origin: 'live' as const, fetchedAt: '2026-10-24T00:00:00.000Z' };
    expect(priceChanges([snapshots[0], live])).toEqual([]);
  });
});

describe('price impact per team (deterministic)', () => {
  const day = (team: UsageDay['team'], model: string, costUsd: number): UsageDay => ({
    date: '2026-10-25', team, model, costUsd, inputTokens: 800_000, outputTokens: 200_000, source: 'anthropic',
  });
  const usage = [day('support', 'claude-sonnet', 100), day('support', 'claude-haiku', 100), day('platform', 'claude-opus', 50)];
  const [change] = priceChanges(snapshots);

  it('scales the price ratio by the team’s share of spend on that model', () => {
    expect(teamPriceMultiplier('support', change, usage, '2026-10-25')).toBe(0.9);
    expect(teamPriceMultiplier('platform', change, usage, '2026-10-25')).toBeNull();
  });

  it('emits web events from the effective date, only once announced', () => {
    const events = priceEvents([change], usage, '2026-10-25');
    expect(events).toEqual([expect.objectContaining({ team: 'support', date: '2026-11-01', multiplier: 0.9, source: 'web', note: 'claude-sonnet price -20%' })]);
    expect(events[0].evidence[0]).toMatchObject({ source: 'web', url: 'https://www.anthropic.com/pricing', date: '2026-10-20' });
    expect(priceEvents([change], usage, '2026-10-19')).toEqual([]);
  });
});

describe('market signals', () => {
  it('keeps only items whose excerpt is on the page', async () => {
    const page = 'News. H100 on-demand now from $1.99/hr in Secure Cloud. More text.';
    const llm = { complete: async () => JSON.stringify({ items: [
      { kind: 'gpu', title: 'H100 cheaper', date: '2026-10-16', excerpt: 'H100 on-demand now from $1.99/hr in Secure Cloud.', models: [] },
      { kind: 'outage', title: 'Made up', date: '2026-10-16', excerpt: 'This sentence is not on the page at all.', models: [] },
    ] }) };
    const out = await extractMarketSignals('https://www.runpod.io/pricing', page, llm);
    expect(out.map((s) => s.title)).toEqual(['H100 cheaper']);
    expect(await extractMarketSignals('u', page, null)).toEqual([]);
  });
});
