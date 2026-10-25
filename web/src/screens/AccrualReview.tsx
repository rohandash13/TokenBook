// OWNER: C
import { Fragment, useEffect, useRef, useState } from 'react';
import type { Overrides } from '../../../src/shared/api';
import { ACCOUNT_NAMES, DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Team } from '../../../src/shared/types';
import { api } from '../api';
import { driverSummary, EventLine, EvidenceLink, longDate, shortDate, titleCase } from '../Evidence';
import { SignOff } from '../SignOff';
import { usePoll } from '../usePoll';

const EXPORT_LABEL = 'ERP-ready CSV for Hyphenate to post.';
const CONF = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const monthName = new Date(`${DEMO.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const cents = (usd: number) => Math.round(usd * 100);
// Source tags like "usage:support:2026-10" or "override:controller" stay in the entry and the CSV
// export for the audit trail; the screen shows only the readable evidence (tags if that's all there is).
const isTag = (x: string) => !/\s/.test(x) && x.includes(':');
const readableEvidence = (ev: string[]) => (ev.some((x) => !isTag(x)) ? ev.filter((x) => !isTag(x)) : ev);
// One line per journal line: the calculation sentence of the basis ("$6,120 through Oct 25 + 6 days at $245/day"),
// or the override amount. The full text stays in the tooltip, the entry and the CSV.
function basisLine(ev: string[]): string {
  const text = readableEvidence(ev).join(' ');
  if (text.startsWith('Manual override')) return text.split(' (model')[0];
  const sentences = text.split(/(?<=\.)\s+/);
  return (sentences.find((x) => x.includes(' through ')) ?? sentences[0]).replace(/\.$/, '');
}

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
  const runRate = (team: Team) => (data ?? []).find((e) => e.team === team && e.method === 'runrate')?.estimate;
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<Set<Team>>(new Set()); // teams whose detail row is expanded
  const toggle = (team: Team) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(team)) next.delete(team); else next.add(team);
    return next;
  });
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

  async function refreshSignals() {
    setRefreshing(true);
    try { await api.refreshSignals(month); setMsg(null); } catch (e) { setMsg((e as Error).message); }
    finally { setRefreshing(false); }
  }

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

  // Headline tiles: what's being booked and what the signals changed.
  const amountFor = (team: Team, est: number) => (locked ? booked(team) ?? est : overrides[team] ?? est);
  const toAccrue = trueUps.reduce((sum, e) => sum + amountFor(e.team, e.estimate), 0);
  const moved = trueUps
    .map((e) => ({ team: e.team, diff: e.estimate - (runRate(e.team) ?? e.estimate) }))
    .filter((m) => Math.abs(m.diff) >= 1);
  const signalDelta = moved.reduce((sum, m) => sum + m.diff, 0);

  return (
    <>
      {trueUps.length > 0 && (
        <div className="stats two">
          <div className="stat">
            <span className="stat-label">To accrue for {monthName}</span>
            <span className="stat-value">{formatUsd(toAccrue)}</span>
            <span className="stat-sub">{TEAMS.length} teams · {formatUsd(trueUps.reduce((s2, e) => s2 + e.actualToDate, 0))} used so far</span>
          </div>
          <div className="stat">
            <span className="stat-label">Change from signals</span>
            <span className="stat-value">{signalDelta >= 0 ? '+' : '−'}{formatUsd(Math.abs(signalDelta))}</span>
            <span className="stat-sub">
              {moved.length ? `vs run-rate · ${moved.map((m) => TEAM_INFO[m.team].label).join(', ')}` : 'No drivers found yet'}
            </span>
          </div>
        </div>
      )}
      <section className="panel">
        <h2>
          Estimates by team {trueUps[0] && <span className="muted">as of {shortDate(trueUps[0].asOf)}</span>}
          <span style={{ flex: 1 }} />
          <button className="secondary" disabled={refreshing || locked} onClick={refreshSignals}>
            {refreshing ? 'Scanning…' : 'Refresh signals'}
          </button>
        </h2>
        {error && <p className="error">{error}</p>}
        {!entry && msg && <p className="error">{msg}</p>}
        <table>
          <thead>
            <tr>
              <th>Team</th><th className="num">Used to date</th><th className="num">Run-rate</th><th className="num">Estimate</th>
              <th>Driver</th><th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {TEAMS.map((team) => {
              const e = trueUps.find((x) => x.team === team);
              if (!e) return null;
              const ctx = contexts?.find((x) => x.team === team);
              const d = driverSummary(ctx, e.asOf);
              const expanded = open.has(team);
              const cls = [e.confidence === 'low' ? 'low' : '', flash.has(team) ? 'flash' : ''].join(' ');
              return (
                <Fragment key={`${team}-${flash.get(team) ?? 0}`}>
                  <tr className={cls}>
                    <td>{TEAM_INFO[team].label}</td>
                    <td className="num">{formatUsd(e.actualToDate)}</td>
                    <td className="num muted-num">{runRate(team) === undefined ? '' : formatUsd(runRate(team)!)}</td>
                    <td className="num">
                      {draft ? (
                        <input className="amount" placeholder={String(Math.round(e.estimate))} value={draft[team] ?? ''}
                          onChange={(ev) => setDraft({ ...draft, [team]: ev.target.value })} />
                      ) : locked && booked(team) !== undefined ? (
                        <>
                          <b>{formatUsd(booked(team)!)}</b>
                          <div className="muted">Booked</div>
                        </>
                      ) : (
                        <>
                          <b>{formatUsd(overrides[team] ?? e.estimate)}</b>
                          {overrides[team] !== undefined && <div className="muted">Manual · model {formatUsd(e.estimate)}</div>}
                          <Delta est={e.estimate} base={runRate(team)} />
                        </>
                      )}
                    </td>
                    <td className="driver">
                      <span>{d.text}</span>
                      {d.sources.length > 0 && <span className="muted"> · {d.sources.join(', ')}</span>}
                      {d.review > 0 && <span className="review-note"> · {d.review} to review</span>}
                      <button className="link-btn details-btn" aria-expanded={expanded} onClick={() => toggle(team)}>
                        {expanded ? 'Hide details' : 'Details'}
                      </button>
                    </td>
                    <td><span className={`badge ${e.confidence}`}>{CONF[e.confidence]}</span></td>
                  </tr>
                  {expanded && (
                    <tr className="detail-row">
                      <td />
                      <td colSpan={5}>
                        {ctx?.events.filter((ev) => ev.date >= e.asOf).map((ev, i) => <EventLine key={i} ev={ev} max={4} n={90} />)}
                        {ctx?.flags?.map((flag, i) => (
                          <div className="event" key={`flag-${i}`}>
                            <span className="badge low">Needs review</span> {shortDate(flag.date)} · {flag.note} <span className="muted">({flag.reason})</span>
                            {!!flag.evidence?.length && <ul className="evidence">{flag.evidence.map((ev) => <EvidenceLink key={ev.id} ev={ev} />)}</ul>}
                          </div>
                        ))}
                        <div className="basis-text">{e.basis}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {entry && (
        <section className="panel">
          <h2>
            Accrual entry <span className={`badge ${entry.status}`}>{titleCase(entry.status)}</span>
            <span className="muted" title={entry.id}>{longDate(entry.date)}</span>
          </h2>
          <table>
            <thead>
              <tr><th>Account</th><th>Team</th><th className="num">Debit</th><th className="num">Credit</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {entry.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.account} · {ACCOUNT_NAMES[l.account]}</td>
                  <td>{l.team ? TEAM_INFO[l.team].label : ''}</td>
                  <td className="num">{l.debit ? formatUsd(l.debit, true) : ''}</td>
                  <td className="num">{l.credit ? formatUsd(l.credit, true) : ''}</td>
                  <td className="basis" title={readableEvidence(l.evidence).join(' ')}>{basisLine(l.evidence)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total accrued for {monthName}</td>
                <td className="num">{formatUsd(dr / 100, true)}</td>
                <td className="num">{formatUsd(cr / 100, true)}</td>
                <td>
                  {balanced ? (
                    <span className="balance-note ok">Balanced</span>
                  ) : (
                    <span className="balance-note bad">Out of balance by {formatUsd(Math.abs(dr - cr) / 100, true)}</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
          <SignOff id={entry.id} preparedBy="TokenBook" preparedHow="Calculated from usage data and team signals. No AI in the numbers."
            reviewer={DEMO.controller} reviewed={entry.status !== 'prepared'} pendingText={`Waiting for ${DEMO.controller} to approve`} hideLabels />
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
            <a className="button" aria-disabled={!locked} href={locked ? api.exportUrl(entry.id) : undefined} title={EXPORT_LABEL}
              onClick={() => { setTimeout(() => void loadJournal(), 800); }}>Export CSV</a>
          </div>
          {msg && <p className="error">{msg}</p>}
        </section>
      )}
    </>
  );
}

// "+$2,450 vs run-rate" under the TokenBook estimate: what the signals changed.
function Delta({ est, base }: { est: number; base?: number }) {
  if (base === undefined) return null;
  const d = Math.round(est - base);
  if (Math.abs(d) < 1) return null;
  return <div className={`rr-delta ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '+' : '−'}{formatUsd(Math.abs(d))} vs run-rate</div>;
}
