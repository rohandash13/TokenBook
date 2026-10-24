import type { Origin, Page, PageHit, PaymentField, PaymentRequest, Plan, PlanItem, Task } from "@countersign/shared";
import { categoryFor, type CatalogEntry } from "./catalog";
import type { QuoteInfo } from "./executor";
import {
  amountsEqual,
  lineHasTier,
  normalizeCategory,
  normalizeDomain,
  normalizeTier,
  textHasDomain,
  textHasMoney,
  textHasNumber,
  textHasQuantity,
  textHasWords,
  tokenize,
} from "./normalize";

/** Spec §7: rule-based, no LLM. PAYMENT_FIELDS and isTainted live in @countersign/shared (D26). */
export { PAYMENT_FIELDS, isTainted } from "@countersign/shared";
export const MAX_EVIDENCE_TEXT = 200;

export interface TraceInput {
  task: Task;
  plan: Plan;
  pages: Page[];
  quote: QuoteInfo;
  req: PaymentRequest;
  catalog: CatalogEntry[];
}

/** On a mismatch the origin describes the requested value; amountUsd remains the quote-charged amount. */
export interface TraceResult {
  origins: Record<PaymentField, Origin>;
  evidence: Partial<Record<PaymentField, PageHit[]>>;
  payee: string;
  amountUsd: number;
  tier: string | null;
  quantity: number;
  category: string | null;
  matchedItem: PlanItem | null;
  candidateItems: PlanItem[];
}

export const MAX_EVIDENCE_HITS = 20;

export function matchPlanItem(plan: Plan, category: string | null): PlanItem | null {
  if (category === null) return null;
  return plan.expected.find((item) => normalizeCategory(item.category) === category) ?? null;
}

// A char that can be part of a token (word, number, host); everything else separates tokens.
const TOKEN_CHAR = /[\p{L}\p{N}._:,@$-]/u;

/** [start, end) of the first match in `line`, found by binary search over token boundaries. Display only. */
function firstMatch(line: string, test: (s: string) => boolean): [number, number] {
  const isEnd = (i: number) => i === line.length || !TOKEN_CHAR.test(line[i]);
  const isStart = (i: number) => i === 0 || !TOKEN_CHAR.test(line[i - 1]);
  const ends: number[] = [];
  const starts: number[] = [];
  for (let i = 0; i <= line.length; i++) {
    if (i > 0 && isEnd(i)) ends.push(i);
    if (i < line.length && isStart(i)) starts.push(i);
  }
  let lo = 0;
  let hi = ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (test(line.slice(0, ends[mid]))) hi = mid;
    else lo = mid + 1;
  }
  const end = ends[lo] ?? line.length;
  const cands = starts.filter((i) => i < end);
  let a = 0;
  let b = cands.length - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (test(line.slice(cands[mid], end))) a = mid;
    else b = mid - 1;
  }
  return [cands[a] ?? 0, end];
}

/** The trimmed line, or for a long line a MAX_EVIDENCE_TEXT window around the first match. */
function evidenceText(raw: string, test: (s: string) => boolean): string {
  const line = raw.trim();
  if (line.length <= MAX_EVIDENCE_TEXT) return line;
  const [mStart, mEnd] = firstMatch(line, test);
  const pad = Math.max(0, Math.floor((MAX_EVIDENCE_TEXT - (mEnd - mStart)) / 2));
  let from = Math.max(0, mStart - pad);
  const to = Math.min(line.length, from + MAX_EVIDENCE_TEXT);
  from = Math.max(0, to - MAX_EVIDENCE_TEXT);
  return line.slice(from, to);
}

/** Up to MAX_EVIDENCE_HITS matching lines, in page order then line order. */
function pageHits(pages: Page[], test: (line: string) => boolean): PageHit[] {
  const hits: PageHit[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      if (hits.length >= MAX_EVIDENCE_HITS) return hits;
      const line = page.lines[i];
      if (test(line)) hits.push({ pageId: page.pageId, url: page.url, line: i + 1, text: evidenceText(line, test) });
    }
  }
  return hits;
}

const NEGATIONS = new Set(["not", "no", "dont", "don", "t", "avoid", "never", "without"]);
const SKIPPED_BEFORE = new Set(["the", "a", "an", "this", "that", "any", "to"]);

/** A negation within the 2 tokens before index `start` (articles are skipped: "do not use the premium tier"). */
function negatedBefore(have: string[], start: number): boolean {
  let seen = 0;
  for (let k = start - 1; k >= 0 && seen < 2; k--) {
    if (SKIPPED_BEFORE.has(have[k])) continue;
    if (NEGATIONS.has(have[k])) return true;
    seen++;
  }
  return false;
}

/**
 * The task names the tier explicitly: "premium tier", "tier premium", "basic plan" ("plan" only AFTER the name).
 * A bare word is not enough, and a negation just before the mention ("do not use the premium tier") cancels it.
 */
function taskNamesTier(text: string, tier: string): boolean {
  const want = tier.split(" ").filter(Boolean);
  const have = tokenize(text);
  // "follow the plan": a function word is never a tier name
  if (want.length === 0 || want.every((w) => SKIPPED_BEFORE.has(w) || w === "tier" || w === "plan")) return false;
  for (let i = 0; i + want.length <= have.length; i++) {
    if (!want.every((w, j) => have[i + j] === w)) continue;
    const tierBefore = have[i - 1] === "tier";
    const contextAfter = have[i + want.length] === "tier" || have[i + want.length] === "plan";
    if (!tierBefore && !contextAfter) continue;
    if (negatedBefore(have, tierBefore ? i - 1 : i)) continue;
    return true;
  }
  return false;
}

// "$20 budget", "budget $20", "budget of $20", "budget: $20", "budget is $20" set a limit, not a price.
const BUDGET_PHRASE_RE = /\bbudget\s*(?:of|is|:|=)?\s*\$\s*[\d.,]+|\$\s*[\d.,]+\s*(?:total\s+)?budget\b/giu;

export function traceFields(input: TraceInput): TraceResult {
  const { task, plan, quote, req, catalog } = input;
  // Defense in depth: only this task's pages count as evidence.
  const pages = input.pages.filter((p) => p.taskId === task.taskId);
  const evidence: Partial<Record<PaymentField, PageHit[]>> = {};
  const fromPages = (field: PaymentField, test: (line: string) => boolean): Origin => {
    const hits = pageHits(pages, test);
    if (hits.length === 0) return "UNKNOWN";
    evidence[field] = hits;
    return "PAGE";
  };
  const trusted = (o: Origin) => o === "TASK" || o === "PLAN";

  const category = categoryFor(req.url, catalog);
  const matchedItem = matchPlanItem(plan, category);
  const candidateItems = matchedItem ? [matchedItem] : plan.expected;

  // payee: what the vendor will be paid (the quote), never the agent's req value
  const payee = normalizeDomain(quote.payeeDomain);
  let payeeOrigin: Origin;
  if (payee === "") payeeOrigin = "UNKNOWN";
  else if (normalizeDomain(req.payeeDomain) !== payee) {
    const asked = normalizeDomain(req.payeeDomain);
    payeeOrigin = asked === "" ? "UNKNOWN" : fromPages("payee", (l) => textHasDomain(l, asked));
  }
  else if (textHasDomain(task.text, payee)) payeeOrigin = "TASK";
  else if (candidateItems.some((i) => i.vendorDomains.some((d) => normalizeDomain(d) === payee))) payeeOrigin = "PLAN";
  else payeeOrigin = fromPages("payee", (l) => textHasDomain(l, payee));

  // tier: what the vendor will charge for (D17)
  const tier = quote.tier === null ? null : normalizeTier(quote.tier);
  let tierOrigin: Origin;
  if (tier === null) {
    // By design: an untiered vendor with an untiered plan traces to PLAN, so amount may trace to QUOTE.
    // What bounds that amount is the unit-price floor in floors.ts (quote amount / quantity <= maxUnitUsd).
    tierOrigin = matchedItem && matchedItem.tiers === undefined ? "PLAN" : "UNKNOWN";
  } else if (tier === "") {
    tierOrigin = "UNKNOWN";
  } else if (taskNamesTier(task.text, tier)) {
    tierOrigin = "TASK";
  } else if (matchedItem && (matchedItem.tiers ?? []).some((t) => normalizeTier(t) === tier)) {
    tierOrigin = "PLAN";
  } else {
    tierOrigin = fromPages("tier", (l) => lineHasTier(l, tier));
  }

  // quantity (D16): trusted only within the plan cap
  const quantity = quote.quantity;
  const cap = matchedItem
    ? matchedItem.maxQuantity
    : plan.expected.length > 0
      ? Math.min(...plan.expected.map((i) => i.maxQuantity))
      : null;
  let quantityOrigin: Origin;
  if (cap === null) quantityOrigin = "UNKNOWN";
  else if (Number.isInteger(quantity) && quantity >= 1 && quantity <= cap) {
    quantityOrigin = textHasQuantity(task.text, quantity) ? "TASK" : "PLAN";
  } else quantityOrigin = fromPages("quantity", (l) => textHasQuantity(l, quantity));

  // amount: what the vendor will charge (the quote); QUOTE only when the tier is trusted (D1)
  const amountUsd = quote.amountUsd;
  const taskPriceText = task.text.replace(BUDGET_PHRASE_RE, " ");
  let amountOrigin: Origin;
  if (!amountsEqual(req.amountUsd, amountUsd)) {
    // the D17 floor blocks the mismatch; keep the page evidence for what the agent asked
    amountOrigin = fromPages("amount", (l) => textHasNumber(l, req.amountUsd));
  } else if (textHasMoney(taskPriceText, amountUsd)) {
    amountOrigin = "TASK";
  } else if (matchedItem && trusted(quantityOrigin) && amountsEqual(amountUsd, matchedItem.maxUnitUsd * quantity)) {
    amountOrigin = "PLAN";
  } else if (trusted(tierOrigin)) {
    amountOrigin = "QUOTE";
  } else {
    amountOrigin = fromPages("amount", (l) => textHasNumber(l, amountUsd));
  }

  // category (D3): from the catalog, never from purpose text
  let categoryOrigin: Origin;
  if (category === null) categoryOrigin = "UNKNOWN";
  else if (textHasWords(task.text, category)) categoryOrigin = "TASK";
  else if (matchedItem) categoryOrigin = "PLAN";
  else categoryOrigin = fromPages("category", (l) => textHasWords(l, category));

  return {
    origins: { payee: payeeOrigin, amount: amountOrigin, tier: tierOrigin, quantity: quantityOrigin, category: categoryOrigin },
    evidence,
    payee,
    amountUsd,
    tier,
    quantity,
    category,
    matchedItem,
    candidateItems,
  };
}
