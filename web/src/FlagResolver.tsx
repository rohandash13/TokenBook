import { useId, useRef, useState } from 'react';
import type { DriverFlag, Team } from '../../src/shared/types';
import { flagKey } from '../../src/shared/flagReviews';
import { DEMO, lastDayOfMonth, TEAM_INFO } from '../../src/shared/config';
import { formatUsd } from '../../src/shared/format';
import { api } from './api';

export function FlagResolver({ flag, team, onSaved }: { flag: DriverFlag; team: Team; onSaved: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState<'confirm' | 'dismiss'>('confirm');
  const [date, setDate] = useState(flag.date);
  const [until, setUntil] = useState('');
  const [multiplier, setMultiplier] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await api.resolveFlag(team, { month: DEMO.month, flagKey: flagKey(flag), action, reason, ...(action === 'confirm' && { date, ...(until && { until }), multiplier: Number(multiplier) }) });
      setResult(`${action === 'confirm' ? 'Change confirmed' : 'Claim dismissed'} by ${response.review.reviewedBy}. ${response.after ? `Forecast: ${formatUsd(response.after.estimate)}.` : ''}`);
      dialog.current?.close(); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="flag-resolver"><button className="secondary" type="button" onClick={() => dialog.current?.showModal()}>Resolve</button>{result && <p role="status">{result}</p>}<dialog className="email-dialog flag-dialog" ref={dialog} aria-labelledby={titleId} onCancel={(e) => { if (busy) e.preventDefault(); }}><div className="email-dialog-heading"><b>Review · {TEAM_INFO[team].label}</b><button type="button" className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button></div><h2 id={titleId}>{flag.note}</h2><p className="muted">Record the answer you confirmed with the team. This updates the forecast, not an approved journal entry.</p><form onSubmit={(e) => { e.preventDefault(); void save(); }}><label>Decision<select value={action} onChange={(e) => setAction(e.target.value as 'confirm' | 'dismiss')}><option value="confirm">Confirm usage change</option><option value="dismiss">Dismiss claim</option></select></label>{action === 'confirm' && <div className="flag-inputs"><label>Effective date<input type="date" required min={DEMO.asOf} max={lastDayOfMonth(DEMO.month)} value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Usage multiplier<input type="number" required min="0" max="10" step="any" placeholder="e.g. 2" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></label><label>End date (optional)<input type="date" min={date} max={lastDayOfMonth(DEMO.month)} value={until} onChange={(e) => setUntil(e.target.value)} /></label></div>}<label>Confirmation or dismissal reason<textarea required minLength={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Who confirmed it, and what did they say?" /></label><p className="muted">Recorded as {DEMO.controller} · Controller</p>{error && <p className="error" role="alert">{error}</p>}<button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : action === 'confirm' ? 'Confirm and update forecast' : 'Dismiss claim'}</button></form></dialog></div>;
}
