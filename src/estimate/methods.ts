// OWNER: A
// The three estimate methods. Pure functions: data in, Estimate out. No LLM, no I/O.
import { SOURCE_LABEL } from "../shared/config.js";
import type { Actual, Estimate, Evidence, Team, TeamContext, UsageDay } from "../shared/types.js";
import { addDays, daysInMonth, monthOf, prevMonth, remainingDates, shortDate, shortMonth } from "./dates.js";

const RECENT_DAYS = 7;
const MAX_CITED = 2; // evidence items quoted in a basis; the UI links the rest
const FALLBACK_MONTHS = 3;

export const round2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

function costOn(team: Team, usage: UsageDay[], date: string): number {
  return usage.filter((u) => u.team === team && u.date === date).reduce((s, u) => s + u.costUsd, 0);
}

/** Spend from the 1st of asOf's month through asOf, inclusive. */
export function actualToDate(team: Team, usage: UsageDay[], asOf: string): number {
  const month = monthOf(asOf);
  return usage
    .filter((u) => u.team === team && monthOf(u.date) === month && u.date <= asOf)
    .reduce((s, u) => s + u.costUsd, 0);
}

/**
 * Weighted daily cost over the last 7 days ending asOf. The newest day weighs 7,
 * the oldest 1. Days before the first date in the data are skipped (not counted as $0).
 */
export function recentDailyRate(team: Team, usage: UsageDay[], asOf: string): number {
  const firstDate = usage.reduce((min, u) => (u.date < min ? u.date : min), asOf);
  let weighted = 0;
  let weights = 0;
  for (let i = 0; i < RECENT_DAYS; i++) {
    const date = addDays(asOf, -i);
    if (date < firstDate) break;
    const w = RECENT_DAYS - i;
    weighted += w * costOn(team, usage, date);
    weights += w;
  }
  return weights ? weighted / weights : 0;
}

/** Average daily cost over up to 3 prior months of actuals, or undefined with no history. */
export function trailingDailyAverage(team: Team, month: string, history: Actual[]) {
  const found = [];
  for (let n = 1; n <= FALLBACK_MONTHS; n++) {
    const m = prevMonth(month, n);
    const a = history.find((h) => h.team === team && h.month === m);
    if (a) found.push(a);
  }
  if (!found.length) return undefined;
  const total = found.reduce((s, a) => s + a.actualUsd, 0);
  const dayCount = found.reduce((s, a) => s + daysInMonth(a.month), 0);
  const months = found.map((a) => a.month).sort();
  const label = months.length === 1 ? shortMonth(months[0]) : `${shortMonth(months[0])}–${shortMonth(months[months.length - 1])}`;
  return { rate: total / dayCount, label };
}

function base(team: Team, asOf: string, method: Estimate["method"], toDate: number) {
  return { team, month: monthOf(asOf), asOf, method, actualToDate: round2(toDate) };
}

/** The reply's calendar day in Pacific time ("Oct 24"); the server stamps replies in UTC. */
function repliedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return shortDate(iso.slice(0, 10));
  return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

/** `GitHub, Oct 24, nikhil: "Milestone 'Support agent v2 launch' due…"` */
function citation(ev: Evidence): string {
  const text = ev.text.replace(/\s+/g, " ").trim();
  const short = text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
  return `${SOURCE_LABEL[ev.source]}, ${shortDate(ev.date)}${ev.author ? `, ${ev.author}` : ""}: "${short}"`;
}

function toDateText(toDate: number, asOf: string) {
  return `${usd(toDate)} through ${shortDate(asOf)}`;
}

/** Last month's actual, carried forward unchanged. */
export function lastMonth(team: Team, usage: UsageDay[], asOf: string, history: Actual[]): Estimate {
  const toDate = actualToDate(team, usage, asOf);
  const prev = prevMonth(monthOf(asOf));
  const last = history.find((h) => h.team === team && h.month === prev);
  if (!last) {
    return {
      ...base(team, asOf, "lastmonth", toDate),
      estimate: round2(toDate),
      confidence: "low",
      basis: `No ${shortMonth(prev)} actual on file; showing ${toDateText(toDate, asOf)} only.`,
    };
  }
  return {
    ...base(team, asOf, "lastmonth", toDate),
    estimate: round2(last.actualUsd),
    confidence: "low",
    basis: `${shortMonth(prev)} actual of ${usd(last.actualUsd)}, carried forward unchanged.`,
  };
}

/** actualToDate + remainingDays × recent weighted daily rate. */
export function runRate(team: Team, usage: UsageDay[], asOf: string): Estimate {
  const toDate = actualToDate(team, usage, asOf);
  const rate = recentDailyRate(team, usage, asOf);
  const left = remainingDates(asOf).length;
  return {
    ...base(team, asOf, "runrate", toDate),
    estimate: round2(toDate + left * rate),
    confidence: "medium",
    basis: left
      ? `${toDateText(toDate, asOf)} + ${days(left)} at ${usd(rate)}/day (7-day weighted rate).`
      : `${toDateText(toDate, asOf)}; month complete.`,
  };
}

/**
 * Run-rate adjusted by the lead's reply. Each remaining day costs rate × the product
 * of all events in effect that day. An event dated asOf ("from today") starts the next
 * day; one dated before asOf is already in the actuals and is ignored, since events have
 * no end date (a reindex Jun 15–19 must not inflate Jun 26–30). With no reply, remaining days use the trailing 3-month
 * average daily cost and confidence is low.
 */
export function trueUp(
  team: Team,
  usage: UsageDay[],
  context: TeamContext | undefined,
  asOf: string,
  history: Actual[],
): Estimate {
  const toDate = actualToDate(team, usage, asOf);
  const rate = recentDailyRate(team, usage, asOf);
  const dates = remainingDates(asOf);
  const head = base(team, asOf, "trueup", toDate);

  // Drivers inferred from Slack/GitHub/Jira signals count at medium confidence (docs/plan-signals.md).
  // A team whose signals were checked and showed no upcoming change gets the run-rate at medium too:
  // "checked, nothing found" is more than no information, but less than a lead's word.
  const inferred = !context?.replied && !!context?.inferred;
  if (!context?.replied && !inferred) {
    const avg = trailingDailyAverage(team, head.month, history);
    if (!avg) {
      return {
        ...head,
        estimate: round2(toDate + dates.length * rate),
        confidence: "low",
        basis: `No signals collected and no prior history, so this is the run-rate: ${toDateText(toDate, asOf)} + ${days(dates.length)} at ${usd(rate)}/day.`,
      };
    }
    return {
      ...head,
      estimate: round2(toDate + dates.length * avg.rate),
      confidence: "low",
      basis: `No signals collected yet. ${toDateText(toDate, asOf)} + ${days(dates.length)} at ${usd(avg.rate)}/day (${avg.label} average).`,
    };
  }

  const firstLeft = dates[0];
  const past = context!.events.filter((e) => e.date < asOf);
  const events = context!.events
    .filter((e) => e.date >= asOf)
    .map((e) => ({ ...e, from: firstLeft && e.date < firstLeft ? firstLeft : e.date }));
  const multiplierOn = (date: string) => events.filter((e) => e.from <= date).reduce((m, e) => m * e.multiplier, 1);

  // Group consecutive days with the same multiplier: "1 day at $245/day + 5 days at $735/day".
  const segments: { mult: number; count: number }[] = [];
  for (const d of dates) {
    const mult = multiplierOn(d);
    const last = segments[segments.length - 1];
    if (last && last.mult === mult) last.count++;
    else segments.push({ mult, count: 1 });
  }
  const remaining = segments.reduce((s, seg) => s + seg.count * rate * seg.mult, 0);

  const parts = [dates.length ? `${toDateText(toDate, asOf)} + ${segments.map((s) => `${days(s.count)} at ${usd(rate * s.mult)}/day`).join(" + ")}.` : `${toDateText(toDate, asOf)}; month complete.`];
  const applied = events.filter((e) => firstLeft && e.from <= dates[dates.length - 1]);
  if (applied.length) parts.push(`Drivers: ${applied.map((e) => `${e.multiplier}× from ${shortDate(e.from)} (${e.note})`).join("; ")}.`);
  else if (dates.length) parts.push(`No changes expected; ${usd(rate)}/day is the 7-day weighted rate.`);
  if (past.length) parts.push(`Already in actuals: ${past.map((e) => `${e.note} (${shortDate(e.date)})`).join("; ")}.`);
  if (inferred) {
    const cited = applied.flatMap((e) => e.evidence ?? []).slice(0, MAX_CITED);
    if (cited.length) parts.push(`Evidence: ${cited.map(citation).join("; ")}.`);
    else if (applied.length) parts.push("Inferred from team signals.");
    else parts.push("Signals checked: no upcoming changes found.");
    return { ...head, estimate: round2(toDate + remaining), confidence: "medium", basis: parts.join(" ") };
  }
  const who = context!.leadName ?? "lead";
  const when = context!.repliedAt ? `, replied ${repliedDate(context!.repliedAt)}` : "";
  parts.push(context!.quote ? `Per ${who}${when}: "${context!.quote}"` : `Per ${who}${when}.`);

  return { ...head, estimate: round2(toDate + remaining), confidence: "high", basis: parts.join(" ") };
}
