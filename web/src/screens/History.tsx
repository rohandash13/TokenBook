// OWNER: C
import type { HistoryReport } from '../../../src/shared/api';
import type { Method } from '../../../src/shared/types';
import { TEAM_INFO, TEAMS, monthLabel } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import { api } from '../api';
import { usePoll } from '../usePoll';

const METHOD_LABEL: Record<Method, string> = { lastmonth: 'Last month', runrate: 'Run-rate', trueup: 'TokenBook' };
const METHOD_DESCRIPTION: Record<Method, string> = { lastmonth: 'Reuse the previous month’s actual spend.', runrate: 'Project current daily spend through month-end.', trueup: 'Use current spend plus confirmed upcoming usage changes.' };
const METHODS: Method[] = ['lastmonth', 'runrate', 'trueup'];

export function History() {
  const { data, error } = usePoll(() => api.history(), 0);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading history…</p>;

  return <HistoryReportView data={data} />;
}

export function HistoryReportView({ data, embedded = false }: { data: HistoryReport; embedded?: boolean }) {
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
    <div className="accuracy-page">
      {!embedded && <>
      <header className="accuracy-header"><h1>Forecast accuracy</h1><p>Forecasts vs. final bills. Lower error is better.</p></header>
      <div className="accuracy-scope accuracy-scope-compact"><span>{range}</span><span>{compared.length} results</span><button type="button" className="link-btn" onClick={() => { const help = document.getElementById('accuracy-methodology'); if (help instanceof HTMLDetailsElement) { help.open = true; help.scrollIntoView({ block: 'start' }); } }}>How to read this ↓</button></div>
      {compared.length > 0 && (
        <div className="stats">
          <div className={`stat ${net > 0 ? 'ok' : ''}`}>
            <span className="stat-label">{net >= 0 ? 'Less error vs. run-rate' : 'More error vs. run-rate'}</span>
            <span className="stat-value">{formatUsd(Math.abs(net))}</span>
            <span className="stat-sub">total forecast error · not spend</span>
          </div>
          <div className="stat">
            <span className="stat-label">TokenBook average error</span>
            <span className="stat-value">{pct('trueup')?.n ? `${(pct('trueup')!.maePct * 100).toFixed(2)}%` : '—'}</span>
            <span className="stat-sub">Average distance from the bill</span>
          </div>
          <div className="stat">
            <span className="stat-label">Best method this period</span>
            <span className="stat-value">{best ? METHOD_LABEL[best] : '—'}</span>
            <span className="stat-sub">{best ? `${(pct(best)!.maePct * 100).toFixed(2)}% average error` : 'No scored results yet'}</span>
          </div>
        </div>
      )}

      </>}
      {catches.length > 0 && (
        <section className="panel">
          <h2>What run-rate would have missed <span className="muted">Team-months where signals moved the estimate closer to the bill</span></h2>
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
        <h2>Method comparison <span className="muted">Forecasts as of the 25th</span></h2>
        <table>
          <thead>
            <tr><th>Method</th><th className="num">Average error ($)</th><th className="num">Average error (%) ↓</th><th className="num">Results scored</th></tr>
          </thead>
          <tbody>
            {data.byMethod.map((m) => (
              <tr key={m.method} className={m.method === best ? 'accuracy-best-row' : ''}>
                <td><div className="accuracy-method-name">{METHOD_LABEL[m.method]} {m.method === best && <span className="badge approved">Lowest error</span>}</div><p className="accuracy-method-description">{METHOD_DESCRIPTION[m.method]}</p></td>
                <td className="num">{m.n === 0 ? '—' : formatUsd(m.maeUsd)}</td>
                <td className="num">{m.n === 0 ? '—' : `${(m.maePct * 100).toFixed(2)}%`}</td>
                <td className="num">{m.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Do forecasts tend to run high or low?</h2><p className="accuracy-help">+ Too high · − Too low · Suggestions only</p>
        <table>
          <thead><tr><th>Team</th><th className="num">Historical bias (%)</th><th>Reading</th></tr></thead>
          <tbody>
            {TEAMS.map((t) => {
              const b = data.biasByTeam[t];
              return (
                <tr key={t}>
                  <td>{TEAM_INFO[t].label}</td>
                  <td className="num">{b === undefined ? '—' : formatPct(b)}</td>
                  <td className="muted">
                    {b === undefined ? 'No suggestion' : b === 0 ? 'About right' : b > 0 ? 'Usually high — consider lowering.' : 'Usually low — consider raising.'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {data.rows.length > 0 && (
        <details className="panel accuracy-details">
          <summary>Show results by team and month <span>{data.rows.length} results</span></summary><p className="accuracy-help">Positive = estimated too high. Negative = estimated too low. Closer to 0% is better.</p>
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
        </details>
      )}
      <details id="accuracy-methodology" className="panel accuracy-details"><summary>How to read these results</summary><p className="accuracy-help">We compare estimates made on the 25th with final monthly bills. A 1% error means $1 off for every $100 billed. These figures measure forecast error, not AI extraction accuracy. Bias suggestions are never applied automatically.</p><p className="accuracy-help">Dollar error is the absolute difference between estimate and actual bill. Percentage error divides that difference by the actual bill; zero-dollar bills are excluded from the percentage average. Each team and month has equal weight. The total comparison adds run-rate dollar errors and subtracts TokenBook dollar errors for matched results; it is not a spend reduction. A team-month means one team in one month.</p></details>
    </div>
  );
}
