// OWNER: C — runs Apify's Website Content Crawler on one URL and returns the page text.
import { APIFY } from '../config';

export type CrawledPage = { url: string; text: string };

export async function crawlPage(
  url: string,
  opts: { token: string; fetchImpl?: typeof fetch; timeoutSecs?: number; crawler?: 'cheerio' | 'playwright:firefox' },
): Promise<CrawledPage> {
  const { token, fetchImpl = fetch, timeoutSecs = 120, crawler = 'cheerio' } = opts;
  const memory = crawler === 'cheerio' ? APIFY.memoryMb : 4096; // a real browser needs more
  // Small memory and the plain-HTML crawler keep runs inside the free plan's memory limit.
  const res = await fetchImpl(`${APIFY.runSyncUrl(APIFY.actor)}?timeout=${timeoutSecs}&memory=${memory}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startUrls: [{ url }], maxCrawlPages: 1, maxCrawlDepth: 0, crawlerType: crawler, saveMarkdown: true }),
    signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
  });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = (await res.json()) as { url?: string; text?: string; markdown?: string }[];
  const item = items[0];
  if (!item) throw new Error(`Apify returned no page for ${url}`);
  return { url: item.url ?? url, text: item.markdown || item.text || '' };
}
