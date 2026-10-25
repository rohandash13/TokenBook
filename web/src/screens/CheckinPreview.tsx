// OWNER: C
import { useState } from 'react';
import type { PostContextResult } from '../../../src/shared/api';
import { DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { ContextEvent, Evidence, Team, TeamContext } from '../../../src/shared/types';
import { api } from '../api';
import { usePoll } from '../usePoll';

const SRC_LABEL = { lead: 'Lead', slack: 'Slack', github: 'GitHub' } as const;
const trunc = (t: string, n = 90) => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const count = (v: number | unknown[]) => (Array.isArray(v) ? v.length : v);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function ctxStatus(ctx?: TeamContext): { label: string; cls: string } {
  if (ctx?.replied) return { label: 'Lead confirmed', cls: 'replied' };
  if (ctx?.inferred && ctx.events.length) return { label: 'Inferred from Slack/GitHub', cls: 'inferred' };
  if (ctx?.inferred) return { label: 'No signal', cls: 'draft' };
  return { label: 'No reply yet', cls: 'danger' };
}

function EvidenceLink({ ev }: { ev: Evidence }) {
  return (
    <li>
      <a href={ev.url} target="_blank" rel="noreferrer">{SRC_LABEL[ev.source]} · {ev.date}</a>{' '}
      <span className="excerpt">{trunc(ev.text)}</span>
    </li>
  );
}

function EventLine({ ev }: { ev: ContextEvent }) {
  const src = ev.source ?? 'lead';
  return (
    <div className="event">
      <span className={`badge src ${src}`}>{SRC_LABEL[src]}</span>
      {ev.multiplier}× from {ev.date} — {ev.note}
      {ev.evidence && ev.evidence.length > 0 && (
        <ul className="evidence">{ev.evidence.map((e) => <EvidenceLink key={e.id} ev={e} />)}</ul>
      )}
    </div>
  );
}

export function CheckinPreview() {
  const month = DEMO.month;
  const { data: contexts, error, reload } = usePoll(() => api.contexts(month), 3000);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({ team: 'support' as Team, quote: '', date: `${month}-27`, multiplier: '3' });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [result, setResult] = useState<PostContextResult | null>(null);

  async function send(team: Team) {
    try { await api.checkin(team); setMsg({ text: `Check-in sent to ${TEAM_INFO[team].leadName}.`, ok: true }); }
    catch (e) { setMsg({ text: `${(e as Error).message} — use the form below instead.`, ok: false }); }
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const { results } = await api.refreshSignals(month);
      const text = results.map((r) => {
        const label = TEAM_INFO[r.team].label;
        if (r.skipped) return `${label}: ${r.skipped}`;
        const n = Array.isArray(r.events) ? r.events.length : r.events;
        if (!n) return `${label}: none`;
        return `${label}: ${plural(n, 'driver')} from ${plural(count(r.signals), 'signal')}`;
      }).join(' · ');
      setRefreshMsg({ text: text || 'No teams returned.', ok: true });
      void reload();
    } catch (e) {
      setRefreshMsg({ text: `Could not refresh signals: ${(e as Error).message}`, ok: false });
    } finally { setRefreshing(false); }
  }

  async function submit() {
    const multiplier = Number(form.multiplier);
    const quote = form.quote.trim();
    if (!Number.isFinite(multiplier) || multiplier <= 0 || !form.date) {
      setMsg({ text: 'Enter a multiplier greater than 0 (1 means no event) and a date.', ok: false });
      return;
    }
    const events = multiplier !== 1
      ? [{ date: form.date, multiplier, note: quote || 'Reported change' }]
      : [];
    const body: TeamContext = { team: form.team, month, replied: true, events, ...(quote && { quote }) };
    try {
      setResult(await api.postContext(body));
      setMsg(null);
      void reload();
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }); }
  }

  return (
    <>
      <section className="panel">
        <h2>Month-end check-ins — {month}</h2>
        {error && <p className="error">{error}</p>}
        <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className="secondary" disabled={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh signals'}</button>
          {refreshMsg && <span className={refreshMsg.ok ? 'ok' : 'error'}>{refreshMsg.text}</span>}
        </div>
        <div className="cards">
          {TEAMS.map((team) => {
            const ctx = contexts?.find((c) => c.team === team);
            const status = ctxStatus(ctx);
            return (
              <div key={team} className="panel">
                <h2>
                  {TEAM_INFO[team].label} <span className="muted">{ctx?.leadName ?? TEAM_INFO[team].leadName}</span>
                  <span className={`badge ${status.cls}`}>{status.label}</span>
                </h2>
                {ctx?.quote ? <p>“{ctx.quote}”</p> : <p className="muted">No quote yet.</p>}
                {ctx?.events.map((ev, i) => <EventLine key={i} ev={ev} />)}
                {ctx?.inferred && ctx.inferredAt && <p className="muted">Checked {new Date(ctx.inferredAt).toLocaleString()}</p>}
                {ctx?.repliedAt && <p className="muted">replied {new Date(ctx.repliedAt).toLocaleString()}</p>}
                <div className="actions"><button className="secondary" onClick={() => send(team)}>Send Slack check-in</button></div>
              </div>
            );
          })}
        </div>
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      </section>

      <section className="panel">
        <h2>Record a reply manually <span className="muted">fallback if Slack is unavailable</span></h2>
        <div className="actions">
          <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value as Team })}>
            {TEAMS.map((t) => <option key={t} value={t}>{TEAM_INFO[t].label}</option>)}
          </select>
          <input style={{ flex: 1 }} placeholder="launching Oct 27, expect about 3x" value={form.quote}
            onChange={(e) => setForm({ ...form, quote: e.target.value })} />
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input className="amount" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} title="multiplier" />
          <button className="primary" onClick={submit}>Save reply</button>
        </div>
        {result && (
          <p>
            That moves {TEAM_INFO[result.context.team].label}'s estimate from{' '}
            <b>{result.before ? formatUsd(result.before.estimate) : '—'}</b> to <b>{result.after ? formatUsd(result.after.estimate) : '—'}</b>.
          </p>
        )}
      </section>
    </>
  );
}
