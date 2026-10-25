// OWNER: C — shared drivers and their source evidence.
import { SOURCE_LABEL } from '../../src/shared/config';
import type { ContextEvent, Evidence } from '../../src/shared/types';
import { EmailEvidence, GmailMark } from './EmailEvidence';
import { GitHubMark, IconExternal, SlackMark } from './icons';

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
export function EventLine({ ev, max = 2, n }: { ev: ContextEvent; max?: number; n?: number }) {
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
      {shown.length > 0 && <ul className="evidence">{shown.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}</ul>}
      {remaining.length > 0 && <details className="more-evidence"><summary>View {remaining.length} more {remaining.length === 1 ? 'source' : 'sources'}</summary><ul className="evidence">{remaining.map((e) => <EvidenceLink key={e.id} ev={e} n={n} />)}</ul></details>}
    </div>
  );
}
