// OWNER: C
// Drivers and the evidence behind them, shared by the accrual and signals screens.
import { SOURCE_LABEL } from '../../src/shared/config';
import type { ContextEvent, Evidence, TeamContext } from '../../src/shared/types';

export const trunc = (t: string, n = 90) => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

/** "2026-10-27" → "Oct 27" */
export const shortDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "2026-10-31" → "Oct 31, 2026" */
export const longDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** An ISO timestamp → "Oct 24, 7:46 PM" in the viewer's time zone. */
export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** "from Oct 27", "Oct 27 only" or "Oct 27 to Oct 30" */
const span = (ev: ContextEvent) =>
  ev.until === ev.date ? `${shortDate(ev.date)} only` : ev.until ? `${shortDate(ev.date)} to ${shortDate(ev.until)}` : `from ${shortDate(ev.date)}`;

/** "3× Support agent v2 launch, from Oct 27" plus its evidence links (up to `max`). */
export function EventLine({ ev, max = 3, n }: { ev: ContextEvent; max?: number; n?: number }) {
  const shown = (ev.evidence ?? []).slice(0, max);
  const more = (ev.evidence?.length ?? 0) - shown.length;
  return (
    <div className="event">
      <SourceBadge source={ev.source ?? 'lead'} />
      <b>{ev.multiplier}×</b> {ev.note}, {span(ev)}
      {shown.length > 0 && (
        <ul className="evidence">
          {shown.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}
          {more > 0 && <li className="muted">{more} more</li>}
        </ul>
      )}
    </div>
  );
}

/** Where a team's drivers came from: "Lead" for a reply, else the evidence sources ("GitHub, Slack"). */
export function sourcesOf(ctx: TeamContext | undefined, events: ContextEvent[]): string[] {
  if (ctx?.replied) return [SOURCE_LABEL.lead];
  const srcs = events.flatMap((ev) => ev.evidence?.map((x) => x.source) ?? (ev.source ? [ev.source] : []));
  return [...new Set(srcs)].map((s) => SOURCE_LABEL[s]);
}

/** One line for a table cell: what moves the estimate and on whose word. */
export function driverSummary(ctx: TeamContext | undefined, asOf: string): { text: string; sources: string[]; review: number } {
  const events = (ctx?.events ?? []).filter((ev) => ev.date >= asOf);
  const review = ctx?.flags?.length ?? 0;
  const sources = sourcesOf(ctx, events);
  if (events.length) return { text: events.map((ev) => `${ev.multiplier}× ${ev.note}, ${span(ev)}`).join('; '), sources, review };
  if (ctx?.replied) return { text: 'Lead expects no change', sources, review };
  if (ctx?.inferred) return { text: 'No change found in signals', sources: [], review };
  return { text: 'Signals not checked yet', sources: [], review };
}
