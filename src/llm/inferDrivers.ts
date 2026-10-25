// OWNER: D
// Infers forecast drivers from Slack/GitHub signals. The LLM may only propose events; every
// proposal passes guardEvent, so no date or multiplier can be booked that is not in its evidence.
import { z } from "zod";
import { KIND_MULTIPLIER, TEAM_KEYWORDS } from "../shared/config.js";
import { asOfForMonth } from "../slack/asOf.js";
import { mentionsTeam } from "../signals/slack.js";
import type { ContextEvent, Evidence, Month, Team } from "../shared/types.js";
import type { EventKind, Signal } from "../signals/types.js";
import { completeJson, getLlm, type LlmClient } from "./client.js";
import { isDateInMonth } from "./extractDrivers.js";

export type ProposedEvent = {
  kind: EventKind;
  date: string;
  multiplier?: number;
  note: string;
  evidenceIds: string[];
};
export type InferResult = {
  events: ContextEvent[];
  dropped: { reason: string; event: unknown }[];
  usedLlm: boolean;
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;

const VOLUME_WORDS = new Set(["traffic", "volume", "usage", "load", "requests", "calls", "spend"]);
const TIMES_NEXT = new Set([...VOLUME_WORDS, "the"]);
const TRIGGERS: Record<string, number> = { triple: 3, tripling: 3, double: 2, doubling: 2, halve: 0.5, half: 0.5 };

type Found = { index: number; end: number; value: number };

function findMultipliers(text: string): Found[] {
  const found: Found[] = [];
  const pre = String.raw`(?<![\d/.\p{L}])`;
  for (const m of text.matchAll(new RegExp(String.raw`~?${pre}${NUM}[x×X](?![\p{L}\d])`, "gu"))) {
    found.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, value: Number(m[1]) });
  }
  for (const m of text.matchAll(new RegExp(String.raw`${pre}${NUM}\s+times\s+(\p{L}+)`, "giu"))) {
    // The span ends after "times" so the following word ("the", "traffic") counts as context.
    if (TIMES_NEXT.has(m[2].toLowerCase())) {
      const index = m.index ?? 0;
      found.push({ index, end: index + m[0].length - m[2].length - 1, value: Number(m[1]) });
    }
  }
  const words = [...text.matchAll(/\p{L}+/gu)].map((m) => ({ w: m[0].toLowerCase(), index: m.index ?? 0 }));
  words.forEach((t, i) => {
    const value = Object.hasOwn(TRIGGERS, t.w) ? TRIGGERS[t.w] : undefined;
    if (value === undefined) return;
    for (let j = Math.max(0, i - 3); j <= Math.min(words.length - 1, i + 3); j++) {
      if (j !== i && VOLUME_WORDS.has(words[j].w)) {
        found.push({ index: t.index, end: t.index + t.w.length, value });
        return;
      }
    }
  });
  found.sort((x, y) => x.index - y.index);
  return found;
}

const unique = (fs: Found[]): number[] => {
  const out: number[] = [];
  for (const f of fs) if (Number.isFinite(f.value) && !out.includes(f.value)) out.push(f.value);
  return out;
};

/**
 * Every multiplier stated in `text`, unique, in order found. Deliberately narrow: "3x" / "~3x" / "3.5x" / "3×"
 * (no space, not part of "2x4", "10/3x", "3xl"), "N times" + traffic-like word or "the", and
 * triple/double/halve/half only within 3 words of a volume word.
 */
export function parseMultiplier(text: string): number[] {
  return unique(findMultipliers(text));
}

const API_VOLUME_WORDS = new Set([...VOLUME_WORDS, "tokens", "api"]);
const NON_VOLUME_WORDS = new Set([
  "faster", "slower", "latency", "p95", "p99", "backlog", "tickets", "examples", "docs", "coffee",
  "smaller", "cheaper", "accuracy", "quality",
]);

/**
 * Like parseMultiplier, but only multipliers about API volume: a volume word within 4 words after or 3 words
 * before, and no non-volume word (faster, latency, backlog, ...) within 3 words either side.
 */
export function volumeMultipliers(text: string): number[] {
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: m[0].toLowerCase(), index: m.index ?? 0 }));
  const kept = findMultipliers(text).filter((f) => {
    const before = words.filter((x) => x.index + x.w.length <= f.index).slice(-3);
    const after = words.filter((x) => x.index >= f.end).slice(0, 4);
    if (![...before, ...after].some((x) => API_VOLUME_WORDS.has(x.w))) return false;
    return ![...before, ...after.slice(0, 3)].some((x) => NON_VOLUME_WORDS.has(x.w));
  });
  return unique(kept);
}

const MONTH_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Every date written in `text` ("Oct 27", "October 27", "10/27", "2026-10-27") as YYYY-MM-DD, using `year` when absent. */
export function datesInText(text: string, year: number): string[] {
  const found: { index: number; iso: string }[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const iso = validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.push({ index: m.index ?? 0, iso });
  }
  const names = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)/gi;
  for (const m of text.matchAll(names)) {
    const mo = MONTH_PREFIXES.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const iso = validYmd(year, mo, Number(m[2]));
    if (iso) found.push({ index: m.index ?? 0, iso });
  }
  for (const m of text.matchAll(/(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    const iso = validYmd(year, Number(m[1]), Number(m[2]));
    if (iso) found.push({ index: m.index ?? 0, iso });
  }
  found.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const f of found) if (!out.includes(f.iso)) out.push(f.iso);
  return out;
}

export function guardEvent(
  e: ProposedEvent,
  month: Month,
  byId: Map<string, Signal>,
  asOf?: string,
): { ok: true; event: ContextEvent } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  const ids = Array.isArray(e.evidenceIds) ? e.evidenceIds : [];
  if (ids.length === 0) return fail("uncited");
  const cited: Signal[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) return fail("unknown evidence id");
    if (!cited.includes(s)) cited.push(s);
  }
  if (typeof e.date !== "string" || !isDateInMonth(e.date, month)) return fail("date outside month");
  // Checked before the date-in-evidence rule so a slipped milestone is reported as such.
  if (cited.some((s) => s.kind === "milestone" && s.dueDate && s.dueDate.slice(0, 7) !== month)) {
    return fail("milestone moved out of month");
  }
  // Any milestone in the input (cited or not) that moved this date to a different one supersedes it.
  for (const s of byId.values()) {
    if (s.kind === "milestone" && s.previousDueDate === e.date && s.dueDate !== e.date) {
      return fail("date superseded by milestone");
    }
  }
  if (asOf !== undefined && e.date < asOf) return fail("date before as-of (already in actuals)");
  const year = Number(month.slice(0, 4));
  // A cited milestone's only acceptable date is its dueDate; its text may mention old dates.
  const dateOk = cited.some((s) =>
    s.kind === "milestone" ? s.dueDate === e.date : s.dueDate === e.date || datesInText(s.text, year).includes(e.date),
  );
  if (!dateOk) return fail("date not in evidence");
  let multiplier: number;
  if (e.multiplier !== undefined) {
    if (!cited.some((s) => volumeMultipliers(s.text).includes(e.multiplier as number))) {
      return fail("multiplier not in evidence");
    }
    multiplier = e.multiplier;
  } else {
    multiplier = KIND_MULTIPLIER[e.kind];
    if (multiplier === undefined) return fail("unknown kind");
  }
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) return fail("multiplier out of range");
  const note = typeof e.note === "string" ? e.note.trim() : "";
  if (note.length < 1 || note.length > 40) return fail("bad note");
  const evidence: Evidence[] = cited.map((s) => ({
    source: s.source,
    id: s.id,
    url: s.url,
    text: s.text.slice(0, 200),
    date: s.date,
    author: s.author,
  }));
  return { ok: true, event: { date: e.date, multiplier, note, source: cited[0].source, evidence } };
}

const KIND_PATTERNS: [EventKind, RegExp][] = [
  ["launch", /launch|release|ship/i],
  ["campaign", /campaign|promo/i],
  ["load_test", /load test|backfill|reindex/i],
  ["deprecation", /deprecat|sunset/i],
];
const KIND_WORD: Record<EventKind, string> = {
  launch: "launch",
  campaign: "campaign",
  load_test: "load test",
  deprecation: "deprecation",
};

/** Hypothetical, cancelled or non-production wording: such a message never becomes a message-only event. */
const NEGATIVE_CUES =
  /\b(?:if|could|might|maybe|worst case|cancel|cancelled|canceled|dropped|drop|will not|won't|not ship|not shipping|scrapped|shelved|on hold|descoped|pulled|reverted|postponed|not ours|their traffic|staging|no prod|ci only|test fixture|simulate)\b/i;
const OTHER_TEAMS = Object.keys(TEAM_KEYWORDS) as Team[];
/** A message counts for `team` only if it is not hypothetical/cancelled and mentions no other team's keywords. */
const countsForTeam = (team: Team, text: string): boolean =>
  !NEGATIVE_CUES.test(text) && !OTHER_TEAMS.some((t) => t !== team && mentionsTeam(t, text));
const DEAD_MILESTONE = /\(closed\)|cancel/i;

function milestoneTitle(s: Signal): string {
  return /Milestone '([^']+)'/.exec(s.text)?.[1] ?? s.text;
}

/** No-LLM rule: in-month milestones with launch-like keywords, plus Slack messages that state a date and a multiplier. */
export function deterministicDrivers(team: Team, month: Month, signals: Signal[]): ProposedEvent[] {
  const year = Number(month.slice(0, 4));
  const messages = signals.filter((s) => s.source === "slack" && s.kind === "message" && countsForTeam(team, s.text));
  const out: ProposedEvent[] = [];
  const citedMessages = new Set<string>();

  for (const ms of signals) {
    if (ms.kind !== "milestone" || !ms.dueDate || ms.dueDate.slice(0, 7) !== month) continue;
    const haystack = `${milestoneTitle(ms)} ${ms.text}`;
    if (DEAD_MILESTONE.test(haystack)) continue;
    const kind = KIND_PATTERNS.find(([, re]) => re.test(haystack))?.[0];
    if (!kind) continue;
    const mentions = messages.filter((m) => datesInText(m.text, year).includes(ms.dueDate as string));
    mentions.forEach((m) => citedMessages.add(m.id));
    const stated = mentions.flatMap((m) => volumeMultipliers(m.text))[0];
    const first = milestoneTitle(ms).trim().split(/\s+/)[0].toLowerCase();
    const note = `${first} ${KIND_WORD[kind]}`.slice(0, 40);
    out.push({
      kind,
      date: ms.dueDate,
      ...(stated !== undefined ? { multiplier: stated } : {}),
      note,
      evidenceIds: [ms.id, ...mentions.map((m) => m.id)],
    });
  }

  for (const m of messages) {
    if (citedMessages.has(m.id)) continue;
    if (!/launch|campaign|promo|release|ship/i.test(m.text)) continue;
    const date = datesInText(m.text, year).find((d) => d.slice(0, 7) === month);
    const stated = volumeMultipliers(m.text)[0];
    if (!date || stated === undefined) continue;
    const kind: EventKind = /campaign|promo/i.test(m.text) ? "campaign" : "launch";
    out.push({ kind, date, multiplier: stated, note: `planned ${KIND_WORD[kind]}`, evidenceIds: [m.id] });
  }
  return out;
}

const proposalSchema = z.object({
  events: z.array(
    z.object({
      kind: z.enum(["launch", "campaign", "load_test", "deprecation"]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      multiplier: z.number().positive().optional(),
      note: z.string(),
      evidenceIds: z.array(z.string()).min(1),
    }),
  ),
});

function systemPrompt(): string {
  return [
    "You infer forecast drivers for AI API spend for one team and one month from evidence (Slack messages and GitHub items).",
    'Return ONLY JSON of this shape: {"events":[{"kind":"launch|campaign|load_test|deprecation","date":"YYYY-MM-DD","multiplier":number,"note":string,"evidenceIds":[string]}]}.',
    "Include only events that change API volume in the given month, on the date the change starts.",
    "Cite the ids of the evidence items that support each event in evidenceIds.",
    "Set multiplier ONLY if a cited item states it (for example '~3x'); otherwise omit the field.",
    "If a milestone or plan was moved out of the month, produce no event for it.",
    "Ignore multipliers about speed, latency, backlog or docs; only API volume multipliers count.",
    "Ignore hypotheticals, cancelled or reverted plans, staging/CI/test-only work, and other companies' traffic.",
    "Ignore events dated before the as-of date (already in actuals).",
    "note is 2-5 lowercase words.",
    'If nothing changes API volume, return {"events":[]}.',
  ].join("\n");
}

function userPrompt(team: Team, month: Month, signals: Signal[]): string {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  return [
    `Team: ${team}`,
    `Month: ${month}`,
    "Evidence, one per line: id | date | source/kind | dueDate | previousDueDate | text",
    ...signals.map(
      (s) => `${s.id} | ${s.date} | ${s.source}/${s.kind} | ${s.dueDate ?? "-"} | ${s.previousDueDate ?? "-"} | ${clean(s.text)}`,
    ),
  ].join("\n");
}

export async function inferDrivers(
  team: Team,
  month: Month,
  signals: Signal[],
  llm: LlmClient | null = getLlm(),
  asOf: string = asOfForMonth(month, new Date().toISOString().slice(0, 10)),
): Promise<InferResult> {
  if (signals.length === 0) return { events: [], dropped: [], usedLlm: false };
  const result = await completeJson(llm, systemPrompt(), userPrompt(team, month, signals), proposalSchema);
  const usedLlm = result !== null;
  const proposals: ProposedEvent[] = result ? result.events : deterministicDrivers(team, month, signals);
  const byId = new Map(signals.map((s) => [s.id, s]));
  const events: ContextEvent[] = [];
  const dropped: InferResult["dropped"] = [];
  const seen = new Set<string>();
  for (const p of proposals) {
    const g = guardEvent(p, month, byId, asOf);
    if (!g.ok) {
      dropped.push({ reason: g.reason, event: p });
      continue;
    }
    const key = `${g.event.date}|${g.event.multiplier}|${g.event.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(g.event);
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return { events, dropped, usedLlm };
}
