// OWNER: C
import { describe, expect, it } from 'vitest';
import { blended, extractCatalog, guardRows, priceOnPage, tierOf, type CatalogSource } from './catalog';

// Excerpt of DeepSeek's live pricing table (columns are models).
const deepseek = `| MODEL |     |     | deepseek-flash(1) | deepseek-v4-pro |
| CONTEXT LENGTH | | | 1M | 1M |
| 1M INPUT TOKENS  <br>(CACHE MISS) | OFF-PEAK | $0.15 | $0.66 |
| PEAK | $0.3 | $1.32 |
| 1M OUTPUT TOKENS | OFF-PEAK | $0.6 | $1.98 |
| PEAK | $1.2 | $3.96 |`;
const source: CatalogSource = { provider: 'DeepSeek', url: 'https://api-docs.deepseek.com/quick_start/pricing', crawler: 'cheerio', openWeight: true };
const AT = '2026-10-25T04:00:00.000Z';

describe('priceOnPage', () => {
  it('accepts the price however the page prints it', () => {
    expect(priceOnPage('Input $2.00 / 1M', 2)).toBe(true);
    expect(priceOnPage('costs $0.5 /M', 0.5)).toBe(true);
    expect(priceOnPage('costs $0.50 /M', 0.5)).toBe(true);
    expect(priceOnPage('costs $0.5 /M', 5)).toBe(false);
    expect(priceOnPage('costs $12.50', 12.5)).toBe(true);
    expect(priceOnPage('costs $12.50', 2.5)).toBe(false);
  });
});

describe('tiers and blended price', () => {
  it('blends 3:1 input:output and tiers by price', () => {
    expect(blended(2, 10)).toBe(4);
    expect(tierOf(0.25)).toBe('light');
    expect(tierOf(4)).toBe('mid');
    expect(tierOf(10)).toBe('frontier');
  });
});

describe('guardRows', () => {
  it('keeps rows whose name and prices are on the page', () => {
    const rows = guardRows(source, deepseek, [
      { model: 'deepseek-v4-pro', inputPerMTok: 1.32, outputPerMTok: 3.96, contextWindow: '1M' },
      { model: 'deepseek-flash', inputPerMTok: 0.3, outputPerMTok: 1.2, bestFor: 'the cheapest model ever made' },
    ], AT);
    expect(rows).toEqual([
      expect.objectContaining({ model: 'deepseek-v4-pro', blendedPerMTok: 1.98, tier: 'mid', openWeight: true, contextWindow: '1M' }),
      expect.objectContaining({ model: 'deepseek-flash', blendedPerMTok: 0.525, tier: 'light' }),
    ]);
    expect(rows[1].bestFor).toBeUndefined(); // invented phrase dropped
  });

  it('drops invented models, invented prices, swapped columns and duplicates', () => {
    expect(guardRows(source, deepseek, [
      { model: 'deepseek-v9-ultra', inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { model: 'deepseek-flash', inputPerMTok: 0.25, outputPerMTok: 1.2 },
      { model: 'deepseek-flash', inputPerMTok: 3.96, outputPerMTok: 0.6 },
      { model: 'deepseek-v4-pro', inputPerMTok: 1.32, outputPerMTok: 3.96 },
      { model: 'deepseek-v4-pro', inputPerMTok: 1.32, outputPerMTok: 3.96 },
    ], AT).map((r) => r.model)).toEqual(['deepseek-v4-pro']);
  });
});

describe('extractCatalog', () => {
  it('runs the LLM reply through the guard, and returns nothing without an LLM', async () => {
    const llm = { complete: async () => JSON.stringify({ models: [{ model: 'deepseek-v4-pro', inputPerMTok: 1.32, outputPerMTok: 3.96 }, { model: 'gpt-9', inputPerMTok: 1, outputPerMTok: 2 }] }) };
    expect((await extractCatalog(source, deepseek, llm, AT)).map((m) => m.model)).toEqual(['deepseek-v4-pro']);
    expect(await extractCatalog(source, deepseek, null, AT)).toEqual([]);
  });
});
