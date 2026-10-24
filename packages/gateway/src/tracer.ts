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
} from "./normalize";

/** Spec §7: rule-based, no LLM. */
export const PAYMENT_FIELDS: PaymentField[] = ["payee", "amount", "tier", "quantity", "category"];
export const MAX_EVIDENCE_TEXT = 200;

/** PAGE and UNKNOWN are taint; a missing origin is treated as UNKNOWN (fail closed). */
export function isTainted(o: Origin | undefined): boolean {
  return o === undefined || o === "PAGE" || o === "UNKNOWN";
}

export interface TraceInput {
  task: Task;
  plan: Plan;
  pages: Page[];
  quote: QuoteInfo;
  req: PaymentRequest;
  catalog: CatalogEntry[];
}

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

export function matchPlanItem(plan: Plan, category: string | null): PlanItem | null {
  if (category === null) return null;
  return plan.expected.find((item) => normalizeCategory(item.category) === category) ?? null;
}

function pageHits(pages: Page[], test: (line: string) => boolean): PageHit[] {
  const hits: PageHit[] = [];
  for (const page of pages) {
    page.lines.forEach((line, i) => {
      if (test(line)) {
        hits.push({ pageId: page.pageId, url: page.url, line: i + 1, text: line.trim().slice(0, MAX_EVIDENCE_TEXT) });
      }
    });
  }
  return hits;
}

export function traceFields(input: TraceInput): TraceResult {
  const { task, plan, pages, quote, req, catalog } = input;
  const evidence: Partial<Record<PaymentField, PageHit[]>> = {};
  const fromPages = (field: PaymentField, test: (line: string) => boolean): Origin => {
    const hits = pageHits(pages, test);
    if (hits.length === 0) return "UNKNOWN";
    evidence[field] = hits;
    return "PAGE";
  };

  const category = categoryFor(req.url, catalog);
  const matchedItem = matchPlanItem(plan, category);
  const candidateItems = matchedItem ? [matchedItem] : plan.expected;

  // payee
  const payee = normalizeDomain(req.payeeDomain);
  const payeeOrigin: Origin = textHasDomain(task.text, payee)
    ? "TASK"
    : candidateItems.some((i) => i.vendorDomains.some((d) => normalizeDomain(d) === payee))
      ? "PLAN"
      : fromPages("payee", (l) => textHasDomain(l, payee));

  // tier: what the vendor will charge for (D17)
  const tier = quote.tier === null ? null : normalizeTier(quote.tier);
  let tierOrigin: Origin;
  if (tier === null) {
    tierOrigin = candidateItems.some((i) => i.tiers !== undefined) ? "UNKNOWN" : "PLAN";
  } else if (tier === "") {
    tierOrigin = "UNKNOWN";
  } else if (lineHasTier(task.text, tier)) {
    tierOrigin = "TASK";
  } else if (candidateItems.some((i) => (i.tiers ?? []).some((t) => normalizeTier(t) === tier))) {
    tierOrigin = "PLAN";
  } else {
    tierOrigin = fromPages("tier", (l) => lineHasTier(l, tier));
  }

  // quantity (D16)
  const quantity = quote.quantity;
  const quantityOrigin: Origin = textHasQuantity(task.text, quantity)
    ? "TASK"
    : candidateItems.some((i) => quantity <= i.maxQuantity)
      ? "PLAN"
      : fromPages("quantity", (l) => textHasQuantity(l, quantity));

  // amount: QUOTE only when the tier is trusted (D1)
  const amountUsd = req.amountUsd;
  let amountOrigin: Origin;
  if (textHasMoney(task.text, amountUsd)) {
    amountOrigin = "TASK";
  } else if (matchedItem && amountsEqual(amountUsd, matchedItem.maxUnitUsd * quantity)) {
    amountOrigin = "PLAN";
  } else if (amountsEqual(amountUsd, quote.amountUsd) && (tierOrigin === "TASK" || tierOrigin === "PLAN")) {
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
