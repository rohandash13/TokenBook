import { describe, expect, it } from "vitest";
import { MemoryStore } from "@countersign/shared";

describe("atomic reservations", () => {
  it("five parallel 10-cent reservations cannot exceed 30 cents", async () => {
    const s = new MemoryStore();
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => s.reserve("t", `p${i}`, 0.1, 0.3)));
    expect(rs.filter(r => r.ok)).toHaveLength(3);
    const rows = await s.listReservations("t");
    expect(rows.reduce((n,r) => n + Math.round(r.amountUsd * 1e6), 0)).toBe(300000);
  });
  it("commit and release are idempotent and committed money cannot be released", async () => {
    const s = new MemoryStore();
    const r = await s.reserve("t", "p", 0.1, 0.1);
    if (!r.ok) throw new Error("reserve failed");
    await s.commit(r.reservation.reservationId); await s.commit(r.reservation.reservationId);
    await s.release(r.reservation.reservationId);
    expect((await s.listReservations("t"))[0].state).toBe("committed");
    expect((await s.reserve("t", "other", 0.1, 0.1)).ok).toBe(false);
    const t = await s.reserve("t2", "p2", 0.1, 0.1);
    if (!t.ok) throw new Error("reserve failed");
    await s.release(t.reservation.reservationId); await s.release(t.reservation.reservationId);
    await expect(s.commit(t.reservation.reservationId)).rejects.toThrow();
    expect((await s.reserve("t2", "new", 0.1, 0.1)).ok).toBe(true);
  });
  it("rejects unsafe or invalid amounts and budgets", async () => {
    const s = new MemoryStore();
    for (const amount of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) await expect(s.reserve("t", "p", amount, 1)).rejects.toThrow();
    await expect(s.reserve("t", "p", 1, NaN)).rejects.toThrow();
  });
  it("claims payment identity atomically and never reclaims an unknown outcome", async () => {
    const s = new MemoryStore();
    const payment = { idempotencyKey: "k", taskId: "t", firstDecisionId: "d", state: "pending" as const, createdAt: 1, updatedAt: 1 };
    const rs = await Promise.all([s.claimPayment(payment), s.claimPayment(payment)]);
    expect(rs.filter(r => r.claimed)).toHaveLength(1);
    await s.updatePayment("k", { state: "unknown" });
    expect((await s.claimPayment(payment)).claimed).toBe(false);
    await s.updatePayment("k", { state: "failed" });
    expect((await s.claimPayment(payment)).claimed).toBe(true);
  });
});
