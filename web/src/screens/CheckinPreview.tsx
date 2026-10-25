// OWNER: C
import { useState } from 'react';
import type { PostContextResult } from '../../../src/shared/api';
import { DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { Team, TeamContext } from '../../../src/shared/types';
import { api } from '../api';
import { usePoll } from '../usePoll';

export function CheckinPreview() {
  const month = DEMO.month;
  const { data: contexts, error, reload } = usePoll(() => api.contexts(month), 3000);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({ team: 'support' as Team, quote: '', date: `${month}-27`, multiplier: '3' });
  const [result, setResult] = useState<PostContextResult | null>(null);

  async function send(team: Team) {
    try { await api.checkin(team); setMsg({ text: `Check-in sent to ${TEAM_INFO[team].leadName}.`, ok: true }); }
    catch (e) { setMsg({ text: `${(e as Error).message} — use the form below instead.`, ok: false }); }
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
        <div className="cards">
          {TEAMS.map((team) => {
            const ctx = contexts?.find((c) => c.team === team);
            const status = !ctx ? 'awaiting' : ctx.replied ? 'replied' : 'no reply';
            return (
              <div key={team} className="panel">
                <h2>
                  {TEAM_INFO[team].label} <span className="muted">{ctx?.leadName ?? TEAM_INFO[team].leadName}</span>
                  <span className={`badge ${status === 'replied' ? 'replied' : status === 'no reply' ? 'danger' : 'draft'}`}>{status}</span>
                </h2>
                {ctx?.quote ? <p>“{ctx.quote}”</p> : <p className="muted">No quote yet.</p>}
                {ctx?.events.map((ev, i) => (
                  <p key={i} className="muted">{ev.multiplier}× from {ev.date} — {ev.note}</p>
                ))}
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
