// OWNER: C — what TokenBook collected from Jira (Atlassian Forge app) and the public web (Apify).
import { useState } from 'react';
import { TEAM_INFO } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import { api, type ApifyRefreshResult } from '../api';
import { usePoll } from '../usePoll';

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
