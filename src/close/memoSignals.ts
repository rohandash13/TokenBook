// OWNER: C
// Cites team signals in variance memos: what the accrual relied on, and what contradicted it.
import { SOURCE_LABEL } from '../shared/config';
import type { Evidence, MemoInput, TeamContext } from '../shared/types';
import type { Signal } from '../signals/types';

const MAX_PER_KIND = 3;
const SLIP = /\b(pushed|slipp(ed|ing)|moved|delay(ed)?|postponed?|cancel+ed|on hold|paus(e|ed|ing)|not ready)\b/i;
const STOP = new Set(['launch', 'from', 'with', 'this', 'that', 'week', 'month']);

// Source lines are plain strings so they fit MemoInput.sources: `<kind>: <who/when>: "<excerpt>" <url>`.
export type CitedKind = 'evidence' | 'contradicts';

const excerpt = (t: string, n = 110) => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function citeLine(kind: CitedKind, ev: Pick<Evidence, 'source' | 'date' | 'text' | 'url' | 'author'>): string {
  return `${kind}: ${SOURCE_LABEL[ev.source]}, ${shortDate(ev.date)}${ev.author ? `, ${ev.author}` : ''}: "${excerpt(ev.text)}" ${ev.url}`;
}

/** Parses a cited source line back for display; undefined for plain sources like a JE id. */
export function parseCiteLine(line: string): { kind: CitedKind; label: string; text: string; url: string } | undefined {
  const m = /^(evidence|contradicts): (.+?): "(.*)" (\S+)$/.exec(line);
  return m ? { kind: m[1] as CitedKind, label: m[2], text: m[3], url: m[4] } : undefined;
}

/** Words from the driver notes that a related signal should mention ("Fall campaign launch" → fall, campaign). */
function driverWords(ctx?: TeamContext): string[] {
  const words = (ctx?.events ?? []).flatMap((e) => e.note.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return [...new Set(words.filter((w) => !STOP.has(w)))];
}

/**
 * Signals that undercut the booked drivers: a milestone whose due date moved, or a message
 * that says the driver slipped. Only for teams whose accrual used a driver.
 */
export function contradictingSignals(ctx: TeamContext | undefined, signals: Signal[]): Signal[] {
  const words = driverWords(ctx);
  if (!words.length) return [];
  const about = (s: Signal) => words.some((w) => s.text.toLowerCase().includes(w));
  const moved = signals.filter((s) => s.kind === 'milestone' && s.previousDueDate && s.dueDate !== s.previousDueDate && about(s));
  const said = signals.filter((s) => s.kind !== 'milestone' && SLIP.test(s.text) && about(s));
  const newestFirst = (a: Signal, b: Signal) => b.date.localeCompare(a.date);
  return [...moved.sort(newestFirst), ...said.sort(newestFirst)].slice(0, MAX_PER_KIND);
}

/** Adds cited evidence and contradicting signals to each memo's sources. */
export function withSignalContext(
  inputs: MemoInput[],
  contexts: TeamContext[],
  signalsFor: (input: MemoInput) => Signal[],
): MemoInput[] {
  return inputs.map((i) => {
    const ctx = contexts.find((c) => c.team === i.team && c.month === i.month);
    const used = (ctx?.events ?? []).flatMap((e) => e.evidence ?? []).slice(0, MAX_PER_KIND).map((ev) => citeLine('evidence', ev));
    const against = contradictingSignals(ctx, signalsFor(i)).map((s) => citeLine('contradicts', s));
    const add = [...used, ...against].filter((l) => !i.sources.includes(l));
    return add.length ? { ...i, sources: [...i.sources, ...add] } : i;
  });
}
