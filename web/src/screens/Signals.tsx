// OWNER: C
// What TrueUp found in each team's Slack, GitHub and Jira, and the drivers it inferred from it.
import { useEffect, useState } from 'react';
import type { PostContextResult } from '../../../src/shared/api';
import { DEMO, monthLabel, SOURCE_LABEL, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { Team, TeamContext } from '../../../src/shared/types';
import { api, type SignalItem } from '../api';
import { EvidenceLink, EventLine, trunc } from '../Evidence';
import { usePoll } from '../usePoll';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function status(ctx?: TeamContext): { label: string; cls: string; note: string } {
  if (ctx?.replied) return { label: 'Lead override', cls: 'replied', note: 'A lead’s word takes precedence over signals.' };
  if (ctx?.flags?.length) return { label: 'Needs review', cls: 'danger', note: 'Some changes need confirmation. Flagged changes are not included in the estimate.' };
  if (ctx?.inferred && ctx.events.length) return { label: 'Driver found', cls: 'inferred', note: '' };
  if (ctx?.inferred) return { label: 'Nothing unusual', cls: 'approved', note: 'Signals checked; no change to usage expected. Estimate stays at run-rate.' };
  return { label: 'Not checked', cls: 'danger', note: 'No signals collected yet. Estimate uses the 3-month average.' };
}

export function Signals() {
  const month = DEMO.month;
  const { data: contexts, error, reload } = usePoll(() => api.contexts(month), 3000);
  const [signals, setSignals] = useState<Partial<Record<Team, SignalItem[]>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadSignals = () =>
    Promise.all(TEAMS.map((t) => api.signals(month, t).then((s) => [t, s] as const).catch(() => [t, []] as const)))
      .then((pairs) => setSignals(Object.fromEntries(pairs)));

  useEffect(() => { void loadSignals(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const { results } = await api.refreshSignals(month);
      const found = results.filter((r) => !r.skipped && (Array.isArray(r.events) ? r.events.length : r.events) > 0);
      setRefreshMsg({ text: `Scanned ${TEAMS.length} teams · ${plural(found.length, 'team')} with a driver.`, ok: true });
      await Promise.all([reload(), loadSignals()]);
    } catch (e) {
      setRefreshMsg({ text: `Could not refresh signals: ${(e as Error).message}`, ok: false });
    } finally { setRefreshing(false); }
  }

  return (
    <>
      <section className="panel">
        <h2>
          Signals · {monthLabel(month)}
          <span className="muted">TrueUp reads each team’s Slack, GitHub and Jira for launches, campaigns and big runs</span>
        </h2>
        {error && <p className="error">{error}</p>}
        <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className="primary" disabled={refreshing} onClick={refresh}>{refreshing ? 'Scanning…' : 'Refresh signals'}</button>
          {refreshMsg && <span className={refreshMsg.ok ? 'ok' : 'error'}>{refreshMsg.text}</span>}
        </div>
        <div className="cards">
          {TEAMS.map((team) => {
            const ctx = contexts?.find((c) => c.team === team);
            const s = status(ctx);
            const scanned = signals[team] ?? [];
            return (
              <div key={team} className="panel">
                <h2>
                  {TEAM_INFO[team].label}
                  <span className={`badge ${s.cls}`}>{s.label}</span>
                </h2>
                {ctx?.replied && ctx.quote && (
                  <p>“{ctx.quote}” <span className="muted">— {ctx.leadName ?? TEAM_INFO[team].leadName}</span></p>
                )}
                {ctx?.events.map((ev, i) => <EventLine key={i} ev={ev} />)}
                {ctx?.flags?.map((flag, i) => (
                  <div className="event" key={`flag-${i}`}>
                    <span className="badge danger">Needs review</span>{' '}
                    <b>{flag.date}</b> — {flag.note}
                    <p className="muted">{flag.reason} · Ask {ctx.leadName ?? TEAM_INFO[team].leadName} to confirm the expected usage change.</p>
                    {!!flag.evidence?.length && <ul className="evidence">{flag.evidence.map((ev) => <EvidenceLink key={ev.id} ev={ev} />)}</ul>}
                  </div>
                ))}
                {s.note && <p className="muted">{s.note}</p>}
                {scanned.length > 0 && (
                  <details>
                    <summary className="muted">{plural(scanned.length, 'signal')} scanned</summary>
                    <ul className="evidence">
                      {scanned.slice(0, 12).map((sig) => (
                        <li key={sig.id}>
                          <a href={sig.url} target="_blank" rel="noreferrer">{SOURCE_LABEL[sig.source]} · {sig.date}</a>{' '}
                          <span className="excerpt">{trunc(sig.text, 80)}</span>
                        </li>
                      ))}
                      {scanned.length > 12 && <li className="muted">+{scanned.length - 12} more</li>}
                    </ul>
                  </details>
                )}
                {ctx?.inferredAt && <p className="muted">Checked {new Date(ctx.inferredAt).toLocaleString()}</p>}
              </div>
            );
          })}
        </div>
      </section>
      <ManualDriver onSaved={() => void reload()} />
    </>
  );
}

// Fallback if a live integration is down: the controller records a driver by hand.
function ManualDriver({ onSaved }: { onSaved: () => void }) {
  const month = DEMO.month;
  const [form, setForm] = useState({ team: 'support' as Team, note: '', date: `${month}-27`, multiplier: '3' });
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<PostContextResult | null>(null);

  async function submit() {
    const multiplier = Number(form.multiplier);
    const note = form.note.trim();
    if (!Number.isFinite(multiplier) || multiplier <= 0 || !form.date) {
      setMsg('Enter a multiplier greater than 0 (1 means no change) and a date.');
      return;
    }
    const events = multiplier !== 1 ? [{ date: form.date, multiplier, note: note || 'Manual driver' }] : [];
    const body: TeamContext = { team: form.team, month, replied: true, events, ...(note && { quote: note }) };
    try {
      setResult(await api.postContext(body));
      setMsg(null);
      onSaved();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <details className="panel">
      <summary><b>Add a driver manually</b> <span className="muted">fallback if an integration is unavailable</span></summary>
      <div className="actions">
        <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value as Team })}>
          {TEAMS.map((t) => <option key={t} value={t}>{TEAM_INFO[t].label}</option>)}
        </select>
        <input style={{ flex: 1 }} placeholder="Support agent launch" value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input className="amount" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} title="multiplier" />
        <button className="primary" onClick={submit}>Save driver</button>
      </div>
      {msg && <p className="error">{msg}</p>}
      {result && (
        <p>
          That moves {TEAM_INFO[result.context.team].label}'s estimate from{' '}
          <b>{result.before ? formatUsd(result.before.estimate) : '—'}</b> to <b>{result.after ? formatUsd(result.after.estimate) : '—'}</b>.
        </p>
      )}
    </details>
  );
}
