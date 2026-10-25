// OWNER: C — budgets and spend policies: each team's projection against its budget, model caps, alerts.
import { useEffect, useState } from 'react';
import type { Policies, Status } from '../../../src/shared/api';
import { DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { Team } from '../../../src/shared/types';
import { api } from '../api';
import { usePoll } from '../usePoll';

const LABEL: Record<Status, string> = { ok: 'within budget', warn: 'near limit', over: 'over budget' };
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
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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
  return (
    <>
      <section className="panel">
        <h2>Budgets &amp; spend policies <span className="muted">projected month-end spend vs the limits finance set · refreshes every 3s</span></h2>
        {report.error && <p className="error">{report.error}</p>}
        {r && r.alerts.length > 0 && (
          <ul className="alerts">
            {r.alerts.map((a) => <li key={a} className="error">⚠ {a}</li>)}
          </ul>
        )}
        {r && r.alerts.length === 0 && <p className="muted">Every team and model is within its limit.</p>}
      </section>

      {r?.suggestions && r.suggestions.length > 0 && (
        <section className="panel">
          <h2>Cheaper options <span className="badge src web">Apify</span><span className="muted">live prices from the model market · suggestions only</span></h2>
          <table>
            <thead><tr><th>Team</th><th>Suggestion</th><th className="num">Est. monthly saving</th><th /></tr></thead>
            <tbody>
              {r.suggestions.map((s) => (
                <tr key={`${s.team}-${s.toModel}`}>
                  <td>{TEAM_INFO[s.team].label}</td>
                  <td>
                    {s.text}
                    <div className="muted">
                      {s.fromModel} ${s.fromBlendedPerMTok.toFixed(2)} → {s.toModel} ({s.toProvider}{s.openWeight ? ', open-weight' : ''}) ${s.toBlendedPerMTok.toFixed(s.toBlendedPerMTok < 1 ? 3 : 2)} blended per MTok ·{' '}
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer">price source</a>
                    </div>
                  </td>
                  <td className="num">{formatUsd(s.monthlySavingsUsd)}</td>
                  <td>{s.coversOverage === true && <span className="badge approved">covers the overage</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">What each team mostly uses AI for, and how much of its spend that is, are assumptions for the demo company. Test quality on a sample before switching.</p>
        </section>
      )}

      <section className="panel">
        <h2>Team budgets <span className="muted">projection = TokenBook estimate for {r?.month ?? DEMO.month}, as of {r?.asOf ?? DEMO.asOf}</span></h2>
        <table>
          <thead>
            <tr><th>Team</th><th className="num">Spent to date</th><th className="num">Projected</th><th className="num">Budget</th><th>Used</th><th className="num">Headroom</th><th /></tr>
          </thead>
          <tbody>
            {TEAMS.map((team) => {
              const t = r?.teams.find((x) => x.team === team);
              return (
                <tr key={team} className={t?.status === 'over' ? 'danger' : ''}>
                  <td>{TEAM_INFO[team].label}</td>
                  <td className="num">{t ? formatUsd(t.actualToDateUsd) : '—'}</td>
                  <td className="num">{t ? formatUsd(t.projectedUsd) : '—'}</td>
                  <td className="num">
                    {draft
                      ? <input className="amount" value={draft[team] ?? String(policies?.teamBudgets[team] ?? '')} onChange={(e) => setDraft({ ...draft, [team]: e.target.value })} />
                      : t ? formatUsd(t.budgetUsd) : <span className="muted">none</span>}
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

      <section className="panel">
        <h2>Model caps <span className="muted">company-wide monthly limit per model</span></h2>
        <table>
          <thead><tr><th>Model</th><th className="num">Spent to date</th><th className="num">Projected</th><th className="num">Cap</th><th>Used</th><th /></tr></thead>
          <tbody>
            {(r?.models ?? []).map((m) => (
              <tr key={m.model} className={m.status === 'over' ? 'danger' : ''}>
                <td>{m.model}</td>
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
        <div className="actions">
          {draft
            ? <><button className="primary" onClick={save}>Save limits</button><button className="secondary" onClick={() => setDraft(null)}>Cancel</button></>
            : <button className="secondary" disabled={!policies} onClick={() => setDraft({})}>Edit limits</button>}
          {msg && <span className="error">{msg}</span>}
        </div>
      </section>
    </>
  );
}
