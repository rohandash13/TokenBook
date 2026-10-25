// OWNER: C
import type { Method } from '../../../src/shared/types';
import { TEAM_INFO, TEAMS, monthLabel } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import { api } from '../api';
import { usePoll } from '../usePoll';

const METHOD_LABEL: Record<Method, string> = { lastmonth: 'Last month', runrate: 'Run-rate', trueup: 'TokenBook' };
const METHODS: Method[] = ['lastmonth', 'runrate', 'trueup'];

export function History() {
  const { data, error } = usePoll(() => api.history(), 0);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading history…</p>;

  const scored = data.byMethod.filter((m) => m.n > 0);
  const best = scored.length ? scored.reduce((a, b) => (b.maePct < a.maePct ? b : a)).method : null;
  const range = data.months.length ? `${monthLabel(data.months[0])} – ${monthLabel(data.months[data.months.length - 1])}` : 'no months';

  // Dollars TokenBook's estimate landed closer to the bill than run-rate, per team-month.
  const compared = data.rows
    .filter((r) => r.estimates.runrate !== undefined && r.estimates.trueup !== undefined)
    .map((r) => {
      const rrOff = Math.abs(r.estimates.runrate! - r.actual);
      const tbOff = Math.abs(r.estimates.trueup! - r.actual);
      return { ...r, rrOff, tbOff, closer: rrOff - tbOff };
    });
  const catches = compared.filter((r) => r.closer >= 50).sort((a, b) => b.closer - a.closer);
  const misses = compared.filter((r) => r.closer <= -50);
  const net = compared.reduce((sum, r) => sum + r.closer, 0);
  const pct = (m: Method) => data.byMethod.find((x) => x.method === m);

  return (
    <>
      {compared.length > 0 && (
        <div className="stats">
          <div className={`stat ${net > 0 ? 'ok' : ''}`}>
            <span className="stat-label">Closer to the bill than run-rate</span>
            <span className="stat-value">{net >= 0 ? '' : '−'}{formatUsd(Math.abs(net))}</span>
            <span className="stat-sub">net, across {compared.length} team-months</span>
          </div>
          <div className="stat">
            <span className="stat-label">Average error</span>
            <span className="stat-value">{((pct('trueup')?.maePct ?? 0) * 100).toFixed(1)}%</span>
            <span className="stat-sub">TokenBook · run-rate {((pct('runrate')?.maePct ?? 0) * 100).toFixed(1)}% · last month {((pct('lastmonth')?.maePct ?? 0) * 100).toFixed(1)}%</span>
          </div>
          <div className="stat">
            <span className="stat-label">Biggest catch</span>
            <span className="stat-value">{catches[0] ? formatUsd(catches[0].closer) : '—'}</span>
            <span className="stat-sub">{catches[0] ? `${TEAM_INFO[catches[0].team].label} · ${monthLabel(catches[0].month)}` : 'Load actuals to score this month'}</span>
          </div>
        </div>
      )}

      {catches.length > 0 && (
        <section className="panel">
          <h2>What run-rate would have missed <span className="muted">team-months where signals moved the estimate closer to the bill</span></h2>
          <table>
            <thead>
              <tr><th>Team</th><th>Month</th><th className="num">Actual bill</th><th className="num">Run-rate</th><th className="num">TokenBook</th><th className="num">Closer by</th></tr>
            </thead>
            <tbody>
              {catches.slice(0, 5).map((r) => (
                <tr key={`${r.month}-${r.team}`}>
                  <td>{TEAM_INFO[r.team].label}</td>
                  <td>{monthLabel(r.month)}</td>
                  <td className="num">{formatUsd(r.actual)}</td>
                  <td className="num">{formatUsd(r.estimates.runrate!)} <span className="muted">off {formatUsd(r.rrOff)}</span></td>
                  <td className="num">{formatUsd(r.estimates.trueup!)} <span className="muted">off {formatUsd(r.tbOff)}</span></td>
                  <td className="num"><b>{formatUsd(r.closer)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {misses.length > 0 && (
            <p className="muted" style={{ marginTop: 10 }}>
              TokenBook was further off in {misses.length} team-month{misses.length > 1 ? 's' : ''} ({misses.map((r) => `${TEAM_INFO[r.team].label} ${monthLabel(r.month)}`).join(', ')}).
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Estimate accuracy by method <span className="muted">{range}, as of day 25 each month</span></h2>
        <table>
          <thead>
            <tr><th>Method</th><th className="num">Mean abs. error</th><th className="num">Mean abs. error %</th><th className="num">Team-months</th></tr>
          </thead>
          <tbody>
            {data.byMethod.map((m) => (
              <tr key={m.method} className={m.method === best ? 'best' : ''}>
                <td>{METHOD_LABEL[m.method]} {m.method === best && <span className="badge approved">most accurate</span>}</td>
                <td className="num">{m.n === 0 ? '—' : formatUsd(m.maeUsd)}</td>
                <td className="num">{m.n === 0 ? '—' : `${(m.maePct * 100).toFixed(1)}%`}</td>
                <td className="num">{m.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Bias by team <span className="muted">suggestion only — never applied automatically</span></h2>
        <table>
          <thead><tr><th>Team</th><th className="num">Bias (est. − actual) / actual</th><th>Reading</th></tr></thead>
          <tbody>
            {TEAMS.map((t) => {
              const b = data.biasByTeam[t];
              return (
                <tr key={t}>
                  <td>{TEAM_INFO[t].label}</td>
                  <td className="num">{b === undefined ? '—' : formatPct(b)}</td>
                  <td className="muted">
                    {b === undefined ? 'no suggestion' : b === 0 ? 'about right' : b > 0 ? 'over-accrues — consider lowering estimates' : 'under-accrues — consider raising estimates'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {data.rows.length > 0 && (
        <section className="panel">
          <h2>Error by team and month <span className="muted">(estimate − actual) / actual</span></h2>
          <table>
            <thead>
              <tr>
                <th>Month</th><th>Team</th><th className="num">Actual</th>
                {METHODS.map((m) => <th key={m} className="num">{METHOD_LABEL[m]}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.month}-${r.team}`}>
                  <td>{monthLabel(r.month)}</td>
                  <td>{TEAM_INFO[r.team].label}</td>
                  <td className="num">{formatUsd(r.actual)}</td>
                  {METHODS.map((m) => (
                    <td key={m} className="num">{r.errorPct[m] === undefined ? '—' : formatPct(r.errorPct[m]!)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
