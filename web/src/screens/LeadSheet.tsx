// OWNER: C (overview by Junghwan)
import { useEffect, useRef, useState } from 'react';
import { DEMO, TEAM_INFO, TEAMS, monthLabel } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import { useCountUp } from '../useCountUp';
import { ApprovalReceipt } from '../ApprovalReceipt';
import { OverviewVisuals } from '../OverviewVisuals';
import { ForecastPerformance } from '../ForecastPerformance';
import { IconArrowRight } from '../icons';
import { useSignedAt } from '../SignOff';
import type { CloseSnapshot, Heard, Step, StepKey } from '../useCloseStatus';
import { heardFrom } from '../useCloseStatus';

const HEARD: Record<Heard, string> = { lead: 'Lead', signals: 'Signals', none: 'Not checked' };
const CONF = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

/** Remembers each team's last estimate and reports recent changes for a few seconds. */
function useDeltas(snap: CloseSnapshot | null) {
  const last = useRef<Record<string, number> | null>(null);
  const lastConf = useRef<Record<string, string> | null>(null);
  const [deltas, setDeltas] = useState<Record<string, { diff: number; key: number }>>({});
  useEffect(() => {
    if (!snap) return;
    const now: Record<string, number> = {};
    for (const e of snap.estimates) if (e.method === 'trueup') now[e.team] = e.estimate;
    const conf: Record<string, string> = {};
    for (const e of snap.estimates) if (e.method === 'trueup') conf[e.team] = e.confidence;
    const beforeConf = lastConf.current;
    lastConf.current = conf;
    const before = last.current;
    last.current = now;
    if (!before) return;
    const changed = Object.entries(now).filter(([t, v]) =>
      before[t] !== undefined && (Math.abs(v - before[t]) >= 1 || (beforeConf && beforeConf[t] !== conf[t])));
    if (!changed.length) return;
    const stamp = Date.now();
    setDeltas((d) => ({ ...d, ...Object.fromEntries(changed.map(([t, v]) => [t, { diff: v - before[t], key: stamp }])) }));
    const timer = setTimeout(() => setDeltas((d) => Object.fromEntries(Object.entries(d).filter(([, x]) => x.key !== stamp))), 5000);
    return () => clearTimeout(timer);
  }, [snap]);
  return deltas;
}

export function LeadSheet({ snap, steps, go }: { snap: CloseSnapshot | null; steps: Step[]; go: (k: StepKey) => void }) {
  const deltas = useDeltas(snap);
  if (!snap) return <OverviewSkeleton />;

  const next = steps.find((s) => s.mark !== 'done');
  const trueups = snap.estimates.filter((e) => e.method === 'trueup');
  const total = trueups.reduce((a, e) => a + e.estimate, 0);
  const used = trueups.reduce((a, e) => a + e.actualToDate, 0);
  const heard = TEAMS.filter((t) => heardFrom(snap.contexts.find((c) => c.team === t)) !== 'none').length;
  const flags = snap.contexts.reduce((sum, c) => sum + (c.flags?.length ?? 0), 0);
  const open = flags + (snap.entry?.status === 'prepared' ? 1 : 0) + snap.memos.filter((m) => !m.attached).length;

  return (
    <>
      <div className="page-head">
        <h1>{monthLabel(DEMO.month)} spend</h1>
        {next
          ? <button className="primary cta" onClick={() => go(next.key)}>{next.action} <IconArrowRight /></button>
          : <button className="secondary" onClick={() => go('checkins')}>Review latest signals <IconArrowRight /></button>}
      </div>

      <div className="stats">
        <Stat label="Month-end forecast" value={total} money sub={`${formatUsd(used)} used so far`} />
        <Stat label="Teams checked" value={heard} suffix={` of ${TEAMS.length}`} sub="Team signals or a lead reply" />
        <Stat label="Needs attention" value={open} sub={flags ? `${flags} signal${flags === 1 ? '' : 's'} to confirm` : open ? 'Accounting reviews pending' : 'Monitoring for new changes'} tone={open ? 'warn' : 'ok'} />
      </div>

      <OverviewVisuals snap={snap} />

      <details className="panel overview-team-details">
        <summary>Team details <span>Sources, estimates &amp; confidence</span></summary>
        <table>
          <thead>
            <tr><th>Team</th><th>Source</th><th className="num">Used</th><th className="num">Estimate</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            {TEAMS.map((team) => {
              const e = trueups.find((x) => x.team === team);
              const ctx = snap.contexts.find((c) => c.team === team);
              const h = heardFrom(ctx);
              return (
                <tr key={team} className={deltas[team] ? 'flash' : ''}>
                  <td>
                    <div className="team-cell">
                      <span className={`team-avatar t-${team}`}>{TEAM_INFO[team].label[0]}</span>
                      <span><b>{TEAM_INFO[team].label}</b><small>{ctx?.leadName ?? TEAM_INFO[team].leadName}</small></span>
                    </div>
                  </td>
                  <td><span className={`pill src-${h}`}>{HEARD[h]}</span></td>
                  <td className="num muted-num">{e ? formatUsd(e.actualToDate) : '—'}</td>
                  <td className="num">
                    {deltas[team] && Math.abs(deltas[team].diff) >= 1 && (
                      <span key={deltas[team].key} className={`delta ${deltas[team].diff < 0 ? 'down' : ''}`}>
                        {deltas[team].diff > 0 ? '+' : '−'}{formatUsd(Math.abs(deltas[team].diff))}
                      </span>
                    )}
                    <b>{e ? formatUsd(e.estimate) : '—'}</b>
                  </td>
                  <td>{e && <span className={`badge ${e.confidence}`}>{CONF[e.confidence]}</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Total</td><td className="num">{formatUsd(used)}</td><td className="num">{formatUsd(total)}</td><td /></tr>
          </tfoot>
        </table>
      </details>

      <section className="panel">
        <h2>Accounting activity</h2>
        <div className="signoff-list">
          <SignRow id={snap.entry?.id ?? 'accrual'} paper="Accrual entry" by="TokenBook" ready={!!snap.entry}
            reviewed={snap.entry?.status === 'approved' || snap.entry?.status === 'exported'} />
          <SignRow id={`export:${snap.entry?.id ?? ''}`} paper="ERP export" by="TokenBook" ready={snap.entry?.status === 'exported'}
            reviewed={snap.entry?.status === 'exported'} />
          {snap.memos.map((m) => (
            <SignRow key={m.team} id={`memo:${m.month}:${m.team}`} paper={`${TEAM_INFO[m.team].label} memo`}
              by={m.editedAt ? 'Claude, edited' : 'Claude'} ai ready reviewed={m.attached} />
          ))}
        </div>
      </section>
      <ApprovalReceipt entry={snap.entry} currentForecast={total} />
      <ForecastPerformance />
    </>
  );
}

function Stat({ label, value, money, suffix, sub, tone }: {
  label: string; value: number; money?: boolean; suffix?: string; sub: string; tone?: 'warn' | 'ok';
}) {
  const v = useCountUp(value);
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{money ? formatUsd(v) : Math.round(v)}<small>{suffix}</small></span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function SignRow({ id, paper, by, ai, ready, reviewed }: {
  id: string; paper: string; by: string; ai?: boolean; ready: boolean; reviewed: boolean;
}) {
  const at = useSignedAt(id, reviewed);
  return (
    <div className={`signrow ${reviewed ? 'is-signed' : ''}`}>
      <span className="signrow-paper">{paper}</span>
      <span className="signrow-by">{ready ? <>{by}{ai && <span className="pill ai">AI draft</span>}</> : <span className="faint">Not started</span>}</span>
      <span className="signrow-rev">
        {reviewed
          ? <><span className="sig">{DEMO.controller}</span><span className="faint">{time(at)}</span></>
          : ready ? <span className="pill wait">Needs review</span> : null}
      </span>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true">
      <div className="page-head"><span className="sk sk-title" /></div>
      <div className="stats">{[0, 1, 2].map((i) => <div key={i} className="stat"><span className="sk sk-line" /><span className="sk sk-big" /></div>)}</div>
      <section className="panel"><span className="sk sk-line" /><span className="sk sk-row" /><span className="sk sk-row" /><span className="sk sk-row" /></section>
    </div>
  );
}
