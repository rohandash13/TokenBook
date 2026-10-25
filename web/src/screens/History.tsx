// OWNER: C
import type { Method } from '../../../src/shared/types';
import { TEAM_INFO, TEAMS, monthLabel } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import { api } from '../api';
import { usePoll } from '../usePoll';

const METHOD_LABEL: Record<Method, string> = { lastmonth: 'Last month', runrate: 'Run-rate', trueup: 'TrueUp' };
const METHODS: Method[] = ['lastmonth', 'runrate', 'trueup'];

export function History() {
  const { data, error } = usePoll(() => api.history(), 0);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading history…</p>;

  const scored = data.byMethod.filter((m) => m.n > 0);
  const best = scored.length ? scored.reduce((a, b) => (b.maePct < a.maePct ? b : a)).method : null;
  const range = data.months.length ? `${monthLabel(data.months[0])} – ${monthLabel(data.months[data.months.length - 1])}` : 'no months';

  return (
    <>
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
                <td className="num">{formatUsd(m.maeUsd)}</td>
                <td className="num">{(m.maePct * 100).toFixed(1)}%</td>
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
