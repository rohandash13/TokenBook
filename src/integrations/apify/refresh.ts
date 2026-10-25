// OWNER: C — live Apify scrape of pricing and news pages into the store. `npm run apify` (needs APIFY_TOKEN).
import { pathToFileURL } from 'node:url';
import { getLlm, type LlmClient } from '../../llm/client';
import { addPriceSnapshot, upsertMarketSignals } from '../../server/store';
import { APIFY } from '../config';
import { crawlPage, type CrawledPage } from './client';
import { extractMarketSignals } from './market';
import { extractPrices } from './prices';

export type ApifyRefreshResult = { priceSnapshots: number; marketSignals: number; errors: string[]; skipped?: string };

export async function refreshApify(opts: {
  token?: string;
  llm?: LlmClient | null;
  crawl?: (url: string) => Promise<CrawledPage>;
  now?: () => string;
}): Promise<ApifyRefreshResult> {
  if (!opts.token && !opts.crawl) return { priceSnapshots: 0, marketSignals: 0, errors: [], skipped: 'APIFY_TOKEN not set; using fixtures' };
  const crawl = opts.crawl ?? ((url: string) => crawlPage(url, { token: opts.token! }));
  const now = opts.now ?? (() => new Date().toISOString());
  const llm = opts.llm ?? null;
  const result: ApifyRefreshResult = { priceSnapshots: 0, marketSignals: 0, errors: [] };

  // One crawl at a time: the free plan's memory limit covers all concurrent Actor runs.
  const jobs: (() => Promise<void>)[] = [
    ...APIFY.pricePages.map(({ provider, url }) => async () => {
      try {
        const page = await crawl(url);
        const rows = await extractPrices(provider, page.text, llm);
        if (rows.length === 0) throw new Error('no prices found on the page');
        addPriceSnapshot({ provider, url: page.url, fetchedAt: now(), origin: 'live', text: page.text, rows });
        result.priceSnapshots++;
      } catch (err) {
        result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    ...APIFY.marketPages.map(({ url }) => async () => {
      try {
        const page = await crawl(url);
        const signals = await extractMarketSignals(page.url, page.text, llm);
        if (signals.length) upsertMarketSignals(signals);
        result.marketSignals += signals.length;
      } catch (err) {
        result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  ];
  for (const job of jobs) await job();
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(); } catch { /* no .env */ }
  refreshApify({ token: process.env.APIFY_TOKEN, llm: getLlm() }).then(
    (r) => console.log(JSON.stringify(r, null, 2)),
    (err) => { console.error(err); process.exit(1); },
  );
}
