import { GENESIS_HASH, hashDecision } from "./decision-log";
import type { Store } from "./store";
import { randomUUID } from "node:crypto";
import { toAtomic } from "./fields";
import type { Reservation, PaymentRecord, Receipt, Payee, Decision, DecisionDraft, Hold, HoldPatch, HoldStatus, Page, Plan, Quote, Rule, Task } from "./types";

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  private last = 0;
  private tasks = new Map<string, Task>();
  private plans = new Map<string, Plan>();
  private pages: Page[] = [];
  private quotes: Quote[] = [];
  private decisions: Decision[] = [];
  private rules = new Map<string, Rule>();
  private holds = new Map<string, Hold>();

  now(): number {
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  async putTask(task: Task) { this.tasks.set(task.taskId, copy(task)); }
  async getTask(taskId: string) { const t = this.tasks.get(taskId); return t && copy(t); }

  async insertPlan(plan: Plan) {
    if (this.plans.has(plan.taskId)) return false;
    this.plans.set(plan.taskId, copy(plan));
    return true;
  }
  async getPlan(taskId: string) { const p = this.plans.get(taskId); return p && copy(p); }

  async putPage(page: Page) { this.pages.push(copy(page)); }
  async listPages(taskId: string) { return this.pages.filter((p) => p.taskId === taskId).map(copy); }

  async putQuote(quote: Quote) { this.quotes.push(copy(quote)); }
  async listQuotes(taskId: string) { return this.quotes.filter((q) => q.taskId === taskId).map(copy); }

  /** Single-threaded JS: read-last-then-push has no await in between, so it is atomic. */
  async appendDecision(draft: DecisionDraft) {
    const prevHash = this.decisions.at(-1)?.hash ?? GENESIS_HASH;
    const { prevHash: _prev, hash: _hash, ...body } = copy(draft) as Decision;
    const decision: Decision = { ...body, prevHash, hash: hashDecision(prevHash, body) };
    this.decisions.push(decision);
    return copy(decision);
  }
  async getChainHead() { return this.decisions.at(-1)?.hash ?? GENESIS_HASH; }
  async listDecisions() { return this.decisions.map(copy); }
  async getDecision(decisionId: string) {
    const d = this.decisions.find((x) => x.decisionId === decisionId);
    return d && copy(d);
  }

  async putRule(rule: Rule) { this.rules.set(rule.ruleId, copy(rule)); }
  async listRules() { return [...this.rules.values()].map(copy); }

  /** No await between read and write: atomic in single-threaded JS. */
  async updateRule(ruleId: string, from: Rule["status"], patch: Partial<Rule>) {
    const current = this.rules.get(ruleId);
    if (!current || current.status !== from) return undefined;
    const next: Rule = { ...current, ...copy(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))), ruleId: current.ruleId };
    this.rules.set(ruleId, next);
    return copy(next);
  }

  async putHold(hold: Hold) {
    if (this.holds.has(hold.holdId) || [...this.holds.values()].some((h) => h.decisionId === hold.decisionId)) {
      throw new Error(`a hold already exists for hold ${hold.holdId} or decision ${hold.decisionId}`);
    }
    this.holds.set(hold.holdId, copy(hold));
  }
  async getHold(holdId: string) { const h = this.holds.get(holdId); return h && copy(h); }
  async getHoldByDecision(decisionId: string) {
    const h = [...this.holds.values()].find((x) => x.decisionId === decisionId);
    return h && copy(h);
  }
  async listHolds(filter: { status?: HoldStatus } = {}) {
    return [...this.holds.values()].filter((h) => !filter.status || h.status === filter.status).map(copy);
  }
  /** No await between read and write: atomic in single-threaded JS. */
  async updateHold(holdId: string, from: HoldStatus, patch: HoldPatch) {
    const current = this.holds.get(holdId);
    if (!current || current.status !== from) return undefined;
    const next: Hold = { ...current, ...copy(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))), holdId: current.holdId, decisionId: current.decisionId, taskId: current.taskId };
    this.holds.set(holdId, next);
    return copy(next);
  }

  private reservations = new Map<string, Reservation>();
  private payments = new Map<string, PaymentRecord>();
  private receipts = new Map<string, Receipt>();
  private payees = new Map<string, Payee>();

  async reserve(taskId: string, paymentRequestId: string, amountUsd: number, budgetUsd: number): Promise<{ ok: true; reservation: Reservation } | { ok: false; remainingUsd: number }> {
    for (const n of [amountUsd, budgetUsd]) if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(toAtomic(n))) throw new Error("invalid reservation amount/budget");
    const existing = [...this.reservations.values()].find(r => r.taskId === taskId && r.paymentRequestId === paymentRequestId && r.state !== "released");
    if (existing) {
      if (toAtomic(existing.amountUsd) !== toAtomic(amountUsd)) throw new Error("reservation amount changed");
      return { ok: true, reservation: copy(existing) };
    }
    // No await: accounting and insertion are one atomic critical section.
    const outstanding = [...this.reservations.values()].filter(r => r.taskId === taskId && r.state !== "released").reduce((n,r) => n + toAtomic(r.amountUsd), 0);
    const remaining = toAtomic(budgetUsd) - outstanding;
    if (!(toAtomic(amountUsd) <= remaining)) return { ok: false, remainingUsd: remaining / 1e6 };
    const now = this.now();
    const reservation: Reservation = { reservationId: randomUUID(), taskId, paymentRequestId, amountUsd, state: "reserved", createdAt: now, updatedAt: now };
    this.reservations.set(reservation.reservationId, reservation);
    return { ok: true, reservation: copy(reservation) };
  }
  async commit(id: string) {
    const r = this.reservations.get(id);
    if (!r || r.state === "released") throw new Error("cannot commit missing/released reservation");
    if (r.state === "reserved") { r.state = "committed"; r.updatedAt = this.now(); }
  }
  async release(id: string) {
    const r = this.reservations.get(id);
    if (r?.state === "reserved") { r.state = "released"; r.updatedAt = this.now(); }
  }
  async listReservations(taskId: string) { return [...this.reservations.values()].filter(r => r.taskId === taskId).map(copy); }
  async claimPayment(payment: PaymentRecord): Promise<{ claimed: true } | { claimed: false; existing: PaymentRecord }> {
    const existing = this.payments.get(payment.idempotencyKey);
    if (existing && existing.state !== "failed") return { claimed: false, existing: copy(existing) };
    this.payments.set(payment.idempotencyKey, copy(payment));
    return { claimed: true };
  }
  async getPayment(key: string) { const p = this.payments.get(key); return p && copy(p); }
  async updatePayment(key: string, patch: Partial<Pick<PaymentRecord, "state" | "result" | "receiptId" | "reservationId">>) {
    const p = this.payments.get(key);
    if (!p) throw new Error("payment missing");
    this.payments.set(key, { ...p, ...copy(patch), updatedAt: this.now() });
  }
  async putReceipt(receipt: Receipt) { this.receipts.set(receipt.receiptId, copy(receipt)); }
  async listReceipts(taskId?: string) { return [...this.receipts.values()].filter(r => !taskId || r.taskId === taskId).map(copy); }
  async getPayee(domain: string) { const p = this.payees.get(domain); return p && copy(p); }
  async putPayee(payee: Payee) { this.payees.set(payee.domain, copy(payee)); }
  async recordDelivery(domain: string, failed: boolean) {
    const p = this.payees.get(domain) ?? { payeeId: domain, domain, crsStatus: "unchecked" as const, liens: 0, ofacHit: false, firstSeenAt: this.now(), deliveryFailures: 0 };
    if (failed) p.deliveryFailures++;
    this.payees.set(domain, p);
  }
  async listPayees() { return [...this.payees.values()].map(copy); }
}
