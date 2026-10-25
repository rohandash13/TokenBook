// OWNER: C — market intelligence: the live model market and workflow optimizer (Apify), announced price
// changes and the cost outlook, and public market news. One section at a time behind a sticky tab bar.
import { useState } from 'react';
import { TEAM_INFO } from '../../../src/shared/config';
import { api, type CatalogModelView, type OptimizerReport, type WorkflowPlanView } from '../api';
import { usePoll } from '../usePoll';

type Tier = CatalogModelView['tier'];
type Section = 'market' | 'optimizer' | 'outlook';
type MarketData = Awaited<ReturnType<typeof api.market>>;
const TIER_LABEL: Record<Tier, string> = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' };
const TIERS: Tier[] = ['light', 'mid', 'frontier'];
const money = (n: number) => `$${n < 1 ? n.toFixed(n < 0.1 ? 3 : 2) : n.toFixed(2)}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

/** Scraped excerpts can be markdown table cells or links; show them as plain text. */
const cleanExcerpt = (s: string) =>
  s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s*\|\s*/g, ' · ').replace(/^\s*·\s*|\s*·\s*$/g, '').replace(/\s+/g, ' ').trim();

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier tier-${tier}`}>{TIER_LABEL[tier]}</span>;
}

export function Integrations() {
  const models = usePoll(() => api.models(), 0);
  const optimizer = usePoll(() => api.optimizer(), 0);
  const market = usePoll(() => api.market(), 0);
  const [section, setSection] = useState<Section>('market');
  const [scrape, setScrape] = useState<{ busy: '' | 'prices' | 'news'; note?: string }>({ busy: '' });

  async function rescrapePrices() {
    setScrape({ busy: 'prices' });
    try {
      const r = await api.refreshModels();
      setScrape({
        busy: '',
        note: r.skipped ?? `${r.models} models and ${r.announcements} price announcements from ${Object.keys(r.byProvider).length} providers` +
          (r.errors.length ? ` · not scraped: ${r.errors.map((e) => e.split(':')[0]).join(', ')}` : ''),
      });
      void models.reload(); void optimizer.reload();
    } catch (e) { setScrape({ busy: '', note: (e as Error).message }); }
  }
  async function refreshNews() {
    setScrape({ busy: 'news' });
    try {
      const r = await api.refreshApify();
      setScrape({ busy: '', note: r.skipped ?? `${r.marketSignals} news items from Google search and provider pages${r.errors.length ? ` · ${r.errors.length} sources failed` : ''}` });
      void market.reload();
    } catch (e) { setScrape({ busy: '', note: (e as Error).message }); }
  }

  const rows = models.data ?? [];
  const plans = optimizer.data?.plans ?? [];
  const anns = optimizer.data?.announcements ?? [];
  const providers = new Set(rows.map((m) => m.provider));
  const totalSavings = plans.reduce((s, p) => s + (p.options[0]?.monthlySavingsUsd ?? 0), 0);
  const scraped = rows.map((m) => m.fetchedAt).sort().at(-1);
  const tabs: { id: Section; label: string; count: string }[] = [
    { id: 'market', label: 'Model market', count: `${rows.length}` },
    { id: 'optimizer', label: 'Workflow optimizer', count: whole(totalSavings) },
    { id: 'outlook', label: 'Price outlook & news', count: `${anns.length}` },
  ];

  return (
    <div className="mi">
      <header className="mi-head">
        <div>
          <h1>Market intelligence</h1>
          <p className="muted">
            Live AI model prices and announcements scraped with <strong>Apify</strong>, turned into savings for each team.
            {scraped && <> Last scraped {new Date(scraped).toLocaleString()}.</>}
          </p>
        </div>
        <div className="mi-actions">
          <button className="secondary" disabled={!!scrape.busy} onClick={refreshNews}>{scrape.busy === 'news' ? 'Searching the web…' : 'Refresh news'}</button>
          <button className="primary" disabled={!!scrape.busy} onClick={rescrapePrices}>{scrape.busy === 'prices' ? 'Scraping 7 providers…' : 'Rescrape prices'}</button>
        </div>
      </header>
      {scrape.note && <p className="mi-note muted">{scrape.note}</p>}

      <div className="mi-stats">
        <div className="mi-stat"><span className="mi-stat-k">Models tracked</span><span className="mi-stat-v">{rows.length}</span><span className="muted">{providers.size} providers, live prices</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Possible savings</span><span className="mi-stat-v ok">{whole(totalSavings)}</span><span className="muted">this month, best option per team</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Price changes announced</span><span className={`mi-stat-v ${anns.length ? 'warn' : ''}`}>{anns.length}</span><span className="muted">{anns[0] ? `next: ${anns[0].model}, ${shortDate(anns[0].effectiveDate)}` : 'none found'}</span></div>
      </div>

      <nav className="mi-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={section === t.id} className={section === t.id ? 'on' : ''} onClick={() => setSection(t.id)}>
            {t.label} <span className="mi-tab-count">{t.count}</span>
          </button>
        ))}
      </nav>

      {section === 'market' && <ModelMarket rows={rows} error={models.error} />}
      {section === 'optimizer' && <Optimizer plans={plans} error={optimizer.error} />}
      {section === 'outlook' && <Outlook data={optimizer.data} market={market.data} error={market.error ?? optimizer.error} />}
    </div>
  );
}

function ModelMarket({ rows, error }: { rows: CatalogModelView[]; error: string | null }) {
  const [tier, setTier] = useState<'all' | Tier>('all');
  const [openAll, setOpenAll] = useState(false);
  const shown = rows.filter((m) => tier === 'all' || m.tier === tier);
  const byProvider = [...new Set(shown.map((m) => m.provider))].sort().map((p) => ({ provider: p, models: shown.filter((m) => m.provider === p) }));
  const best = TIERS.map((t) => rows.filter((m) => m.tier === t).sort((a, b) => a.blendedPerMTok - b.blendedPerMTok)[0]).filter(Boolean);

  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>Model market <span className="badge src web">Apify</span></h2>
        <p className="muted">Current API prices from each provider's pricing page, every row checked against the page it came from.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <h3 className="mi-sub">Best value by tier</h3>
      <div className="best-grid">
        {best.map((m) => (
          <article key={m.tier} className="best">
            <div className="best-top"><TierBadge tier={m.tier} />{m.openWeight && <span className="tag">open-weight</span>}</div>
            <a href={m.url} target="_blank" rel="noreferrer" className="best-name">{m.model}</a>
            <span className="muted">{m.provider}{m.via ? ` · via ${m.via}` : ''}</span>
            <span className="best-price">{money(m.blendedPerMTok)}<span className="muted"> / MTok blended</span></span>
            <span className="muted">{money(m.inputPerMTok)} in · {money(m.outputPerMTok)} out{m.contextWindow ? ` · ${m.contextWindow}` : ''}</span>
            {m.bestFor && <span className="muted best-for">“{m.bestFor}”</span>}
          </article>
        ))}
      </div>

      <div className="mi-filters">
        <h3 className="mi-sub" style={{ margin: 0 }}>All models by provider</h3>
        <div className="seg">
          {(['all', ...TIERS] as const).map((t) => (
            <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}>{t === 'all' ? 'All tiers' : TIER_LABEL[t]}</button>
          ))}
        </div>
        <button className="link-btn" onClick={() => setOpenAll(!openAll)}>{openAll ? 'Collapse all' : 'Expand all'}</button>
      </div>
      <div className="acc">
        {byProvider.map(({ provider, models }) => {
          const cheapest = [...models].sort((a, b) => a.blendedPerMTok - b.blendedPerMTok)[0];
          return (
            <details key={`${provider}-${openAll}`} open={openAll}>
              <summary>
                <span className="acc-title">{provider}{models[0].via && <span className="muted"> · via {models[0].via}</span>}</span>
                <span className="muted">{models.length} model{models.length === 1 ? '' : 's'}</span>
                <span className="acc-right muted">from <strong>{money(cheapest.blendedPerMTok)}</strong>/MTok</span>
              </summary>
              <table className="mi-table">
                <thead><tr><th>Model</th><th>Tier</th><th className="num">Input</th><th className="num">Output</th><th className="num">Blended</th><th>Context</th><th>Best for (provider's words)</th></tr></thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.model}>
                      <td className="mi-model"><a href={m.url} target="_blank" rel="noreferrer">{m.model}</a>{m.openWeight && <span className="tag">open-weight</span>}</td>
                      <td><TierBadge tier={m.tier} /></td>
                      <td className="num">{money(m.inputPerMTok)}</td>
                      <td className="num">{money(m.outputPerMTok)}</td>
                      <td className="num"><strong>{money(m.blendedPerMTok)}</strong></td>
                      <td>{m.contextWindow ?? <span className="muted">—</span>}</td>
                      <td className="muted mi-bestfor">{m.bestFor ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
      </div>
      {rows.length === 0 && <p className="muted">No scraped models yet. Click Rescrape prices.</p>}
      <p className="muted mi-foot">
        USD per million tokens. Blended = (3 × input + output) ÷ 4. Tiers by blended price: lightweight under $1, mid under $5, frontier $5 and up.
        OpenAI's own pricing page blocks scrapers, so its prices come from a third-party tracker (shown as “via”).
      </p>
    </section>
  );
}

function Optimizer({ plans, error }: { plans: WorkflowPlanView[]; error: string | null }) {
  const top = [...plans].sort((a, b) => (b.options[0]?.monthlySavingsUsd ?? 0) - (a.options[0]?.monthlySavingsUsd ?? 0))[0]?.team;
  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>Workflow optimizer <span className="badge src web">Apify</span></h2>
        <p className="muted">Each team's main AI task, priced on its current model and on cheaper models that can still do the job. Open a team to see the options and trade-offs. Suggestions only: test quality on a sample before switching.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="acc">
        {plans.map((p) => {
          const best = p.options[0];
          return (
            <details key={p.team} open={p.team === top}>
              <summary>
                <span className="acc-title">{TEAM_INFO[p.team].label}</span>
                <span className="muted acc-task">{p.task}</span>
                <span className="muted">on <strong>{p.currentModel}</strong> · {whole(p.taskSpendUsd)}/mo</span>
                <span className="acc-right">
                  {best ? <span className="save-pill">save {whole(best.monthlySavingsUsd)}/mo</span> : <span className="muted">already optimal</span>}
                </span>
              </summary>
              <div className="acc-body">
                {p.options.length === 0 && <p className="muted">Already on the cheapest model that suits this work (needs at least {TIER_LABEL[p.minTier].toLowerCase()}).</p>}
                {p.options.map((o, i) => (
                  <div key={o.model} className="opt-row">
                    <div className="opt-main">
                      <div>
                        {i === 0 && <span className="tag tag-best">Best saving</span>}
                        {o.openWeight && <span className="tag">open-weight</span>}
                        <a href={o.url} target="_blank" rel="noreferrer"><strong>{o.model}</strong></a>
                        <span className="muted"> · {o.provider}{o.via ? ` (via ${o.via})` : ''} · {money(o.blendedPerMTok)}/MTok</span> <TierBadge tier={o.tier} />
                      </div>
                      <p className="opt-trade">{o.tradeoff}</p>
                      {o.bestFor && <p className="muted opt-quote">{o.provider} says: “{o.bestFor}”</p>}
                      {o.priceChange && <p className="opt-warn">Price rises from {shortDate(o.priceChange.effectiveDate)}: the saving drops to {whole(o.priceChange.savingsAfterUsd)}/month.</p>}
                    </div>
                    <div className="opt-save">
                      <span className="opt-save-v">−{whole(o.monthlySavingsUsd)}</span>
                      <span className="muted">{Math.round(o.savingsPct * 100)}% of this task</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <p className="muted mi-foot">
        Each team's main task and its share of spend are assumptions for the demo company. Savings = this month's projected spend on the task × (1 − new price ÷ current price), at live prices.
      </p>
    </section>
  );
}

function Outlook({ data, market, error }: { data: OptimizerReport | null; market: MarketData | null; error: string | null }) {
  const anns = data?.announcements ?? [];
  const news = [...(market?.signals ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const [allNews, setAllNews] = useState(false);
  return (
    <section className="panel mi-section">
      <div className="mi-section-head">
        <h2>Price outlook <span className="badge src web">Apify</span></h2>
        <p className="muted">Scheduled price changes announced on provider pages, what they mean for each team, and the next three months at this month's run-rate.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {anns.length > 0 ? (
        <div className="ann-grid">
          {anns.map((a) => {
            const w = data?.whatIfs.find((x) => x.provider === a.provider && x.model === a.model && x.effectiveDate === a.effectiveDate);
            return (
              <article key={`${a.provider}-${a.model}-${a.effectiveDate}`} className="ann">
                <div className="ann-when">{shortDate(a.effectiveDate)} <span className={`ann-pct ${a.changePct > 0 ? 'up' : 'down'}`}>{pct(a.changePct)}</span></div>
                <div className="ann-what"><strong>{a.model}</strong> <span className="muted">· {a.provider}</span></div>
                <div className="ann-change">
                  {money(a.currentInputPerMTok)} → {money(a.newInputPerMTok)} input
                  {a.newOutputPerMTok !== undefined && <> · {money(a.currentOutputPerMTok!)} → {money(a.newOutputPerMTok)} output</>}
                </div>
                {w
                  ? <p className="ann-impact"><strong>For Northwind:</strong> {w.text}</p>
                  : <p className="ann-impact muted">For Northwind: no team uses {a.model} and it isn't a cheaper fit for any team's main task.</p>}
                <details className="ann-src">
                  <summary>Source</summary>
                  <blockquote>“{a.excerpt}”</blockquote>
                  <a href={a.url} target="_blank" rel="noreferrer">{new URL(a.url).hostname}</a>
                </details>
              </article>
            );
          })}
        </div>
      ) : <p className="muted">No scheduled price changes found on provider pages.</p>}

      {data && data.outlook.length > 0 && (
        <>
          <h3 className="mi-sub">Cost outlook, next three months</h3>
          <table className="mi-table">
            <thead><tr><th>Month</th><th className="num">On today's models</th><th className="num">With the recommended switches</th><th className="num">Difference</th></tr></thead>
            <tbody>
              {data.outlook.map((o) => (
                <tr key={o.month}>
                  <td><strong>{o.label}</strong>{o.notes.length > 0 && <div className="muted">{o.notes.join(' ')}</div>}</td>
                  <td className="num">{whole(o.currentModelsUsd)}</td>
                  <td className="num ok">{whole(o.recommendedPlanUsd)}</td>
                  <td className="num ok">−{whole(o.currentModelsUsd - o.recommendedPlanUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted mi-foot">Run-rate = this month's TokenBook estimate per team, with no new drivers. Announced price changes apply from their effective date.</p>
        </>
      )}

      <details className="news-box" open>
        <summary><span className="acc-title">Market news</span> <span className="muted">{news.length} items · context only, never changes a number</span></summary>
        <ul className="news">
          {(allNews ? news : news.slice(0, 4)).map((s) => (
            <li key={s.id}>
              <span className="news-date">{shortDate(s.date)}</span>
              <span className="badge">{s.kind}</span>
              <div>
                <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                <div className="muted">“{cleanExcerpt(s.excerpt)}”</div>
              </div>
            </li>
          ))}
        </ul>
        {news.length > 4 && <button className="link-btn" onClick={() => setAllNews(!allNews)}>{allNews ? 'Show fewer' : `Show all ${news.length}`}</button>}
        {(market?.priceChanges ?? []).map((c) => (
          <p key={`${c.model}-${c.effectiveDate}`} className="muted mi-foot">
            Example scenario (offline sample, not a real announcement): {c.model} {money(c.from.inputPerMTok)} → {money(c.to.inputPerMTok)} input from {shortDate(c.effectiveDate)}.
          </p>
        ))}
      </details>
    </section>
  );
}
