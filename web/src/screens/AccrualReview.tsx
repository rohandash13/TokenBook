// OWNER: C
import { useEffect, useRef, useState } from 'react';
import type { Overrides } from '../../../src/shared/api';
import { ACCOUNT_NAMES, DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Team } from '../../../src/shared/types';
import { api } from '../api';
import { usePoll } from '../usePoll';

const EXPORT_LABEL = 'ERP-ready export — this is where Hyphenate would post it.';
const monthName = new Date(`${DEMO.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const cents = (usd: number) => Math.round(usd * 100);

export function AccrualReview() {
  const month = DEMO.month;
  const { data, error } = usePoll(() => api.estimates(month), 3000);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [draft, setDraft] = useState<Record<string, string> | null>(null); // edit-mode inputs
  const [msg, setMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<Team>>(new Set());
  const prev = useRef<Partial<Record<Team, number>>>({});

  const trueUps = (data ?? []).filter((e) => e.method === 'trueup');
  const sig = trueUps.map((e) => `${e.team}:${e.estimate}`).join('|') + JSON.stringify(overrides);

  const loadJournal = () =>
    api.journal(month)
      .then((es) => setEntry(es.find((e) => e.kind === 'accrual') ?? null))
      .catch((e) => setMsg((e as Error).message));

  useEffect(() => {
    void loadJournal().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Keep the prepared entry in step with the latest estimates and overrides; never touch it once approved.
  useEffect(() => {
    if (!loaded || trueUps.length === 0) return;
    if (entry && entry.status !== 'prepared') return;
    api.prepare(month, overrides).then((r) => setEntry(r.entry)).catch((e) => setMsg((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, loaded]);

  // Flash rows whose estimate moved since the last poll.
  useEffect(() => {
    const moved = trueUps.filter((e) => prev.current[e.team] !== undefined && prev.current[e.team] !== e.estimate).map((e) => e.team);
    trueUps.forEach((e) => { prev.current[e.team] = e.estimate; });
    if (moved.length === 0) return;
    setFlash(new Set(moved));
    const t = setTimeout(() => setFlash(new Set()), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  async function approve() {
    if (!entry) return;
    try { setEntry(await api.approve(entry.id)); setMsg(null); } catch (e) { setMsg((e as Error).message); }
  }

  function saveEdits() {
    const next: Overrides = {};
    for (const [team, v] of Object.entries(draft ?? {})) {
      const n = Number(v.replace(/[$,]/g, ''));
      if (v.trim() !== '' && Number.isFinite(n) && n >= 0) next[team as Team] = n;
    }
    setOverrides(next);
    setDraft(null);
  }

  const locked = entry !== null && entry.status !== 'prepared';
  const dr = entry?.lines.reduce((s, l) => s + cents(l.debit), 0) ?? 0;
  const cr = entry?.lines.reduce((s, l) => s + cents(l.credit), 0) ?? 0;
  const balanced = dr === cr;

  return (
    <>
      <section className="panel">
        <h2>{monthName} close · AI API accruals <span className="muted">estimates refresh every 3s</span></h2>
        {error && <p className="error">{error}</p>}
        {!entry && msg && <p className="error">{msg}</p>}
        <table>
          <thead>
            <tr><th>Team</th><th className="num">Actual to date</th><th className="num">Estimate</th><th>Basis</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            {TEAMS.map((team) => {
              const e = trueUps.find((x) => x.team === team);
              if (!e) return null;
              const cls = [e.confidence === 'low' ? 'low' : '', flash.has(team) ? 'flash' : ''].join(' ');
              return (
                <tr key={team} className={cls}>
                  <td>{TEAM_INFO[team].label}</td>
                  <td className="num">{formatUsd(e.actualToDate)}</td>
                  <td className="num">
                    {draft ? (
                      <input className="amount" placeholder={String(Math.round(e.estimate))} value={draft[team] ?? ''}
                        onChange={(ev) => setDraft({ ...draft, [team]: ev.target.value })} />
                    ) : (
                      <>
                        {formatUsd(overrides[team] ?? e.estimate)}
                        {overrides[team] !== undefined && <div className="muted">override (model {formatUsd(e.estimate)})</div>}
                      </>
                    )}
                  </td>
                  <td className="basis">{e.basis}</td>
                  <td><span className={`badge ${e.confidence}`}>{e.confidence}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {entry && (
        <section className="panel">
          <h2>
            Journal entry {entry.id} <span className={`badge ${entry.status}`}>{entry.status}</span>
            <span className="muted">dated {entry.date}{entry.approvedBy ? ` · approved by ${entry.approvedBy}` : ''}</span>
          </h2>
          <table>
            <thead>
              <tr><th>Account</th><th>Team</th><th className="num">Debit</th><th className="num">Credit</th><th>Evidence</th></tr>
            </thead>
            <tbody>
              {entry.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.account} · {ACCOUNT_NAMES[l.account]}</td>
                  <td>{l.team ? TEAM_INFO[l.team].label : '—'}</td>
                  <td className="num">{l.debit ? formatUsd(l.debit, true) : ''}</td>
                  <td className="num">{l.credit ? formatUsd(l.credit, true) : ''}</td>
                  <td className="basis">{l.evidence.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Dr AI API expense by team · Cr Accrued liabilities · {balanced ? 'balanced' : 'unbalanced'}</td>
                <td className="num">{formatUsd(dr / 100, true)}</td>
                <td className="num">{formatUsd(cr / 100, true)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="actions">
            <button className="primary" disabled={locked} onClick={approve}>{locked ? 'Approved' : 'Approve entry'}</button>
            {draft ? (
              <>
                <button className="secondary" onClick={saveEdits}>Save edits</button>
                <button className="secondary" onClick={() => setDraft(null)}>Cancel</button>
              </>
            ) : (
              <button className="secondary" disabled={locked}
                onClick={() => setDraft(Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)])))}>Edit</button>
            )}
            <a className="button" aria-disabled={!locked} href={locked ? api.exportUrl(entry.id) : undefined}
              onClick={() => { setTimeout(() => void loadJournal(), 800); }}>Export CSV</a>
            <span className="muted">{EXPORT_LABEL}</span>
          </div>
          {msg && <p className="error">{msg}</p>}
        </section>
      )}
    </>
  );
}
