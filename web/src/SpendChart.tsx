// OWNER: C (chart by Junghwan)
// Daily AI API spend for the close month: actual bars through the as-of day, projected bars after it.
// Projection splits each team's (estimate − used so far) across the remaining days by its event
// multipliers, so the projected bars always add up to the estimate shown elsewhere.
import { useEffect, useMemo, useState } from 'react';
import { DEMO, TEAM_INFO, TEAMS } from '../../src/shared/config';
import { formatUsd } from '../../src/shared/format';
import type { Team, UsageDay } from '../../src/shared/types';
import type { CloseSnapshot } from './useCloseStatus';
import './spendChart.css';
import { allocateRemainingSpend } from './spendProjection';

type Day = { date: string; day: number; total: number; byTeam: Partial<Record<Team, number>>; projected: boolean };

function daysIn(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const iso = (month: string, d: number) => `${month}-${String(d).padStart(2, '0')}`;
const short = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function SpendChart({ snap }: { snap: CloseSnapshot }) {
  const month = DEMO.month;
  const [usage, setUsage] = useState<UsageDay[] | null>(null);
  const [error, setError] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/usage?month=${month}`)
      .then((r) => { if (!r.ok) throw new Error('Usage unavailable'); return r.json(); })
      .then((rows: UsageDay[]) => live && setUsage(rows))
      .catch(() => { if (live) { setError(true); setUsage([]); } });
    return () => { live = false; };
  }, [month]);

  const { days, events, peak } = useMemo(() => {
    const n = daysIn(month);
    const asOfDay = Number(DEMO.asOf.slice(-2));
    const days: Day[] = Array.from({ length: n }, (_, i) => ({
      date: iso(month, i + 1), day: i + 1, total: 0, byTeam: {}, projected: i + 1 > asOfDay,
    }));
    for (const u of usage ?? []) {
      const d = days[Number(u.date.slice(-2)) - 1];
      if (!d || d.projected) continue;
      d.byTeam[u.team] = (d.byTeam[u.team] ?? 0) + u.costUsd;
      d.total += u.costUsd;
    }
    const events: { day: number; label: string }[] = [];
    for (const team of TEAMS) {
      const e = snap.estimates.find((x) => x.method === 'trueup' && x.team === team);
      if (!e) continue;
      const ctx = snap.contexts.find((c) => c.team === team);
      const evs = (ctx?.events ?? []).filter((ev) => ev.date <= iso(month, n) && (!ev.until || ev.until >= month + '-01'));
      const rest = days.filter((d) => d.projected);
      const remaining = Math.max(0, e.estimate - e.actualToDate);
      const allocated = allocateRemainingSpend(rest.map((d) => d.date), remaining, evs);
      for (const [index, d] of rest.entries()) {
        const v = allocated[index];
        d.byTeam[team] = (d.byTeam[team] ?? 0) + v;
        d.total += v;
      }
      for (const ev of evs) {
        const day = Number(ev.date.slice(-2));
        if (day > asOfDay) events.push({ day, label: `${TEAM_INFO[team].label} ${ev.multiplier}×` });
      }
    }
    const peak = Math.max(1, ...days.map((d) => d.total));
    return { days, events, peak };
  }, [usage, snap, month]);

  if (error) return <section className="overview-visual chart-panel"><h2>Daily spend</h2><p className="muted">Usage data unavailable. Reload to retry.</p></section>;
  if (!usage) return <section className="overview-visual chart-panel"><span className="sk sk-row" style={{ height: 180 }} /></section>;

  const asOfDay = Number(DEMO.asOf.slice(-2));
  const actual = days.filter((d) => !d.projected).reduce((a, d) => a + d.total, 0);
  const projected = days.filter((d) => d.projected).reduce((a, d) => a + d.total, 0);
  const h = hover !== null ? days[hover] : null;
  const reasons = h?.projected ? snap.contexts.flatMap((ctx) => ctx.events.filter((event) => event.date <= h.date && (!event.until || event.until >= h.date)).map((event) => `${TEAM_INFO[ctx.team].label}: ${event.multiplier}× usage · ${event.note}`)) : [];

  return (
    <section className="overview-visual chart-panel">
      <div className="chart-head">
        <h2>Daily spend</h2>
        <div className="chart-legend">
          <span><i className="lg actual" />Actual {formatUsd(actual)}</span>
          <span><i className="lg proj" />Projected {formatUsd(projected)}</span>
        </div>
      </div>

      <p className="daily-chart-note">Solid: recorded · Hatched: projected · Daily scale up to {formatUsd(peak)}</p>
      <div className="chart" onMouseLeave={() => setHover(null)} style={{ ['--cols' as string]: days.length }}>
        {days.map((d, i) => (
          <div
            key={d.date}
            className={`col ${d.projected ? 'is-proj' : ''} ${hover === i ? 'is-hover' : ''}`}
            tabIndex={0}
            role="img"
            aria-label={`${short(d.date)}: ${formatUsd(d.total)} ${d.projected ? 'projected' : 'recorded'}`}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onMouseEnter={() => setHover(i)}
            style={{ ['--i' as string]: i }}
          >
            <span className="bar" style={{ height: `${(d.total / peak) * 100}%` }} />
          </div>
        ))}

        <div className="today" style={{ left: `calc(${(asOfDay / days.length) * 100}%)` }}>
          <span>As of {short(DEMO.asOf)}</span>
        </div>

        {[...events].sort((a, b) => a.day - b.day).map((ev, i, all) => {
          // Neighbouring pins open away from each other so their labels never overlap.
          const near = (j: number) => all[j] && Math.abs(all[j].day - ev.day) <= 2;
          const side = near(i + 1) ? 'left' : near(i - 1) ? 'right' : '';
          return (
          <div key={ev.label} className={`pin ${side}`} style={{ left: `calc(${((ev.day - 0.5) / days.length) * 100}%)`, ['--d' as string]: `${i * 0.12}s` }}>
            <span>{ev.label}</span>
          </div>
          );
        })}

        {h && (
          <div className="tip" style={{ left: `clamp(85px, ${((hover! + 0.5) / days.length) * 100}%, calc(100% - 85px))` }}>
            <b>{short(h.date)}</b>
            <span className="tip-total">{formatUsd(h.total)}{h.projected && <em>projected</em>}</span>
            {reasons.map((reason) => <span className="tip-reason" key={reason}>{reason}</span>)}
            {TEAMS.filter((t) => (h.byTeam[t] ?? 0) > 0.5).map((t) => (
              <span key={t} className="tip-row"><i className={`dot t-${t}`} />{TEAM_INFO[t].label}<span>{formatUsd(h.byTeam[t] ?? 0)}</span></span>
            ))}
          </div>
        )}
      </div>

      <div className="chart-axis">
        <span>{short(days[0].date)}</span>
        <span>{short(days[days.length - 1].date)}</span>
      </div>
      <p className="daily-chart-footnote">Remaining spend is allocated using confirmed usage windows. Hover or focus a day for its breakdown.</p>
    </section>
  );
}
