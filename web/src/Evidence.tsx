// OWNER: C
// Drivers and the evidence behind them, shared by the accrual and signals screens.
import { SOURCE_LABEL } from '../../src/shared/config';
import type { ContextEvent, Evidence } from '../../src/shared/types';

export const trunc = (t: string, n = 90) => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function SourceBadge({ source }: { source: NonNullable<ContextEvent['source']> }) {
  return <span className={`badge src ${source}`}>{SOURCE_LABEL[source]}</span>;
}

export function EvidenceLink({ ev, n = 90 }: { ev: Evidence; n?: number }) {
  return (
    <li>
      <a href={ev.url} target="_blank" rel="noreferrer">{SOURCE_LABEL[ev.source]} · {shortDate(ev.date)}{ev.author ? ` · ${ev.author}` : ''}</a>{' '}
      <span className="excerpt">{trunc(ev.text, n)}</span>
    </li>
  );
}

/** "3× from Oct 27 — support launch" plus its evidence links (up to `max`). */
export function EventLine({ ev, max = 3, n }: { ev: ContextEvent; max?: number; n?: number }) {
  const shown = (ev.evidence ?? []).slice(0, max);
  const more = (ev.evidence?.length ?? 0) - shown.length;
  return (
    <div className="event">
      <SourceBadge source={ev.source ?? 'lead'} />
      <b>{ev.multiplier}×</b> {ev.until === ev.date ? `on ${shortDate(ev.date)} only` : `from ${shortDate(ev.date)}${ev.until ? ` through ${shortDate(ev.until)}` : ''}`} — {ev.note}
      {shown.length > 0 && (
        <ul className="evidence">
          {shown.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}
          {more > 0 && <li className="muted">+{more} more</li>}
        </ul>
      )}
    </div>
  );
}
