import type { Decision, PaymentRequest, Task, Verdict } from "@countersign/shared";
import type { QuoteInfo } from "./executor";
import { amountsEqual, normalizeDomain, normalizeTier, toAtomic } from "./normalize";
import { PAYMENT_FIELDS, isTainted, type TraceResult } from "./tracer";

export const SEVERITY: Record<Verdict, number> = { approve: 0, hold: 1, block: 2 };

/** D4: final verdict = max severity. Nothing lowers a verdict. */
export function maxVerdict(...verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "approve");
}

export interface FloorInput {
  trace: TraceResult;
  req: PaymentRequest;
  quote: QuoteInfo;
  budgetRemainingUsd: number;
  payeeAllowlist: string[];
}

export interface FloorCheck {
  verdict: "hold" | "block";
  reason: string;
}

export interface FloorResult {
  verdict: Verdict;
  reasons: string[];
  checks: FloorCheck[];
}

export function computeFloors(input: FloorInput): FloorResult {
  const { trace, req, quote } = input;
  const checks: FloorCheck[] = [];
  const hold = (reason: string) => checks.push({ verdict: "hold", reason });
  const block = (reason: string) => checks.push({ verdict: "block", reason });

  // Taint (INV3)
  for (const field of PAYMENT_FIELDS) {
    const origin = trace.origins[field];
    if (!isTainted(origin)) continue;
    const hit = trace.evidence[field]?.[0];
    if (origin === "PAGE" && hit) hold(`${field} traced to PAGE: page ${hit.url} line ${hit.line}: '${hit.text}'`);
    else hold(`${field} origin ${origin ?? "UNKNOWN"}: not found in task, plan or pages`);
  }

  // Request must equal the quote (D17)
  if (!amountsEqual(req.amountUsd, quote.amountUsd)) {
    block(`amount $${req.amountUsd} does not match quote $${quote.amountUsd}`);
  }
  if (req.tier !== undefined && normalizeTier(req.tier) !== (quote.tier === null ? null : normalizeTier(quote.tier))) {
    block(`requested tier '${req.tier}' does not match quoted tier '${quote.tier ?? "none"}'`);
  }
  if (req.quantity !== undefined && req.quantity !== quote.quantity) {
    block(`requested quantity ${req.quantity} does not match quoted quantity ${quote.quantity}`);
  }
  if (normalizeDomain(req.payeeDomain) !== normalizeDomain(quote.payeeDomain)) {
    block(`payee ${normalizeDomain(req.payeeDomain)} does not match quote payee ${normalizeDomain(quote.payeeDomain)}`);
  }

  // Plan limits
  const item = trace.matchedItem;
  if (!item) {
    hold(`no plan item for category '${trace.category ?? "unknown"}'`); // D22
  } else {
    if (quote.quantity > item.maxQuantity) hold(`quantity ${quote.quantity} exceeds plan maxQuantity ${item.maxQuantity}`);
    const unit = quote.amountUsd / quote.quantity;
    if (!(toAtomic(quote.amountUsd) <= toAtomic(item.maxUnitUsd) * quote.quantity)) hold(`unit price $${unit} exceeds plan maxUnitUsd $${item.maxUnitUsd}`);
  }

  // Payee in plan vendors or allowlist
  const allowed = new Set([...trace.candidateItems.flatMap((i) => i.vendorDomains), ...input.payeeAllowlist].map(normalizeDomain));
  if (!allowed.has(trace.payee)) hold(`payee ${trace.payee} is not in the plan's vendors or the allowlist`);

  // Budget (full atomic reservations are M4)
  const charge = Math.max(req.amountUsd, quote.amountUsd);
  if (!(toAtomic(charge) <= toAtomic(input.budgetRemainingUsd))) {
    block(`amount $${charge} exceeds task budget remaining $${input.budgetRemainingUsd}`);
  }

  return { verdict: maxVerdict(...checks.map((c) => c.verdict)), reasons: checks.map((c) => c.reason), checks };
}

/** D23, D28: budget minus approved amounts (verdict or human approval) for the task, excluding approvals whose payment then failed. */
export function budgetRemainingUsd(task: Pick<Task, "taskId" | "budgetUsd">, decisions: Decision[]): number {
  const mine = decisions.filter((d) => d.taskId === task.taskId);
  const failed = new Set(mine.filter((d) => d.kind === "executor_failure").map((d) => d.paymentRequestId));
  const spentAtomic = mine
    .filter((d) => (d.kind === "verdict" || d.kind === "human_approval") && d.verdict === "approve" && !failed.has(d.paymentRequestId))
    .reduce((sum, d) => sum + toAtomic(d.amountUsd), 0);
  return (toAtomic(task.budgetUsd) - spentAtomic) / 1_000_000;
}
