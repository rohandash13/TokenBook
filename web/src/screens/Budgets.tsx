// OWNER: C — budgets and spend policies: each team's projection against its budget, model caps, alerts,
// and the workflow optimizer (cheaper models for each team's main task, at live prices).
import { useEffect, useState } from 'react';
import type { Policies, Status } from '../../../src/shared/api';
import { DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { Team } from '../../../src/shared/types';
import { api } from '../api';
import { shortDate, titleCase } from '../Evidence';
import { usePoll } from '../usePoll';
import { WorkflowOptimizer } from './WorkflowOptimizer';

const LABEL: Record<Status, string> = { ok: 'Within budget', warn: 'Near limit', over: 'Over budget' };
const CLASS: Record<Status, string> = { ok: 'approved', warn: 'low', over: 'danger' };
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Bar({ value }: { value: number }) {
  const w = Math.min(100, Math.round(value * 100));
  const color = value > 1 ? 'var(--red)' : value >= 0.9 ? 'var(--amber)' : 'var(--green)';
  return (
    <div style={{ background: 'var(--line)', borderRadius: 4, height: 8, width: 140, display: 'inline-block' }}>
      <div style={{ width: `${w}%`, background: color, height: 8, borderRadius: 4 }} />
    </div>
  );
}

export function Budgets() {
  const report = usePoll(() => api.budgets(DEMO.month), 3000);
  const optimizer = usePoll(() => api.optimizer(), 10000);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // ?section=optimize opens the optimizer directly (handy for links and the demo).
  const [section, setSection] = useState<'limits' | 'optimize'>(() =>
    new URLSearchParams(location.search).get('section') === 'optimize' ? 'optimize' : 'limits');

  useEffect(() => { api.policies().then(setPolicies).catch((e) => setMsg(e.message)); }, []);

  async function save() {
    if (!policies || !draft) return;
    const teamBudgets: Policies['teamBudgets'] = { ...policies.teamBudgets };
    const modelCaps = policies.modelCaps.map((c) => ({ ...c }));
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v.replace(/[$,]/g, ''));
      if (!Number.isFinite(n) || n <= 0) { setMsg(`${k}: enter a positive amount`); return; }
      if (k.startsWith('model:')) modelCaps.find((c) => c.model === k.slice(6))!.capUsd = n;
      else teamBudgets[k as Team] = n;
    }
    try {
      setPolicies(await api.savePolicies({ ...policies, teamBudgets, modelCaps }));
      setDraft(null); setMsg(null); void report.reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  const r = report.data;
  if (!r) return <section className="panel"><h2>Budgets &amp; spend policies</h2>{report.error ? <p className="error" role="alert">Could not load budgets: {report.error} <button className="secondary" onClick={() => void report.reload()}>Retry</button></p> : <p className="muted" role="status">Loading budgets and spend projections…</p>}</section>;
  const hasLimits = r.teams.length > 0 || r.models.length > 0;
  const plans = optimizer.data?.plans ?? [];
  const savings = plans.reduce((s, p) => s + p.monthlySavingsUsd, 0);
  const projected = r.teams.reduce((s, t) => s + t.projectedUsd, 0);
  const budgeted = r.teams.reduce((s, t) => s + t.budgetUsd, 0);
  const overTeams = r.teams.filter((t) => t.status === 'over');
  const nearTeams = r.teams.filter((t) => t.status === 'warn');
  const capsOver = r.models.filter((m) => m.status === 'over');
  const editButtons = (
    <div className="actions" style={{ marginTop: 0 }}>
      {draft
        ? <><button className="primary" onClick={save}>Save limits</button><button className="secondary" onClick={() => setDraft(null)}>Cancel</button></>
        : <button className="secondary" disabled={!policies} onClick={() => setDraft({})}>Edit limits</button>}
      {msg && <span className="error">{msg}</span>}
    </div>
  );

  return (
    <div className="mi">
      <header className="mi-head">
        <div>
          <h1>Budgets</h1>
          <p className="muted">Projected month-end AI spend against the limits finance set, and how to bring it down. As of {shortDate(r.asOf ?? DEMO.asOf)}.</p>
        </div>
      </header>

      <div className="mi-stats four">
        <div className="mi-stat">
          <span className="mi-stat-k">Projected vs budget</span>
          <div className="pv">
            <div className="pv-col">
              <span className="pv-label">Projected</span>
              <span className={`pv-num ${projected > budgeted ? 'bad' : ''}`}>{formatUsd(projected)}</span>
            </div>
            <span className="pv-vs">vs</span>
            <div className="pv-col">
              <span className="pv-label">Budget</span>
              <span className="pv-num">{formatUsd(budgeted)}</span>
            </div>
          </div>
          <span className={`pv-diff ${projected > budgeted ? 'bad' : 'ok'}`}>
            {formatUsd(Math.abs(projected - budgeted))} {projected > budgeted ? 'over' : 'under'} budget ({budgeted ? pct(projected / budgeted) : '—'})
          </span>
        </div>
        <div className="mi-stat">
          <span className="mi-stat-k">Teams over budget</span>
          <span className={`mi-stat-v ${overTeams.length ? 'bad' : 'ok'}`}>{overTeams.length}</span>
          <span className="muted">{overTeams.length ? overTeams.map((t) => TEAM_INFO[t.team].label).join(', ') : 'None'}{nearTeams.length ? ` · ${nearTeams.length} near limit` : ''}</span>
        </div>
        <div className="mi-stat">
          <span className="mi-stat-k">Model caps breached</span>
          <span className={`mi-stat-v ${capsOver.length ? 'bad' : 'ok'}`}>{capsOver.length}</span>
          <span className="muted">{capsOver.length ? capsOver.map((m) => m.model).join(', ') : `${r.models.length} checked`}</span>
        </div>
        <button className="mi-stat mi-stat-link" onClick={() => setSection('optimize')}>
          <span className="mi-stat-k">Possible savings</span>
          <span className="mi-stat-v ok">{formatUsd(savings)}</span>
          <span className="muted">per month with cheaper models · Optimize spend →</span>
        </button>
      </div>

      <nav className="mi-tabs" role="tablist">
        <button role="tab" aria-selected={section === 'limits'} className={section === 'limits' ? 'on' : ''} onClick={() => setSection('limits')}>
          Budgets &amp; limits <span className="mi-tab-count">{r.alerts.length} alert{r.alerts.length === 1 ? '' : 's'}</span>
        </button>
        <button role="tab" aria-selected={section === 'optimize'} className={section === 'optimize' ? 'on' : ''} onClick={() => setSection('optimize')}>
          Optimize spend <span className="mi-tab-count">{formatUsd(savings)}/mo</span>
        </button>
      </nav>

      {section === 'limits' && (
        <>
          {report.error && <p className="error">{report.error}</p>}
          {r.alerts.length > 0 && (
            <ul className="alert-list">
              {r.alerts.map((a) => <li key={a}>{titleCase(a)}</li>)}
            </ul>
          )}
          {!hasLimits && <p className="muted">No budget limits configured. Use Edit limits to set team budgets.</p>}
          {hasLimits && r.alerts.length === 0 && <p className="muted">All configured limits are within budget.</p>}

          <section className="panel mi-section">
            <div className="mi-section-head mi-section-row">
              <div>
                <h2>Team budgets</h2>
                <p className="muted">Projection is each team's TokenBook estimate for the month.</p>
              </div>
              {editButtons}
            </div>
            <table className="mi-table">
              <thead>
                <tr><th>Team</th><th className="num">Spent to date</th><th className="num">Projected</th><th className="num">Budget</th><th>Used</th><th className="num">Headroom</th><th /></tr>
              </thead>
              <tbody>
                {TEAMS.map((team) => {
                  const t = r.teams.find((x) => x.team === team);
                  return (
                    <tr key={team} className={t?.status === 'over' ? 'danger' : ''}>
                      <td><strong>{TEAM_INFO[team].label}</strong></td>
                      <td className="num">{t ? formatUsd(t.actualToDateUsd) : '—'}</td>
                      <td className="num">{t ? formatUsd(t.projectedUsd) : '—'}</td>
                      <td className="num">
                        {draft
                          ? <input className="amount" value={draft[team] ?? String(policies?.teamBudgets[team] ?? '')} onChange={(e) => setDraft({ ...draft, [team]: e.target.value })} />
                          : t ? formatUsd(t.budgetUsd) : <span className="muted">None</span>}
                      </td>
                      <td>{t && <><Bar value={t.pctOfBudget} /> <span className="muted">{pct(t.pctOfBudget)}</span></>}</td>
                      <td className="num">{t ? formatUsd(t.headroomUsd) : '—'}</td>
                      <td>{t && <span className={`badge ${CLASS[t.status]}`}>{LABEL[t.status]}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="panel mi-section">
            <div className="mi-section-head">
              <h2>Model caps</h2>
              <p className="muted">Company-wide monthly limit per model.</p>
            </div>
            {r.models.length === 0 && <p className="muted">No model caps configured.</p>}
            {r.models.length > 0 && (
              <table className="mi-table">
                <thead><tr><th>Model</th><th className="num">Spent to date</th><th className="num">Projected</th><th className="num">Cap</th><th>Used</th><th /></tr></thead>
                <tbody>
                  {r.models.map((m) => (
                    <tr key={m.model} className={m.status === 'over' ? 'danger' : ''}>
                      <td><strong>{m.model}</strong></td>
                      <td className="num">{formatUsd(m.actualToDateUsd)}</td>
                      <td className="num">{formatUsd(m.projectedUsd)}</td>
                      <td className="num">
                        {draft
                          ? <input className="amount" value={draft[`model:${m.model}`] ?? String(m.capUsd)} onChange={(e) => setDraft({ ...draft, [`model:${m.model}`]: e.target.value })} />
                          : formatUsd(m.capUsd)}
                      </td>
                      <td><Bar value={m.pctOfCap} /> <span className="muted">{pct(m.pctOfCap)}</span></td>
                      <td><span className={`badge ${CLASS[m.status]}`}>{LABEL[m.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {section === 'optimize' && <WorkflowOptimizer plans={plans} budgets={r.teams} error={optimizer.error} />}
    </div>
  );
}
