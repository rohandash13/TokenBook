// OWNER: C
import { useEffect, useRef, useState } from 'react';
import type { Overrides } from '../../../src/shared/api';
import { ACCOUNT_NAMES, DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Team } from '../../../src/shared/types';
import { api } from '../api';
import { SignOff } from '../SignOff';
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
  const [flash, setFlash] = useState<Map<Team, number>>(new Map()); // team -> flash counter (restarts animation)
  const prev = useRef<Partial<Record<Team, number>>>({});
  const flashN = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepSeq = useRef(0);
  const hydrated = useRef(false);

  const { data: contexts } = usePoll(() => api.getContexts(month), 3000);
  const trueUps = (data ?? []).filter((e) => e.method === 'trueup');
  const sig = trueUps.map((e) => `${e.team}:${e.estimate}`).join('|') + JSON.stringify(overrides);

  const loadJournal = () =>
    api.journal(month)
      .then((es) => {
        const acc = es.find((e) => e.kind === 'accrual') ?? null;
        setEntry(acc);
        // Re-hydrate controller overrides from a prepared entry so they survive remounts and reloads.
        if (acc && acc.status === 'prepared' && !hydrated.current) {
          const o: Overrides = {};
          for (const l of acc.lines) if (l.team && l.evidence.includes('override:controller')) o[l.team] = l.debit;
          setOverrides(o);
        }
        hydrated.current = true;
      })
      .catch((e) => setMsg((e as Error).message));

  useEffect(() => {
    void loadJournal().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Keep the prepared entry in step with the latest estimates and overrides; never touch it once approved.
  useEffect(() => {
    if (!loaded || trueUps.length === 0) return;
    if (entry && entry.status !== 'prepared') return;
    const id = ++prepSeq.current;
    api.prepare(month, overrides)
      .then((r) => {
        if (id !== prepSeq.current) return; // stale response
        setEntry((cur) => (cur && cur.status !== 'prepared' ? cur : r.entry));
        setMsg(null);
      })
      .catch((e) => { if (id === prepSeq.current) setMsg((e as Error).message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, loaded]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Flash rows whose estimate moved since the last poll.
  useEffect(() => {
    const moved = trueUps.filter((e) => prev.current[e.team] !== undefined && prev.current[e.team] !== e.estimate).map((e) => e.team);
    trueUps.forEach((e) => { prev.current[e.team] = e.estimate; });
    if (moved.length === 0) return;
    const n = ++flashN.current;
    setFlash(new Map(moved.map((t) => [t, n])));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(new Map()), 2500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  async function approve() {
    if (!entry) return;
    prepSeq.current++; // invalidate any in-flight prepare
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
  const booked = (team: Team) => entry?.lines.find((l) => l.team === team)?.debit; // locked entries show what was booked

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
                <tr key={`${team}-${flash.get(team) ?? 0}`} className={cls}>
                  <td>{TEAM_INFO[team].label}</td>
                  <td className="num">{formatUsd(e.actualToDate)}</td>
                  <td className="num">
                    {draft ? (
                      <input className="amount" placeholder={String(Math.round(e.estimate))} value={draft[team] ?? ''}
                        onChange={(ev) => setDraft({ ...draft, [team]: ev.target.value })} />
                    ) : locked && booked(team) !== undefined ? (
                      <>
                        {formatUsd(booked(team)!)}
                        <div className="muted">booked</div>
                      </>
                    ) : (
                      <>
                        {formatUsd(overrides[team] ?? e.estimate)}
                        {overrides[team] !== undefined && <div className="muted">override (model {formatUsd(e.estimate)})</div>}
                      </>
                    )}
                  </td>
                  <td className="basis">{e.basis}</td>
                  <td>
                    <span className={`badge ${e.confidence}`}>{e.confidence}</span>
                    {(() => {
                      const c = contexts?.find((x) => x.team === team);
                      if (c?.replied) return <span className="badge src lead" style={{ marginLeft: 6 }}>Lead</span>;
                      if (c?.inferred && c.events.length) return <span className="badge src slack" style={{ marginLeft: 6 }}>Slack/GitHub</span>;
                      return null;
                    })()}
                  </td>
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
          <SignOff id={entry.id} preparedBy="TrueUp" preparedHow="calculated from usage and lead input; no AI in the numbers"
            reviewer={DEMO.controller} reviewed={entry.status !== 'prepared'} pendingText={`Waiting for ${DEMO.controller} to approve`} />
          <div className="actions">
            <button className="primary" disabled={locked} onClick={approve}>Approve entry</button>
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
