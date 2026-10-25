// OWNER: C — the model market: current models and API prices scraped live from each provider's own page.
// Claude reads the page; every model name, price, context window and "best for" phrase it returns must
// appear verbatim on that page, or the row is dropped. Tiers come from price, deterministically.
import { z } from 'zod';
import { completeJson, type LlmClient } from '../../llm/client';

export type Tier = 'light' | 'mid' | 'frontier';
export type CatalogModel = {
  provider: string;
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  /** 3:1 input:output blend, a common way to compare one price per model. */
  blendedPerMTok: number;
  tier: Tier;
  openWeight: boolean;
  contextWindow?: string;
  bestFor?: string;
  url: string;
  /** Set when the prices come from a third-party page rather than the provider's own. */
  via?: string;
  fetchedAt: string;
};

export type CatalogSource = { provider: string; url: string; crawler: 'cheerio' | 'playwright:firefox'; openWeight: boolean; via?: string };

const Rows = z.object({
  models: z.array(z.object({
    model: z.string().min(2),
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().positive(),
    contextWindow: z.string().optional(),
    bestFor: z.string().optional(),
  })),
});

const squash = (s: string) => s.replace(/\s+/g, ' ').replace(/<br>/gi, ' ').trim().toLowerCase();

/** "$2", "$2.00", "$0.5", "$0.50", "$.5" all count as 2 or 0.5 printed on the page. */
export function priceOnPage(text: string, n: number): boolean {
  const [int, frac = ''] = String(n).split('.');
  const intPart = int === '0' ? '0?' : int;
  const fracPart = frac ? `\\.${frac}0*` : '(?:\\.0+)?';
  // Not followed by another digit or decimal part; a sentence-ending period ("$7.50.") is fine.
  return new RegExp(String.raw`\$\s?${intPart}${fracPart}(?!\d)(?!\.\d)`).test(text);
}

export const blended = (input: number, output: number) => Math.round(((3 * input + output) / 4) * 10000) / 10000;

/** light: under $1 blended per MTok; mid: under $5; frontier: $5 and up. */
export function tierOf(blendedPerMTok: number): Tier {
  return blendedPerMTok < 1 ? 'light' : blendedPerMTok < 5 ? 'mid' : 'frontier';
}

/** Keeps only rows whose every field is backed by the page text. */
export function guardRows(
  source: CatalogSource, text: string, rows: z.infer<typeof Rows>['models'], fetchedAt: string,
): CatalogModel[] {
  const page = squash(text);
  const seen = new Set<string>();
  return rows.flatMap((r): CatalogModel[] => {
    if (!page.includes(squash(r.model)) || seen.has(r.model)) return [];
    if (!priceOnPage(text, r.inputPerMTok) || !priceOnPage(text, r.outputPerMTok)) return [];
    if (r.inputPerMTok > r.outputPerMTok * 2) return []; // columns swapped or a cache price
    seen.add(r.model);
    const b = blended(r.inputPerMTok, r.outputPerMTok);
    return [{
      provider: source.provider, model: r.model, inputPerMTok: r.inputPerMTok, outputPerMTok: r.outputPerMTok,
      blendedPerMTok: b, tier: tierOf(b), openWeight: source.openWeight,
      ...(r.contextWindow && page.includes(squash(r.contextWindow)) ? { contextWindow: r.contextWindow } : {}),
      ...(r.bestFor && page.includes(squash(r.bestFor)) ? { bestFor: r.bestFor } : {}),
      url: source.url, ...(source.via ? { via: source.via } : {}), fetchedAt,
    }];
  });
}

const SYSTEM =
  'You extract text-model API prices from a provider pricing page. Rules: only text/chat models (no image, audio, ' +
  'video, embeddings); the standard input price (cache miss, base tier, short context, peak if peak/off-peak) and ' +
  'the standard output price, both USD per 1M tokens; the model name exactly as written on the page; contextWindow ' +
  'and bestFor copied word for word from the page if present, else omit. At most 8 current models. JSON only.';

/** Headings plus the lines around prices (each `$` line and the 4 before it), so long pages fit; the guard still checks the full page. */
export function focusOnPrices(text: string, before = 4): string {
  const lines = text.split(/\r?\n/);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (/^#{1,4}\s/.test(l)) keep.add(i);
    if (/\$\s?\d/.test(l)) for (let j = Math.max(0, i - before); j <= i; j++) keep.add(j);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
}

/** Long pages: the top (where a page lists its models) plus headings and price sections. */
export function focusedPage(text: string, before = 4): string {
  return text.length > 20000 ? `${text.split(/\r?\n/).slice(0, 40).join('\n')}\n…\n${focusOnPrices(text, before)}` : text;
}

export async function extractCatalog(
  source: CatalogSource, text: string, llm: LlmClient | null, fetchedAt: string,
): Promise<CatalogModel[]> {
  const out = await completeJson(
    llm, SYSTEM,
    `Provider: ${source.provider}\nReturn {"models":[{"model","inputPerMTok","outputPerMTok","contextWindow","bestFor"}]}.\n\nPage ${source.url} (price sections):\n${focusedPage(text).slice(0, 40000)}`,
    Rows,
  );
  return guardRows(source, text, out?.models ?? [], fetchedAt);
}
