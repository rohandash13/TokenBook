// OWNER: C
// A controller's view of forecast changes, unresolved claims, and their Slack/GitHub/Gmail evidence, plus each
// team's Jira issues (sent in by the TokenBook Forge app), each linking to the ticket in Jira.
import { useEffect, useState } from 'react';
import type { PostContextResult } from '../../../src/shared/api';
import { DEMO, lastDayOfMonth, monthLabel, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { Evidence, Team, TeamContext } from '../../../src/shared/types';
import { api, type SignalItem } from '../api';
import { EvidenceDisclosure, EvidenceLink, SourceEvidenceGroups, EventLine, shortDate, SourceBadge } from '../Evidence';
import { flagKey } from '../../../src/shared/flagReviews';
import { FlagResolver } from '../FlagResolver';
import { usePoll } from '../usePoll';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function status(ctx?: TeamContext): { label: string; cls: string; note: string } {
  if (ctx?.replied) return { label: ctx.leadName === DEMO.controller ? 'Manual override' : 'Lead override', cls: 'medium', note: 'This override takes precedence over automatic signals.' };
  if (ctx?.inferred && ctx.events.length) return { label: 'Driver found', cls: 'inferred', note: '' };
  if (ctx?.flags?.length) return { label: 'Review needed', cls: 'low', note: 'Confirmation needed before these claims can affect the forecast.' };
  if (ctx?.inferred) return { label: 'No changes found', cls: 'approved', note: 'No upcoming changes to API usage found. Forecast stays at run-rate.' };
  return { label: 'Not scanned', cls: 'neutral', note: 'Refresh signals to check for upcoming usage changes.' };
}
const checkedTime = (date: string) => new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Signals() {
  const month = DEMO.month;
  const { data: contexts, error, reload } = usePoll(() => api.contexts(month), 3000);
  const { data: estimates, error: estimateError, reload: reloadEstimates } = usePoll(() => api.estimates(month), 3000);
  const { data: reviews, reload: reloadReviews } = usePoll(() => api.flagReviews(month), 3000);
  const { data: jira } = usePoll(() => api.jiraIssues(), 5000);
  const [filter, setFilter] = useState<'all' | 'review'>('all');
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
      const unavailable = results.filter((r) => r.skipped === 'source unavailable');
      const overrides = results.filter((r) => r.skipped === 'lead replied').length;
      const summary = `Updated ${results.filter((r) => !r.skipped).length} teams · ${plural(found.length, 'team')} with a driver${overrides ? ` · ${plural(overrides, 'override')} preserved` : ''}.`;
      setRefreshMsg({ text: unavailable.length ? `${summary} Sources unavailable for ${unavailable.map((r) => TEAM_INFO[r.team].label).join(', ')}; previous forecasts kept.` : summary, ok: unavailable.length === 0 });
      await Promise.all([reload(), reloadEstimates(), loadSignals()]);
    } catch (e) {
      setRefreshMsg({ text: `Could not refresh signals: ${(e as Error).message}`, ok: false });
    } finally { setRefreshing(false); }
  }

  const driverCount = contexts?.reduce((n, c) => n + c.events.length, 0) ?? 0;
  const reviewCount = contexts?.reduce((n, c) => n + (c.flags?.length ?? 0), 0) ?? 0;
  const visibleTeams = filter === 'review' ? TEAMS.filter((team) => contexts?.some((c) => c.team === team && c.flags?.length)) : TEAMS;
  return (
    <div className="signals-page">
      <header className="signals-header">
        <div><h1>Integrations</h1><p>See what changes the forecast and what needs your review.</p></div>
        <div className="signals-header-actions"><SourceBadge source="slack" /><SourceBadge source="github" /><SourceBadge source="gmail" /><SourceBadge source="jira" /><button className="primary" disabled={refreshing} onClick={refresh}>{refreshing ? 'Scanning…' : 'Refresh signals'}</button></div>
      </header>
      <div className="signals-summary"><span>{monthLabel(month)}</span><span><b>{TEAMS.length}</b> teams</span><span><b>{driverCount}</b> forecast {driverCount === 1 ? 'driver' : 'drivers'}</span><span className={reviewCount ? 'review-count' : ''}><b>{reviewCount}</b> to review</span></div>
      <div className="signals-controls"><div className="signal-filters" role="group" aria-label="Filter teams"><button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All teams <span>{TEAMS.length}</span></button><button type="button" aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>Needs review <span>{reviewCount}</span></button></div><a className="forecast-link" href="#accrual">Review accrual →</a></div>
      {estimateError && <p className="error" role="alert">Forecast amounts unavailable: {estimateError}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {refreshMsg && <p role="status" className={refreshMsg.ok ? 'ok' : 'error'}>{refreshMsg.text}</p>}
      {!contexts && !error && <div className="signals-grid" aria-label="Loading team signals" aria-busy="true">{TEAMS.map((team) => <div className="signal-card signal-loading" key={team}><span className="sk sk-line" /><span className="sk sk-big" /><span className="sk sk-row" /></div>)}</div>}
      {contexts && visibleTeams.length === 0 && <div className="signal-filter-empty" role="status"><b>No items need review</b><p>There are no unresolved signal flags for this month.</p><button className="secondary" onClick={() => setFilter('all')}>Show all teams</button></div>}
      <div className="signals-grid">
        {(contexts ? visibleTeams : []).map((team) => {
          const ctx = contexts?.find((c) => c.team === team);
          const s = status(ctx);
          const scanned = signals[team] ?? [];
          const sourceActivity = [...new Set(scanned.map((s) => s.source))].flatMap((source) => scanned.find((s) => s.source === source) ?? []);
          const forecast = estimates?.find((e) => e.team === team && e.method === 'trueup');
          const baseline = estimates?.find((e) => e.team === team && e.method === 'runrate');
          const difference = forecast && baseline ? forecast.estimate - baseline.estimate : null;
          const issues: Evidence[] = (jira ?? []).filter((v) => v.team === team)
            .sort((a, b) => b.issue.updatedAt.localeCompare(a.issue.updatedAt))
            .map(({ issue, event }) => ({
              source: 'jira', id: issue.key, url: issue.url, date: issue.updatedAt.slice(0, 10), author: issue.key,
              text: `${issue.summary}${issue.dueDate ? ` · due ${shortDate(issue.dueDate)}` : ''}${event ? ` · ${event.multiplier}× in the forecast` : ''}`,
            }));
          return (
            <section key={team} className="signal-card" aria-labelledby={`signal-${team}`}>
              <header className="signal-card-header"><div className="signal-team"><span className={`signal-avatar ${team}`}>{TEAM_INFO[team].label.slice(0, 1)}</span><div><h2 id={`signal-${team}`}>{TEAM_INFO[team].label}</h2><span className="signal-owner">{ctx?.leadName ?? TEAM_INFO[team].leadName} · {ctx?.leadName === DEMO.controller ? 'Controller' : 'Team lead'}</span></div></div><span className={`badge ${s.cls}`}>{s.label}</span></header>
              <div className="signal-forecast"><div><span>Month-end forecast</span><strong>{forecast ? formatUsd(forecast.estimate) : '—'}</strong></div><div className="signal-forecast-comparison">{difference !== null && Math.abs(difference) >= 1 ? <><b>{difference > 0 ? '+' : '−'}{formatUsd(Math.abs(difference))}</b><span>vs. run-rate</span></> : <span>{forecast ? 'At run-rate' : 'Amount unavailable'}</span>}</div></div>
              <div className="signal-card-body">
                {ctx?.replied && ctx.quote && <blockquote className="signal-quote">“{ctx.quote}”</blockquote>}
                {!!ctx?.events.length && <div className="forecast-drivers"><div className="signal-section-label">In the forecast</div>{ctx.events.map((ev, i) => <EventLine key={i} ev={ev} max={3} collapsible />)}</div>}
                {!!ctx?.flags?.length && <div className="signal-review"><div className="signal-section-label">Needs confirmation <span>{ctx.flags.length}</span></div><p className="signal-review-intro">Excluded from the forecast. Ask {ctx.leadName ?? TEAM_INFO[team].leadName} to confirm.</p>{ctx.flags.map((flag, i) => <details className="review-item" key={flagKey(flag)}><summary><span>{flag.note}</span><time dateTime={flag.date}>{shortDate(flag.date)}</time></summary><p className="signal-review-reason">{flag.reason}</p>{!!flag.evidence?.length && <SourceEvidenceGroups evidence={flag.evidence} />}<FlagResolver team={team} flag={flag} onSaved={() => { void reload(); void reloadEstimates(); void reloadReviews(); setRefreshMsg({ ok: true, text: 'Review saved. Forecast updated; approved journal entries are unchanged.' }); }} /></details>)}</div>}
                {s.note && <p className={`signal-status-note ${!ctx?.events.length && !ctx?.flags?.length ? 'signal-empty' : ''}`}>{s.note}</p>}
                {(!ctx?.events.length || ctx?.replied) && sourceActivity.length > 0 && <div className="team-source-activity"><div className="signal-section-label">Source activity <span className="event-sources">{sourceActivity.map((item) => <SourceBadge key={item.source} source={item.source} />)}</span></div><p className="source-activity-note">{ctx?.replied ? 'Shown for context. Your lead override remains the forecast authority.' : 'Recent source context. Only confirmed drivers affect the forecast.'}</p><SourceEvidenceGroups evidence={scanned} /></div>}
                {issues.length > 0 && <div className="team-jira"><EvidenceDisclosure source="jira" label="Jira issues" count={issues.length}><ul className="evidence">{issues.map((ev) => <EvidenceLink key={ev.id} ev={ev} />)}</ul></EvidenceDisclosure></div>}
              </div>
              <footer className="signal-card-footer"><span>{ctx?.inferredAt ? `Checked ${checkedTime(ctx.inferredAt)}` : ctx?.repliedAt ? `Override ${checkedTime(ctx.repliedAt)}` : 'Awaiting scan'}</span>
              </footer>
            </section>
          );
        })}
      </div>
      {!!reviews?.length && <details className="panel review-history"><summary>Review history · {reviews.length}</summary>{[...reviews].reverse().map((review) => <div className="review-history-row" key={review.id}><b>{TEAM_INFO[review.team].label} · {review.action === 'confirm' ? 'Confirmed' : 'Dismissed'}</b><span>{review.reviewedBy} · {checkedTime(review.reviewedAt)}</span><p>{review.reason}</p></div>)}</details>}
      <ManualDriver onSaved={() => { void reload(); void reloadEstimates(); }} />
    </div>
  );
}

// Fallback if a live integration is down: the controller records a driver by hand.
function ManualDriver({ onSaved }: { onSaved: () => void }) {
  const month = DEMO.month;
  const [form, setForm] = useState({ team: 'support' as Team, note: '', date: `${month}-27`, multiplier: '3' });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<PostContextResult | null>(null);

  async function submit() {
    const multiplier = Number(form.multiplier);
    const note = form.note.trim();
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10 || !form.multiplier.trim() || !form.date || !form.date.startsWith(`${month}-`)) {
      setMsg('Enter a multiplier from 0 to 10 and a date within the selected month.');
      return;
    }
    const events = multiplier !== 1 ? [{ date: form.date, multiplier, note: note || 'Manual driver' }] : [];
    const body: TeamContext = { team: form.team, month, replied: true, leadName: DEMO.controller, events, ...(note && { quote: note }) };
    setSaving(true);
    try {
      setResult(await api.postContext(body));
      setMsg(null);
      onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <details className="panel manual-driver">
      <summary><b>Manual forecast override</b><span className="muted">Optional · entered by the controller</span></summary>
      <p className="override-explanation">Applying an override replaces this team’s current drivers and takes precedence over automatic signals. It does not approve the journal entry.</p>
      <form className="override-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label htmlFor="override-team">Team<select id="override-team" value={form.team} onChange={(e) => { setForm({ ...form, team: e.target.value as Team }); setResult(null); }}>
          {TEAMS.map((t) => <option key={t} value={t}>{TEAM_INFO[t].label}</option>)}
        </select></label>
        <label htmlFor="override-note">Reason<input id="override-note" placeholder="e.g. Support agent launch" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <label htmlFor="override-date">Effective date<input id="override-date" type="date" min={`${month}-01`} max={lastDayOfMonth(month)} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label htmlFor="override-multiplier">Usage multiplier<input id="override-multiplier" type="number" min="0" max="10" step="any" required value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} aria-describedby="multiplier-help" /></label>
        <button className="primary" type="submit" disabled={saving}>{saving ? 'Applying…' : 'Apply override'}</button>
      </form>
      <p id="multiplier-help" className="muted">1× = baseline usage · 3× = triple usage · 0× = no usage</p>
      {msg && <p className="error" role="alert">{msg}</p>}
      {result && <p className="override-result" role="status">{TEAM_INFO[result.context.team].label} forecast: <b>{result.before ? formatUsd(result.before.estimate) : '—'}</b> → <b>{result.after ? formatUsd(result.after.estimate) : '—'}</b>. Manual override applied.</p>}
    </details>
  );
}
