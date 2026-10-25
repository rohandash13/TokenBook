// OWNER: C — scheduled price changes announced on provider pages ("$2.00 through November 30, 2026.
// $4.00 starting December 1, 2026."). Claude finds them; the excerpt must be on the page verbatim, the new
// prices and the effective date must be in that excerpt, and the model name must be on the page.
import { z } from 'zod';
import { completeJson, type LlmClient } from '../../llm/client';
import { blended, focusedPage, priceOnPage } from './catalog';

export type PriceAnnouncement = {
  provider: string;
  model: string;
  effectiveDate: string;
  currentInputPerMTok: number;
  newInputPerMTok: number;
  currentOutputPerMTok?: number;
  newOutputPerMTok?: number;
  currentBlendedPerMTok: number;
  newBlendedPerMTok: number;
  changePct: number;
  excerpt: string;
  url: string;
  fetchedAt: string;
};

const Items = z.object({
  items: z.array(z.object({
    model: z.string().min(2),
    currentInputPerMTok: z.number().nonnegative(),
    newInputPerMTok: z.number().nonnegative(),
    currentOutputPerMTok: z.number().nonnegative().optional(),
    newOutputPerMTok: z.number().nonnegative().optional(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    excerpt: z.string().min(10),
  })),
});

const NOT_TEXT = /\b(tts|live|transcribe|translate|image|imagen|veo|audio|video|embedding)\b/i;
const squash = (s: string) => s.replace(/<br>/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The excerpt names the effective date: ISO, or "December 1" / "Dec 1". */
export function dateInText(text: string, iso: string): boolean {
  const t = squash(text);
  if (t.includes(iso)) return true;
  const [, m, d] = iso.split('-').map(Number);
  const name = MONTHS[m - 1];
  return new RegExp(`\\b(${name}|${name.slice(0, 3)})\\.?\\s+${d}\\b`).test(t);
}

export function guardAnnouncements(
  provider: string, url: string, text: string, items: z.infer<typeof Items>['items'], fetchedAt: string,
): PriceAnnouncement[] {
  const page = squash(text);
  return items.flatMap((i): PriceAnnouncement[] => {
    if (NOT_TEXT.test(i.model)) return []; // audio, realtime, image and embedding models are not text accruals
    const ex = squash(i.excerpt);
    if (!page.includes(ex) || !page.includes(squash(i.model))) return [];
    if (!priceOnPage(i.excerpt, i.newInputPerMTok) || !priceOnPage(i.excerpt, i.currentInputPerMTok)) return [];
    if (!dateInText(i.excerpt, i.effectiveDate) || i.newInputPerMTok === i.currentInputPerMTok) return [];
    const outOk = i.currentOutputPerMTok !== undefined && i.newOutputPerMTok !== undefined
      && priceOnPage(text, i.currentOutputPerMTok) && priceOnPage(text, i.newOutputPerMTok);
    const curOut = outOk ? i.currentOutputPerMTok! : i.currentInputPerMTok;
    const newOut = outOk ? i.newOutputPerMTok! : i.newInputPerMTok;
    const cur = outOk ? blended(i.currentInputPerMTok, curOut) : i.currentInputPerMTok;
    const next = outOk ? blended(i.newInputPerMTok, newOut) : i.newInputPerMTok;
    return [{
      provider, model: i.model, effectiveDate: i.effectiveDate,
      currentInputPerMTok: i.currentInputPerMTok, newInputPerMTok: i.newInputPerMTok,
      ...(outOk ? { currentOutputPerMTok: curOut, newOutputPerMTok: newOut } : {}),
      currentBlendedPerMTok: cur, newBlendedPerMTok: next, changePct: Math.round((next / cur - 1) * 1000) / 1000,
      excerpt: i.excerpt.replace(/\s+/g, ' ').trim(), url, fetchedAt,
    }];
  });
}

const SYSTEM =
  'You find SCHEDULED price changes for text-model APIs on a provider pricing page: a current price that applies ' +
  '"through" or "until" a date and a new price "starting" or "effective" a date. Ignore discounts, tiers and plans. ' +
  'For each: the model name exactly as written on the page (use the page\'s model list if a section is unlabelled), ' +
  'current and new USD prices per 1M input tokens (and output if given), the effective date as YYYY-MM-DD, and ' +
  'excerpt = the exact sentence(s) copied from the page that state the input-price change. JSON only.';

export async function extractAnnouncements(
  provider: string, url: string, text: string, llm: LlmClient | null, fetchedAt: string,
): Promise<PriceAnnouncement[]> {
  if (!/through|until|starting|effective/i.test(text)) return [];
  const body = focusedPage(text, 8);
  const out = await completeJson(
    llm, SYSTEM,
    `Provider: ${provider}\nReturn {"items":[{"model","currentInputPerMTok","newInputPerMTok","currentOutputPerMTok","newOutputPerMTok","effectiveDate","excerpt"}]} (empty list if none).\n\nPage ${url}:\n${body.slice(0, 40000)}`,
    Items,
  );
  return guardAnnouncements(provider, url, text, out?.items ?? [], fetchedAt);
}
