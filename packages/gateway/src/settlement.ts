import { randomUUID } from "node:crypto";
import type { Decision, PaymentRecord, Reservation, Store } from "@countersign/shared";
import { checkDelivery } from "./delivery";
import type { Executor, PayOutcome, QuoteInfo } from "./executor";

export async function budgetSnapshot(store: Store, taskId: string, budgetUsd: number) {
  const rs = await store.listReservations(taskId);
  const sum = (state: Reservation["state"]) => rs.filter(r => r.state === state).reduce((n,r) => n + Math.round(r.amountUsd * 1e6), 0);
  const reserved = sum("reserved"), committed = sum("committed");
  return { budgetUsd, reservedUsd: reserved / 1e6, committedUsd: committed / 1e6, remainingUsd: (Math.round(budgetUsd * 1e6) - reserved - committed) / 1e6 };
}
export type SettlementResult = { status: "settled" | "failed" | "unknown"; data?: unknown; reason: string; reused?: boolean };
/** Shared by automatic and human approvals. A claimed key has exactly one executing owner. */
export async function settle(args: { store: Store; executor: Executor; decision: Decision; reservation: Reservation; key: string; quote: QuoteInfo; url: string }): Promise<SettlementResult> {
  const { store, executor, decision, reservation, key, quote, url } = args;
  const now = store.now();
  const claim = await store.claimPayment({ idempotencyKey: key, taskId: decision.taskId, firstDecisionId: decision.decisionId, reservationId: reservation.reservationId, state: "pending", createdAt: now, updatedAt: now });
  if (!claim.claimed) {
    await store.release(reservation.reservationId);
    const result = cachedSettlement(claim.existing);
    if (result.reused) {
      const { hash, prevHash, ...body } = decision;
      await store.appendDecision({ ...body, decisionId: randomUUID(), kind: "duplicate_reused", linkedDecisionId: claim.existing.firstDecisionId, tier: null, verdict: "approve", costUsd: 0, savedUsd: quote.amountUsd, reasons: [`${result.reason}; saved $${quote.amountUsd}`], createdAt: store.now() });
    }
    return result;
  }
  let outcome: PayOutcome | { status: "unknown" } = { status: "unknown" };
  let recovered = false;
  let cause = "";
  try { outcome = await executor.pay(url, quote, key); }
  catch (e) {
    cause = e instanceof Error ? e.message : String(e);
    await store.updatePayment(key, { state: "unknown" });
    const { hash, prevHash, ...body } = decision;
    await store.appendDecision({ ...body, decisionId: randomUUID(), kind: "payment_unconfirmed", tier: null, verdict: "hold", linkedDecisionId: decision.decisionId, reasons: [`payment unconfirmed: ${cause}`], costUsd: 0, createdAt: store.now() });
    for (let attempt = 0; attempt < 3; attempt++) {
      try { outcome = executor.confirm ? await executor.confirm(key, quote, url) : { status: "unknown" }; }
      catch { outcome = { status: "unknown" }; }
      if (outcome.status !== "unknown") break;
    }
    if (outcome.status === "failed") {
      // Status positively established that no payment settled. Only one retry, same key.
      try { outcome = await executor.pay(url, quote, key); }
      catch { outcome = { status: "unknown" }; }
    }
    recovered = outcome.status === "settled";
  }
  if (outcome.status === "unknown") {
    await store.updatePayment(key, { state: "unknown" });
    return { status: "unknown", reason: `payment outcome unknown; manual reconciliation${cause ? `: ${cause}` : ""}` };
  }
  if (outcome.status === "failed") {
    await store.release(reservation.reservationId);
    await store.updatePayment(key, { state: "failed" });
    return { status: "failed", reason: `executor failed: http ${outcome.httpStatus}` };
  }
  // Store the settled result first; delivery checking must never erase proof money moved.
  await store.updatePayment(key, { state: "settled", result: outcome.data });
  await store.commit(reservation.reservationId);
  const delivery = checkDelivery({ data: outcome.data, url, quotedAtomic: quote.amountAtomic, paidAtomic: outcome.paidAtomic });
  const receiptId = randomUUID();
  await store.putReceipt({ receiptId, taskId: decision.taskId, decisionId: decision.decisionId, quotedUsd: quote.amountUsd, paidUsd: outcome.paidAtomic === undefined ? null : Number(outcome.paidAtomic) / 1e6, deliveryStatus: delivery.status, amountMismatch: delivery.amountMismatch, reasons: delivery.reasons, txRef: outcome.txRef, simulated: outcome.simulated, createdAt: store.now() });
  await store.recordDelivery(quote.payeeDomain, delivery.status !== "ok");
  await store.updatePayment(key, { receiptId });
  return { status: "settled", data: outcome.data, reason: recovered ? "recovered after timeout; confirmed settled; paid once" : `paid${outcome.simulated ? " (simulated)" : ""}` };
}
export function cachedSettlement(p: PaymentRecord): SettlementResult {
  return p.state === "settled" ? { status: "settled", data: p.result, reused: true, reason: `duplicate of decision ${p.firstDecisionId}; payment skipped` } : { status: "unknown", reason: "payment outcome unknown; manual reconciliation; will not pay twice" };
}
