// OWNER: C
import { useEffect, useState } from 'react';
import type { StoredMemo } from '../../../src/shared/api';
import { DEMO, TEAM_INFO } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Variance } from '../../../src/shared/types';
import { api } from '../api';

const monthName = new Date(`${DEMO.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

export function VarianceMemo() {
  const month = DEMO.month;
  const [variances, setVariances] = useState<Variance[]>([]);
  const [memos, setMemos] = useState<StoredMemo[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [v, m, j] = await Promise.all([api.variances(month), api.memos(month), api.journal(month)]);
    setVariances(v); setMemos(m); setEntries(j);
  }
  useEffect(() => { refresh().catch((e) => setMsg((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadActuals() {
    setBusy(true);
    try { await api.loadActuals(month); await refresh(); setMsg(null); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const posted = entries.filter((e) => e.kind !== 'accrual');
  const replaceMemo = (m: StoredMemo) => setMemos((ms) => ms.map((x) => (x.team === m.team ? m : x)));

  return (
    <>
      <section className="panel">
        <h2>{monthName} actuals and true-up</h2>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={loadActuals}>
            {posted.length ? 'Reload actuals' : `Load ${monthName} actuals`}
          </button>
          {posted.map((e) => (
            <span key={e.id} className="muted">
              <span className={`badge ${e.status}`}>{e.status}</span> {e.id} ({e.date}) · <a href={api.exportUrl(e.id)} onClick={() => setTimeout(() => void refresh().catch(() => {}), 800)}>CSV</a>
            </span>
          ))}
        </div>
        {variances.length === 0 && !msg && <p className="muted">No actuals loaded yet — load {monthName} actuals to see variances.</p>}
        {msg && <p className="error">{msg}</p>}
      </section>

      <div className="split">
        <div>
          {variances.length > 0 && (
            <section className="panel">
              <h2>Variance by team <span className="muted">memo required when over 10% and over $500</span></h2>
              <table>
                <thead>
                  <tr>
                    <th>Team</th><th className="num">Accrued</th><th className="num">Actual</th>
                    <th className="num">Over/(under) accrual</th><th className="num">% of actual</th><th />
                  </tr>
                </thead>
                <tbody>
                  {variances.map((v) => (
                    <tr key={v.team} className={v.needsMemo ? 'danger' : ''}>
                      <td>{TEAM_INFO[v.team].label}</td>
                      <td className="num">{formatUsd(v.estimate, true)}</td>
                      <td className="num">{formatUsd(v.actual, true)}</td>
                      <td className="num">{formatUsd(v.varianceUsd, true)}</td>
                      <td className="num">{formatPct(v.variancePct)}</td>
                      <td>
                        {v.varianceUsd > 0 ? 'over-accrued' : v.varianceUsd < 0 ? 'under-accrued' : 'on target'}
                        {v.needsMemo && <> <span className="badge danger">memo required</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
        <div>
          {memos.map((m) => <MemoCard key={m.team} memo={m} onChange={replaceMemo} />)}
          {variances.length > 0 && memos.length === 0 && <p className="muted">No variance needs a memo.</p>}
        </div>
      </div>
    </>
  );
}

function MemoCard({ memo, onChange }: { memo: StoredMemo; onChange: (m: StoredMemo) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memo.text);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<StoredMemo>) {
    try { const m = await fn(); setText(m.text); onChange(m); setEditing(false); setErr(null); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="panel">
      <h2>
        Audit memo — {TEAM_INFO[memo.team].label}
        {memo.attached && <span className="badge attached">attached</span>}
        {memo.editedAt && <span className="muted">edited {new Date(memo.editedAt).toLocaleString()}</span>}
      </h2>
      {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} /> : <p className="memo-text">{memo.text}</p>}
      <p className="muted">Sources: {memo.sources.join(' · ')}</p>
      {memo.jiraTaskKey && <p className="muted">Jira task opened: <strong>{memo.jiraTaskKey}</strong> (Atlassian)</p>}
      <div className="actions">
        {editing ? (
          <>
            <button className="primary" onClick={() => run(() => api.editMemo(memo.month, memo.team, text))}>Save</button>
            <button className="secondary" onClick={() => { setText(memo.text); setEditing(false); }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="primary" disabled={memo.attached} onClick={() => run(() => api.attachMemo(memo.month, memo.team))}>
              {memo.attached ? 'Attached to close ✓' : 'Attach to close'}
            </button>
            <button className="secondary" disabled={memo.attached} onClick={() => setEditing(true)}>Edit memo</button>
          </>
        )}
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
