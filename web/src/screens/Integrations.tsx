// OWNER: C — market intelligence: the live model market and workflow optimizer (Apify), announced price
// changes and the cost outlook, and public market news.
import { useState } from 'react';
import { TEAM_INFO } from '../../../src/shared/config';
import { api, type CatalogModelView, type WorkflowPlanView } from '../api';
import { usePoll } from '../usePoll';

type Tier = CatalogModelView['tier'];
const TIER_LABEL: Record<Tier, string> = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' };
const TIER_CLASS: Record<Tier, string> = { light: 'tier-light', mid: 'tier-mid', frontier: 'tier-frontier' };
const money = (n: number) => `$${n < 1 ? n.toFixed(n < 0.1 ? 3 : 2) : n.toFixed(2)}`;
const whole = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

const SECTIONS = [
  { id: 'market', label: 'Model market' },
  { id: 'optimizer', label: 'Workflow optimizer' },
  { id: 'outlook', label: 'Price outlook & news' },
] as const;

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier ${TIER_CLASS[tier]}`}>{TIER_LABEL[tier]}</span>;
}

export function Integrations() {
  const models = usePoll(() => api.models(), 0);
  const optimizer = usePoll(() => api.optimizer(), 0);
  const market = usePoll(() => api.market(), 0);
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
  const providers = new Set(rows.map((m) => m.provider));
  const cheapestLight = rows.filter((m) => m.tier === 'light').sort((a, b) => a.blendedPerMTok - b.blendedPerMTok)[0];
  const anns = optimizer.data?.announcements ?? [];
  const totalSavings = (optimizer.data?.plans ?? []).reduce((s, p) => s + (p.options[0]?.monthlySavingsUsd ?? 0), 0);
  const scraped = rows.map((m) => m.fetchedAt).sort().at(-1);

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
        <div className="mi-stat"><span className="mi-stat-k">Models tracked</span><span className="mi-stat-v">{rows.length}</span><span className="muted">{providers.size} providers</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Cheapest lightweight</span><span className="mi-stat-v">{cheapestLight ? money(cheapestLight.blendedPerMTok) : '—'}</span><span className="muted">{cheapestLight ? `${cheapestLight.model} · per MTok blended` : ''}</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Possible savings</span><span className="mi-stat-v ok">{whole(totalSavings)}</span><span className="muted">this month, top option per team</span></div>
        <div className="mi-stat"><span className="mi-stat-k">Price changes announced</span><span className={`mi-stat-v ${anns.length ? 'warn' : ''}`}>{anns.length}</span><span className="muted">{anns[0] ? `next: ${anns[0].model}, ${shortDate(anns[0].effectiveDate)}` : 'none found'}</span></div>
      </div>

      <nav className="mi-nav">
        {SECTIONS.map((s) => <a key={s.id} href={`#mi-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`mi-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{s.label}</a>)}
      </nav>

      <ModelMarket rows={rows} error={models.error} />
      <Optimizer plans={optimizer.data?.plans ?? []} error={optimizer.error} />

      <section className="panel mi-section" id="mi-outlook">
        <div className="mi-section-head">
          <h2>Price outlook <span className="badge src web">Apify</span></h2>
          <p className="muted">Scheduled price changes announced on provider pages, and what the next three months cost at this month's run-rate.</p>
        </div>
        {anns.length > 0 ? (
          <div className="ann-grid">
            {anns.map((a) => (
              <article key={`${a.provider}-${a.model}-${a.effectiveDate}`} className="ann">
                <div className="ann-when">{shortDate(a.effectiveDate)}</div>
                <div className="ann-what"><strong>{a.model}</strong> <span className="muted">({a.provider})</span></div>
                <div className="ann-change">
                  {money(a.currentInputPerMTok)} → {money(a.newInputPerMTok)} input
                  {a.newOutputPerMTok !== undefined && <> · {money(a.currentOutputPerMTok!)} → {money(a.newOutputPerMTok)} output</>}
                  <span className={`ann-pct ${a.changePct > 0 ? 'up' : 'down'}`}>{pct(a.changePct)}</span>
                </div>
                <blockquote>“{a.excerpt}”</blockquote>
                {(() => {
                  const w = optimizer.data?.whatIfs.find((x) => x.provider === a.provider && x.model === a.model && x.effectiveDate === a.effectiveDate);
                  return w
                    ? <p className="ann-impact"><strong>For Northwind:</strong> {w.text}</p>
                    : <p className="ann-impact muted">For Northwind: no team uses {a.model}, and it isn't a cheaper fit for any team's main task, so no impact.</p>;
                })()}
                <a href={a.url} target="_blank" rel="noreferrer" className="muted">Source: {new URL(a.url).hostname}</a>
              </article>
            ))}
          </div>
        ) : <p className="muted">No scheduled price changes found on provider pages.</p>}

        {optimizer.data && optimizer.data.outlook.length > 0 && (
          <>
            <h3 className="mi-sub">Cost outlook</h3>
            <table className="mi-table">
              <thead><tr><th>Month</th><th className="num">On today's models</th><th className="num">With the recommended switches</th><th>What changes</th></tr></thead>
              <tbody>
                {optimizer.data.outlook.map((o) => (
                  <tr key={o.month}>
                    <td><strong>{o.label}</strong></td>
                    <td className="num">{whole(o.currentModelsUsd)}</td>
                    <td className="num ok">{whole(o.recommendedPlanUsd)}</td>
                    <td className="muted">{o.notes.length ? o.notes.join(' ') : 'No announced price changes touch these models.'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted mi-foot">Run-rate = this month's TokenBook estimate per team, with no new drivers. Announced price changes apply from their effective date; a switch to a model whose price rises is re-costed at the new price.</p>
          </>
        )}

        <h3 className="mi-sub">Market news</h3>
        {market.error && <p className="error">{market.error}</p>}
        <ul className="news">
          {(market.data?.signals ?? []).map((s) => (
            <li key={s.id}>
              <span className="news-date">{shortDate(s.date)}</span>
              <span className="badge">{s.kind}</span>
              <div>
                <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                <div className="muted">“{s.excerpt}”{s.models.length > 0 && ` · ${s.models.join(', ')}`}</div>
              </div>
            </li>
          ))}
        </ul>
        {(market.data?.priceChanges ?? []).map((c) => (
          <p key={`${c.model}-${c.effectiveDate}`} className="muted mi-foot">
            Example scenario (offline sample, not a real announcement): {c.model} {money(c.from.inputPerMTok)} → {money(c.to.inputPerMTok)} input from {shortDate(c.effectiveDate)};
            impact {c.impacts.map((i) => `${TEAM_INFO[i.team].label} ${pct(i.multiplier - 1)}`).join(', ')}.
          </p>
        ))}
        <p className="muted mi-foot">News is context only and never changes a number. Each excerpt is copied word for word from its page.</p>
      </section>

    </div>
  );
}

function ModelMarket({ rows, error }: { rows: CatalogModelView[]; error: string | null }) {
  const [tier, setTier] = useState<'all' | Tier>('all');
  const [provider, setProvider] = useState('all');
  const providers = [...new Set(rows.map((m) => m.provider))].sort();
  const shown = rows.filter((m) => (tier === 'all' || m.tier === tier) && (provider === 'all' || m.provider === provider));
  return (
    <section className="panel mi-section" id="mi-market">
      <div className="mi-section-head">
        <h2>Model market <span className="badge src web">Apify</span></h2>
        <p className="muted">Current API prices from each provider's pricing page, every row checked against the page it came from.</p>
      </div>
      <div className="mi-filters">
        <div className="seg">
          {(['all', 'light', 'mid', 'frontier'] as const).map((t) => (
            <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}>{t === 'all' ? 'All tiers' : TIER_LABEL[t]}</button>
          ))}
        </div>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="all">All providers</option>
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="muted">{shown.length} of {rows.length} models</span>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="mi-scroll">
        <table className="mi-table">
          <thead>
            <tr><th>Model</th><th>Provider</th><th>Tier</th><th className="num">Input</th><th className="num">Output</th><th className="num">Blended</th><th>Context</th><th>Best for (provider's words)</th></tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={`${m.provider}-${m.model}`}>
                <td className="mi-model">
                  <a href={m.url} target="_blank" rel="noreferrer">{m.model}</a>
                  {m.openWeight && <span className="tag">open-weight</span>}
                </td>
                <td>{m.provider}{m.via && <div className="muted">via {m.via}</div>}</td>
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
      </div>
      {rows.length === 0 && <p className="muted">No scraped models yet. Click Rescrape prices.</p>}
      <p className="muted mi-foot">
        Prices in USD per million tokens. Blended = (3 × input + output) ÷ 4. Tiers by blended price: lightweight under $1, mid under $5, frontier $5 and up.
        OpenAI's own pricing page blocks scrapers, so its prices come from a third-party tracker (shown as “via”).
      </p>
    </section>
  );
}

function Optimizer({ plans, error }: { plans: WorkflowPlanView[]; error: string | null }) {
  return (
    <section className="panel mi-section" id="mi-optimizer">
      <div className="mi-section-head">
        <h2>Workflow optimizer <span className="badge src web">Apify</span></h2>
        <p className="muted">Each team's main AI task, priced on its current model and on cheaper models that can still do the job. Suggestions only: test quality on a sample before switching.</p>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="opt-grid">
        {plans.map((p) => (
          <article key={p.team} className="opt">
            <header>
              <div>
                <strong>{TEAM_INFO[p.team].label}</strong> <span className="muted">· {p.task}</span>
              </div>
              <div className="muted">
                Now on <strong>{p.currentModel}</strong> <TierBadge tier={p.currentTier} /> · {money(p.currentBlendedPerMTok)}/MTok · about <strong>{whole(p.taskSpendUsd)}</strong> this month
              </div>
            </header>
            {p.options.length === 0 && <p className="muted">Already on the cheapest model that suits this work (needs at least {TIER_LABEL[p.minTier].toLowerCase()}).</p>}
            {p.options.map((o, i) => (
              <div key={o.model} className="opt-row">
                <div className="opt-main">
                  <div>
                    {i === 0 && <span className="tag best">Best saving</span>}
                    {o.openWeight && <span className="tag">open-weight</span>}
                    <a href={o.url} target="_blank" rel="noreferrer"><strong>{o.model}</strong></a>
                    <span className="muted"> · {o.provider}{o.via ? ` (via ${o.via})` : ''} · {money(o.blendedPerMTok)}/MTok</span> <TierBadge tier={o.tier} />
                  </div>
                  <p className="opt-trade">{o.tradeoff}</p>
                  {o.bestFor && <p className="muted opt-quote">{o.provider} says: “{o.bestFor}”</p>}
                  {o.priceChange && (
                    <p className="opt-warn">
                      Price rises from {shortDate(o.priceChange.effectiveDate)}: the saving drops to {whole(o.priceChange.savingsAfterUsd)}/month.
                    </p>
                  )}
                </div>
                <div className="opt-save">
                  <span className="opt-save-v">−{whole(o.monthlySavingsUsd)}</span>
                  <span className="muted">{Math.round(o.savingsPct * 100)}% of this task</span>
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
      <p className="muted mi-foot">
        What each team mostly uses AI for, and that task's share of its spend, are assumptions for the demo company.
        Savings = this month's projected spend on the task × (1 − new price ÷ current price), using live prices.
      </p>
    </section>
  );
}
