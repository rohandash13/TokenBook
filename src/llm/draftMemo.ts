// OWNER: D
// Drafts an audit memo from MemoInput. Every number comes from the input;
// a draft containing any other number is thrown away for the template.
import type { Memo, MemoInput } from "../shared/types.js";
import { getLlm, type LlmClient } from "./client.js";

const SYSTEM = [
  "You are a senior accountant writing a variance memo for the monthly close of AI API spend.",
  "Write a plain-text, auditor-ready memo of roughly 120-200 words. No markdown headings, no JSON.",
  "Cover: the estimate, the actual, the variance in dollars and percent, the drivers used for the estimate (from the basis),",
  "the team lead's quote (with its timestamp if one is given), who approved the accrual, the sources, and what changes next month.",
  "STRICT RULE ON NUMBERS: use only the numbers given in the input, written exactly as given (money may be rounded to whole dollars).",
  "Do not introduce any other number. Do not compute new numbers (no sums, ratios, averages, daily rates, or projections).",
  "Do not add dates, counts, or list numbering that are not in the input. Describe next month's change in words only.",
].join(" ");

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
// variancePct is a fraction, (estimate − actual) / actual (see accrualErrorPct in src/shared/config.ts).
const pct = (fraction: number) => `${Math.abs(fraction * 100).toFixed(1)}%`;
const direction = (input: MemoInput) =>
  input.estimate > input.actual ? "over-accrued" : input.estimate < input.actual ? "under-accrued" : "on target";

function buildUser(input: MemoInput): string {
  const varianceUsd = input.estimate - input.actual;
  return [
    `Team: ${input.team}`,
    `Month: ${input.month}`,
    `Estimate (accrued): ${money(input.estimate)}`,
    `Actual: ${money(input.actual)}`,
    `Variance: ${money(varianceUsd)} ${direction(input)} (accrual ${varianceUsd >= 0 ? "above" : "below"} actual)`,
    `Variance percent of actual: ${pct(input.variancePct)}`,
    `Basis / drivers used: ${input.basis}`,
    `Lead's quote: ${input.quote ?? "(no reply from the lead)"}`,
    `Approved by: ${input.approvedBy}`,
    `Sources:\n${input.sources.map((s) => `- ${s}`).join("\n")}`,
    "",
    "These are the only numbers you may use. Write the memo now.",
  ].join("\n");
}

/** Every numeric token in a string, as absolute values ("$10,040" → 10040, "-12.4%" → 12.4). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Numbers a memo for this input may contain (absolute values). */
export function allowedNumbers(input: MemoInput): number[] {
  const v = input.estimate - input.actual;
  const p = input.variancePct * 100; // shown as a percent
  const base = [input.estimate, input.actual, v, p, ...[0, 1, 2].map((d) => Number(p.toFixed(d)))];
  const fromText = [input.basis, input.quote ?? "", input.month, input.team, input.approvedBy, ...input.sources].flatMap(
    numbersIn,
  );
  return [...base, ...fromText].map(Math.abs);
}

/** True when every number in `text` matches an allowed number (within rounding tolerance). */
export function numbersAllowed(text: string, input: MemoInput): boolean {
  const allowed = allowedNumbers(input);
  return numbersIn(text).every((n) => {
    // A whole number may be a value rounded to whole dollars; a decimal may be rounded to one decimal.
    const tol = Number.isInteger(n) ? 0.5 : 0.05;
    return allowed.some((a) => Math.abs(n - a) <= tol + 1e-9);
  });
}

export async function draftMemo(
  input: MemoInput,
  llm: LlmClient | null = getLlm(),
  now: () => string = () => new Date().toISOString(),
): Promise<Memo> {
  let text = placeholderMemo(input);
  if (llm) {
    const user = buildUser(input);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const draft = (await llm.complete(SYSTEM, user)).trim();
        if (draft && numbersAllowed(draft, input)) {
          text = draft;
          break;
        }
      } catch {
        // fall through to the retry, then the placeholder
      }
    }
  }
  return { ...input, text, createdAt: now() };
}

/** Deterministic memo used when the LLM is unavailable or its draft fails the number check. */
export function placeholderMemo(input: MemoInput): string {
  const v = input.estimate - input.actual;
  const dir = direction(input);
  const lines = [
    `Variance memo: ${input.team}, ${input.month}`,
    "",
    `Estimate (accrued): ${money(input.estimate)}`,
    `Actual: ${money(input.actual)}`,
    `Variance: ${money(v)} ${dir} (${pct(input.variancePct)} of actual)`,
    "",
    `Drivers used: ${input.basis}`,
    input.quote ? `Lead's reply: "${input.quote}"` : "Lead's reply: none received; the estimate used usage data only.",
    `Approved by: ${input.approvedBy}`,
    "",
    "Sources:",
    ...input.sources.map((s) => `- ${s}`),
    "",
    `Next month: review this ${dir === "on target" ? "result" : dir.replace("-accrued", "-accrual")} with the team lead and adjust the estimate drivers for any known changes before the next close.`,
  ];
  return lines.join("\n");
}
