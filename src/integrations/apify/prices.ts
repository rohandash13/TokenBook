// OWNER: C — model prices from a scraped pricing page, and price changes between scrapes.
// Numbers come from the page text: the regex reads them directly, and an LLM-extracted price is
// kept only if it appears verbatim on the page.
import { z } from 'zod';
import { completeJson, type LlmClient } from '../../llm/client';
import { MODELS } from '../config';
import type { PriceChange, PriceRow, PriceSnapshot } from '../types';

const PRICE = /\$\s?(\d+(?:\.\d+)?)/g;

const WINDOW_LINES = 8;
const PER_MTOK = /MTok|million tokens|per\s*1M|\/\s*1M/i;

/**
 * The first two dollar amounts on the line naming the model or the few lines after it (stopping at the next
 * model's name): input, then output, per MTok. Works for one-line tables and for cards with prices below the name.
 */
export function extractPricesRegex(provider: string, text: string): PriceRow[] {
  const lines = text.split(/\r?\n/);
  const isModelLine = (l: string) => MODELS.some((m) => m.provider === provider && m.pattern.test(l));
  return MODELS.filter((m) => m.provider === provider).flatMap((m): PriceRow[] => {
    for (let i = 0; i < lines.length; i++) {
      if (!m.pattern.test(lines[i])) continue;
      const window = [lines[i]];
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + WINDOW_LINES) && !isModelLine(lines[j]); j++) window.push(lines[j]);
      // Only per-million-token prices: a plan price like "$100/month" near a model name is not an API price.
      const prices = window.filter((l) => PER_MTOK.test(l)).flatMap((l) => [...l.matchAll(PRICE)].map((x) => Number(x[1])));
      if (prices.length >= 2 && prices[0] <= prices[1]) {
        return [{ provider, model: m.id, inputPerMTok: prices[0], outputPerMTok: prices[1] }];
      }
    }
    return [];
  });
}

const onPage = (text: string, n: number) => new RegExp(String.raw`\$\s?${String(n).replace('.', '\\.')}(?!\d)(?!\.\d)`).test(text);

const Rows = z.object({
  rows: z.array(z.object({ model: z.string(), inputPerMTok: z.number().positive(), outputPerMTok: z.number().positive() })),
});

/** Regex first; the LLM only fills models the regex missed, and only with prices printed on the page. */
export async function extractPrices(provider: string, text: string, llm: LlmClient | null): Promise<PriceRow[]> {
  const rows = extractPricesRegex(provider, text);
  const missing = MODELS.filter((m) => m.provider === provider && !rows.some((r) => r.model === m.id));
  if (!llm || missing.length === 0) return rows;
  const out = await completeJson(
    llm,
    'Extract API prices in USD per million tokens. Use only numbers printed on the page. Reply with JSON only.',
    `Models: ${missing.map((m) => m.id).join(', ')}\nReturn {"rows":[{"model","inputPerMTok","outputPerMTok"}]}.\n\n${text.slice(0, 20000)}`,
    Rows,
  );
  const extra = (out?.rows ?? []).filter(
    (r) => missing.some((m) => m.id === r.model) && onPage(text, r.inputPerMTok) && onPage(text, r.outputPerMTok),
  );
  return [...rows, ...extra.map((r) => ({ provider, ...r }))];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "takes effect November 1, 2026" / "effective 2026-11-01" → 2026-11-01. */
export function effectiveDate(text: string): string | null {
  const iso = text.match(/effect(?:ive)?\s+(?:on\s+|from\s+)?(\d{4}-\d{2}-\d{2})/i);
  if (iso) return iso[1];
  const m = text.match(/(?:effective|takes effect)\s+(?:on\s+|from\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && mo >= 0 ? `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

function excerptFor(text: string, model: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pattern = MODELS.find((m) => m.id === model)?.pattern;
  return lines.find((l) => /effect/i.test(l) && (!pattern || pattern.test(l))) ?? lines.find((l) => pattern?.test(l)) ?? '';
}

/** Changes between consecutive snapshots of the same provider and origin. */
export function priceChanges(snapshots: PriceSnapshot[]): PriceChange[] {
  const groups = new Map<string, PriceSnapshot[]>();
  for (const s of snapshots) groups.set(`${s.provider}|${s.origin}`, [...(groups.get(`${s.provider}|${s.origin}`) ?? []), s]);
  const changes: PriceChange[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      for (const row of next.rows) {
        const old = prev.rows.find((r) => r.model === row.model);
        if (!old || (old.inputPerMTok === row.inputPerMTok && old.outputPerMTok === row.outputPerMTok)) continue;
        const announcedAt = next.fetchedAt.slice(0, 10);
        changes.push({
          provider: next.provider, model: row.model, from: old, to: row, announcedAt,
          effectiveDate: effectiveDate(next.text) ?? announcedAt, url: next.url, excerpt: excerptFor(next.text, row.model),
        });
      }
    }
  }
  return changes;
}
