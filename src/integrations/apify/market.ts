// OWNER: C — public news that may affect AI spend (GPU prices, releases, deprecations, outages).
// Shown with its source only; never changes a number. The excerpt must appear verbatim on the page.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { completeJson, type LlmClient } from '../../llm/client';
import { MODELS } from '../config';
import type { MarketSignal } from '../types';

const Items = z.object({
  items: z.array(z.object({
    kind: z.enum(['gpu', 'release', 'deprecation', 'outage', 'pricing', 'other']),
    title: z.string().min(3),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    excerpt: z.string().min(10),
    models: z.array(z.string()).default([]),
  })),
});

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function extractMarketSignals(url: string, text: string, llm: LlmClient | null): Promise<MarketSignal[]> {
  const out = await completeJson(
    llm,
    'You read web pages for a finance team that accrues AI API spend. List only items that could change what a company ' +
      'spends on AI APIs or GPUs: price changes, new models, deprecations, outages, GPU pricing. Copy each excerpt word for ' +
      'word from the page. Reply with JSON only.',
    `Known models: ${MODELS.map((m) => m.id).join(', ')}\nReturn {"items":[{"kind","title","date":"YYYY-MM-DD","excerpt","models":[]}]} (at most 5).\n\nPage ${url}:\n${text.slice(0, 20000)}`,
    Items,
  );
  const page = squash(text);
  return (out?.items ?? [])
    .filter((i) => page.includes(squash(i.excerpt)))
    .map((i) => ({
      id: `web:${createHash('sha1').update(`${url}|${i.title}`).digest('hex').slice(0, 12)}`,
      kind: i.kind, title: i.title, date: i.date, url, excerpt: squash(i.excerpt),
      models: i.models.filter((m) => MODELS.some((x) => x.id === m)),
    }));
}
