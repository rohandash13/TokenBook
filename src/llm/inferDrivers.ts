// OWNER: D
// Infers forecast drivers from Slack/GitHub signals. The LLM may only propose events; every
// proposal passes guardEvent, so no date or multiplier can be booked that is not in its evidence.
import { z } from "zod";
import { KIND_MULTIPLIER } from "../shared/config.js";
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

/** Every multiplier stated in `text` ("3x", "~3x", "3×", "x3", "3 times", triple, double, half), unique, in order found. */
export function parseMultiplier(text: string): number[] {
  const found: { index: number; value: number }[] = [];
  const add = (re: RegExp, value: (m: RegExpExecArray) => number) => {
    for (const m of text.matchAll(re)) found.push({ index: m.index ?? 0, value: value(m as RegExpExecArray) });
  };
  add(new RegExp(String.raw`(?<![\w.])~?${NUM}\s?[x×X](?![\w-])`, "g"), (m) => Number(m[1]));
  add(new RegExp(String.raw`(?<![\w.])[xX]${NUM}(?![\w.])`, "g"), (m) => Number(m[1]));
  add(new RegExp(String.raw`(?<![\w.])${NUM}\s+times\b`, "gi"), (m) => Number(m[1]));
  add(/\btripl(?:e|es|ed|ing)\b/gi, () => 3);
  add(/\b(?:double|doubles|doubled|doubling)\b/gi, () => 2);
  add(/\b(?:half|halve|halves|halved|halving)\b/gi, () => 0.5);
  found.sort((a, b) => a.index - b.index);
  const out: number[] = [];
  for (const f of found) if (Number.isFinite(f.value) && !out.includes(f.value)) out.push(f.value);
  return out;
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
  const year = Number(month.slice(0, 4));
  const dateOk = cited.some((s) => s.dueDate === e.date || datesInText(s.text, year).includes(e.date));
  if (!dateOk) return fail("date not in evidence");
  let multiplier: number;
  if (e.multiplier !== undefined) {
    if (!cited.some((s) => parseMultiplier(s.text).includes(e.multiplier as number))) {
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

function milestoneTitle(s: Signal): string {
  return /Milestone '([^']+)'/.exec(s.text)?.[1] ?? s.text;
}

/** No-LLM rule: in-month milestones with launch-like keywords, plus Slack messages that state a date and a multiplier. */
export function deterministicDrivers(_team: Team, month: Month, signals: Signal[]): ProposedEvent[] {
  const year = Number(month.slice(0, 4));
  const messages = signals.filter((s) => s.source === "slack" && s.kind === "message");
  const out: ProposedEvent[] = [];
  const citedMessages = new Set<string>();

  for (const ms of signals) {
    if (ms.kind !== "milestone" || !ms.dueDate || ms.dueDate.slice(0, 7) !== month) continue;
    const haystack = `${milestoneTitle(ms)} ${ms.text}`;
    const kind = KIND_PATTERNS.find(([, re]) => re.test(haystack))?.[0];
    if (!kind) continue;
    const mentions = messages.filter((m) => datesInText(m.text, year).includes(ms.dueDate as string));
    mentions.forEach((m) => citedMessages.add(m.id));
    const stated = mentions.flatMap((m) => parseMultiplier(m.text))[0];
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
    const stated = parseMultiplier(m.text)[0];
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
    const g = guardEvent(p, month, byId);
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
