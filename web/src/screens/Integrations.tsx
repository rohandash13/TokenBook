// OWNER: C — what TokenBook collected from Jira (Atlassian Forge app) and the public web (Apify).
import { useState } from 'react';
import { TEAM_INFO } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import { api, type ApifyRefreshResult } from '../api';
import { usePoll } from '../usePoll';

const TIER_LABEL = { light: 'Lightweight', mid: 'Mid', frontier: 'Frontier' } as const;
const money = (n: number) => `$${n < 1 ? n.toFixed(n < 0.1 ? 3 : 2) : n.toFixed(2)}`;

/** Live model market scraped from provider pages with Apify. */
function ModelMarket() {
  const models = usePoll(() => api.models(), 0);
  const [state, setState] = useState<{ busy: boolean; note?: string }>({ busy: false });
  const [tier, setTier] = useState<'all' | 'light' | 'mid' | 'frontier'>('all');
  async function refresh() {
    setState({ busy: true });
    try {
      const r = await api.refreshModels();
      setState({ busy: false, note: r.skipped ?? `${r.models} models from ${Object.keys(r.byProvider).length} providers${r.errors.length ? ` · not scraped: ${r.errors.map((e) => e.split(':')[0]).join(', ')}` : ''}` });
      void models.reload();
    } catch (e) { setState({ busy: false, note: (e as Error).message }); }
  }
  const rows = (models.data ?? []).filter((m) => tier === 'all' || m.tier === tier);
  const scraped = models.data?.[0]?.fetchedAt;
  return (
    <section className="panel">
      <h2>
        Model market <span className="badge src web">Apify</span>
        <span className="muted">current API prices scraped from each provider's own pricing page{scraped ? ` · scraped ${new Date(scraped).toLocaleString()}` : ''}</span>
      </h2>
      <div className="actions">
        {(['all', 'light', 'mid', 'frontier'] as const).map((t) => (
          <button key={t} className={tier === t ? 'primary' : 'secondary'} onClick={() => setTier(t)}>{t === 'all' ? 'All' : TIER_LABEL[t]}</button>
        ))}
        <button className="secondary" disabled={state.busy} onClick={refresh}>{state.busy ? 'Scraping providers with Apify…' : 'Rescrape prices'}</button>
        {state.note && <span className="muted">{state.note}</span>}
      </div>
      {models.error && <p className="error">{models.error}</p>}
      <table>
        <thead>
          <tr><th>Model</th><th>Provider</th><th>Tier</th><th className="num">Input / MTok</th><th className="num">Output / MTok</th><th className="num">Blended</th><th>Context</th><th>Best for (provider's words)</th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.provider}-${m.model}`}>
              <td><a href={m.url} target="_blank" rel="noreferrer">{m.model}</a>{m.openWeight && <> <span className="badge">open-weight</span></>}</td>
              <td>{m.provider}</td>
              <td><span className="badge">{TIER_LABEL[m.tier]}</span></td>
              <td className="num">{money(m.inputPerMTok)}</td>
              <td className="num">{money(m.outputPerMTok)}</td>
              <td className="num">{money(m.blendedPerMTok)}</td>
              <td>{m.contextWindow ?? <span className="muted">—</span>}</td>
              <td className="muted">{m.bestFor ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {models.data?.length === 0 && <p className="muted">No scraped models yet. Click Rescrape prices.</p>}
      <p className="muted">Blended = (3 × input + output) ÷ 4. Tiers: lightweight under $1, mid under $5, frontier $5+. OpenAI's pricing page blocks scrapers, so it isn't listed.</p>
    </section>
  );
}

const pct = (m: number) => `${m > 1 ? '+' : ''}${((m - 1) * 100).toFixed(1)}%`;

export function Integrations() {
  const jira = usePoll(() => api.jiraIssues(), 3000);
  const market = usePoll(() => api.market(), 10000);
  const [refresh, setRefresh] = useState<{ busy: boolean; result?: ApifyRefreshResult; error?: string }>({ busy: false });

  async function runApify() {
    setRefresh({ busy: true });
    try {
      const result = await api.refreshApify();
      setRefresh({ busy: false, result });
      void market.reload();
    } catch (err) {
      setRefresh({ busy: false, error: (err as Error).message });
    }
  }

  return (
    <>
      <ModelMarket />

      <section className="panel">
        <h2>
          Jira <span className="badge src jira">Atlassian</span>
          <span className="muted">issues the TokenBook Forge app sent in · refreshes every 3s</span>
        </h2>
        {jira.error && <p className="error">{jira.error}</p>}
        <table>
          <thead>
            <tr><th>Issue</th><th>Team</th><th>Due</th><th>Driver for the estimate</th></tr>
          </thead>
          <tbody>
            {(jira.data ?? []).map(({ issue, team, event }) => {
              const slip = issue.dueDateHistory.at(-1);
              return (
                <tr key={issue.key}>
                  <td>
                    <a href={issue.url} target="_blank" rel="noreferrer">{issue.key}</a> {issue.summary}
                    <div className="muted">{issue.labels.join(', ')}</div>
                  </td>
                  <td>{team ? TEAM_INFO[team].label : <span className="muted">no team label</span>}</td>
                  <td>
                    {issue.dueDate ?? '—'}
                    {slip && <div className="muted">moved {slip.from} → {slip.to} on {slip.at.slice(0, 10)}</div>}
                  </td>
                  <td>{event ? `${event.multiplier}× from ${event.date}` : <span className="muted">none</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {jira.data?.length === 0 && <p className="muted">No Jira issues yet. Create one in the NW project with a team-* label.</p>}
      </section>

      <section className="panel">
        <h2>
          Model price changes <span className="badge src web">Apify</span>
          <span className="muted">scraped provider pricing pages; impact is deterministic from each team's usage</span>
        </h2>
        <div className="actions">
          <button className="secondary" disabled={refresh.busy} onClick={runApify}>
            {refresh.busy ? 'Scraping with Apify…' : 'Scrape now (Apify)'}
          </button>
          {refresh.result && (
            <span className="muted">
              {refresh.result.skipped ?? `${refresh.result.priceSnapshots} pricing pages, ${refresh.result.marketSignals} news items`}
              {refresh.result.errors.length > 0 && ` · ${refresh.result.errors.length} failed: ${refresh.result.errors[0]}`}
            </span>
          )}
          {refresh.error && <span className="error">{refresh.error}</span>}
        </div>
        {market.error && <p className="error">{market.error}</p>}
        {(market.data?.priceChanges ?? []).map((c) => (
          <div key={`${c.provider}-${c.model}-${c.effectiveDate}`} className="panel">
            <strong>{c.model}</strong>: input ${c.from.inputPerMTok} → ${c.to.inputPerMTok}, output ${c.from.outputPerMTok} → ${c.to.outputPerMTok} per
            MTok, effective <strong>{c.effectiveDate}</strong> (seen {c.announcedAt})
            <div className="muted">
              “{c.excerpt}” · <a href={c.url} target="_blank" rel="noreferrer">source</a>
            </div>
            <table>
              <thead><tr><th>Team</th><th className="num">Daily cost change</th><th className="num">Indicative, at this month's estimate</th></tr></thead>
              <tbody>
                {c.impacts.map((i) => (
                  <tr key={i.team}>
                    <td>{TEAM_INFO[i.team].label}</td>
                    <td className="num">{pct(i.multiplier)}</td>
                    <td className="num">{formatUsd(i.indicativeUsd, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Applied to estimates from {c.effectiveDate}; not to months before it.</p>
          </div>
        ))}
        {market.data?.priceChanges.length === 0 && <p className="muted">No price changes detected.</p>}
      </section>

      <section className="panel">
        <h2>
          Market signals <span className="badge src web">Apify</span>
          <span className="muted">context only — never changes a number</span>
        </h2>
        <table>
          <thead><tr><th>Date</th><th>Kind</th><th>What</th></tr></thead>
          <tbody>
            {(market.data?.signals ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.date}</td>
                <td><span className="badge">{s.kind}</span></td>
                <td>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                  <div className="muted">“{s.excerpt}”{s.models.length > 0 && ` · ${s.models.join(', ')}`}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
