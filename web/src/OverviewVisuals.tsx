import { DEMO, TEAM_INFO, TEAMS } from '../../src/shared/config';
import { formatUsd } from '../../src/shared/format';
import type { CloseSnapshot } from './useCloseStatus';
import { SpendChart } from './SpendChart';
import { api } from './api';
import { usePoll } from './usePoll';
import './overviewVisuals.css';

export function OverviewVisuals({ snap }: { snap: CloseSnapshot }) {
  const budgets = usePoll(() => api.budgets(DEMO.month), 10000);
  const estimates = snap.estimates.filter((e) => e.method === 'trueup');
  const peak = Math.max(1, ...estimates.map((e) => Math.max(e.estimate, e.actualToDate)));
  const total = estimates.reduce((sum, e) => sum + e.estimate, 0);
  const baselines = snap.estimates.filter((e) => e.method === 'runrate');
  const baseline = baselines.reduce((sum, e) => sum + e.estimate, 0);
  const impact = total - baseline;
  return <div className="overview-visuals">
    {baselines.length === estimates.length && baselines.length > 0 && <section className="forecast-bridge" aria-label="How signals change the forecast"><div><span>Run-rate alone</span><strong>{formatUsd(baseline)}</strong></div><span aria-hidden="true" className="bridge-operation">{impact >= 0 ? '+' : '−'}</span><div><span>Upcoming usage changes</span><strong>{formatUsd(Math.abs(impact))}</strong></div><span aria-hidden="true" className="bridge-operation">=</span><div className="bridge-result"><span>Month-end forecast</span><strong>{formatUsd(total)}</strong></div><a href="#checkins">See evidence →</a></section>}
    <div className="overview-chart-grid">
      <SpendChart snap={snap} />
      <section className="overview-visual forecast-mix" aria-labelledby="forecast-mix-title">
        <header><div><h2 id="forecast-mix-title">Where spend lands</h2><p>Month-end forecast by team</p></div><a href="#accrual">Review →</a></header>
        <div className="mix-legend"><span><i className="mix-used" />Used</span><span><i className="mix-remaining" />Remaining forecast</span></div>
        <div className="mix-rows">{TEAMS.map((team) => {
          const e = estimates.find((item) => item.team === team);
          if (!e) return null;
          const remaining = Math.max(0, e.estimate - e.actualToDate);
          return <div key={team} className="mix-row"><div className="mix-label"><span>{TEAM_INFO[team].label}</span><strong>{formatUsd(e.estimate)} <small>{total ? Math.round(e.estimate / total * 100) : 0}%</small></strong></div><div className="mix-track" role="img" aria-label={`${TEAM_INFO[team].label}: ${formatUsd(e.actualToDate)} used, ${formatUsd(remaining)} remaining forecast, ${formatUsd(e.estimate)} total`} title={`${formatUsd(e.actualToDate)} used + ${formatUsd(remaining)} remaining`}><span className="mix-used" style={{ width: `${e.actualToDate / peak * 100}%` }} /><span className="mix-remaining" style={{ width: `${remaining / peak * 100}%` }} /></div></div>;
        })}</div>
      </section>
    </div>
    <section className="overview-visual budget-watch" aria-labelledby="budget-watch-title"><header><div><h2 id="budget-watch-title">Budget watch</h2><p>Projected spend against team limits</p></div><a href="#budgets">Manage budgets →</a></header>
      {budgets.error ? <p className="muted">Budget data unavailable. <button className="link-btn" onClick={() => void budgets.reload()}>Retry</button></p> : !budgets.data ? <p className="muted">Loading budget limits…</p> : budgets.data.teams.length === 0 ? <p className="muted">Set team limits on Budgets to track headroom.</p> : <div className="budget-watch-grid">{budgets.data.teams.map((team) => <a key={team.team} className={`budget-watch-item ${team.status}`} href="#budgets" aria-label={`${TEAM_INFO[team.team].label}, ${Math.round(team.pctOfBudget * 100)}% of budget projected`}><div className="mix-label"><span>{TEAM_INFO[team.team].label}</span><strong>{Math.round(team.pctOfBudget * 100)}%</strong></div><div className="budget-watch-track"><span style={{ width: `${Math.min(100, team.pctOfBudget * 100)}%` }} /></div><div className="budget-watch-caption"><span>{formatUsd(team.projectedUsd)} / {formatUsd(team.budgetUsd)}</span><b>{team.headroomUsd < 0 ? `${formatUsd(-team.headroomUsd)} over` : `${formatUsd(team.headroomUsd)} left`}</b></div></a>)}</div>}
    </section>
  </div>;
}
