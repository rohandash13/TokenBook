// OWNER: C — shared drivers and their source evidence.
import { SOURCE_LABEL } from '../../src/shared/config';
import type { ContextEvent, Evidence, TeamContext } from '../../src/shared/types';
import { EmailEvidence, GmailMark } from './EmailEvidence';
import { GitHubMark, IconExternal, SlackMark } from './icons';
import type { ReactNode } from 'react';

export function EvidenceDisclosure({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return <details className="evidence-disclosure"><summary><span className="disclosure-show">Show {label}</span><span className="disclosure-hide">Hide {label}</span><span className="disclosure-count">{count}</span><span className="disclosure-chevron" aria-hidden="true">⌄</span></summary><div className="disclosure-content">{children}</div></details>;
}

export const trunc = (t: string, n = 160) => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
export const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function SourceMark({ source }: { source: NonNullable<ContextEvent['source']> }) {
  return source === 'slack' ? <SlackMark /> : source === 'github' ? <GitHubMark /> : source === 'gmail' ? <GmailMark /> : null;
}
export function SourceBadge({ source }: { source: NonNullable<ContextEvent['source']> }) {
  return <span className={`badge src ${source}`}><SourceMark source={source} />{SOURCE_LABEL[source]}</span>;
}
export function EvidenceLink({ ev, n = 160 }: { ev: Evidence; n?: number }) {
  if (ev.source === 'gmail') return <EmailEvidence ev={ev} />;
  const author = ev.author?.split('·')[0].trim();
  return (
    <li className="evidence-item">
      <a className="evidence-source" href={ev.url} target="_blank" rel="noreferrer" aria-label={`Open ${SOURCE_LABEL[ev.source]} evidence${author ? ` from ${author}` : ''}, ${shortDate(ev.date)}`}>
        <SourceMark source={ev.source} /><span>{SOURCE_LABEL[ev.source]}</span>
        <span className="evidence-meta"><time dateTime={ev.date}>{shortDate(ev.date)}</time>{author && <> · <span title={ev.author}>{author}</span></>}</span>
        <IconExternal />
      </a>
      <p className="evidence-excerpt" title={ev.text}>{trunc(ev.text.replace('<!-- trueup-seed -->', ''), n)}</p>
    </li>
  );
}
export function EventLine({ ev, max = 2, n, collapsible = false }: { ev: ContextEvent; max?: number; n?: number; collapsible?: boolean }) {
  const evidence = ev.evidence ?? [];
  const sources = [...new Set(evidence.map((e) => e.source))];
  const representative = sources.flatMap((s) => evidence.find((e) => e.source === s) ?? []).slice(0, max);
  const shown = [...representative, ...evidence.filter((e) => !representative.includes(e))].slice(0, max);
  const remaining = evidence.filter((e) => !shown.includes(e));
  return (
    <div className="event">
      <div className="event-heading"><b className="event-multiplier">{ev.multiplier}×</b><span className="event-note">{ev.note}</span></div>
      <div className="event-timing">{ev.until === ev.date ? `${shortDate(ev.date)} only` : `${shortDate(ev.date)}${ev.until ? ` – ${shortDate(ev.until)}` : ' onward'}`}
        <span className="event-sources">{(sources.length ? sources : [ev.source ?? 'lead']).map((source) => <SourceBadge key={source} source={source} />)}</span>
      </div>
      {collapsible ? evidence.length > 0 && <EvidenceDisclosure label="evidence" count={evidence.length}><ul className="evidence">{evidence.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}</ul></EvidenceDisclosure> : <>
        {shown.length > 0 && <ul className="evidence">{shown.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}</ul>}
        {remaining.length > 0 && <details className="more-evidence"><summary>View {remaining.length} more {remaining.length === 1 ? 'source' : 'sources'}</summary><ul className="evidence">{remaining.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}</ul></details>}
      </>}
    </div>
  );
}

/** "2026-10-31" → "Oct 31, 2026" */
export const longDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** An ISO timestamp → "Oct 24, 7:46 PM" in the viewer's time zone. */
export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);


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

const span = (ev: ContextEvent) => ev.until === ev.date ? `${shortDate(ev.date)} only` : ev.until ? `${shortDate(ev.date)} to ${shortDate(ev.until)}` : `from ${shortDate(ev.date)}`;
