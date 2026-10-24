import { describe, expect, it } from "vitest";
import { MemoryStore, verifyChain, type DecisionDraft, type Hold } from "@countersign/shared";

const hold = (over: Partial<Hold> = {}): Hold => ({
  holdId: "h1",
  decisionId: "d1",
  taskId: "t1",
  routedTo: "Sam",
  status: "open",
  req: { url: "http://v.test/api/weather?tier=basic", payeeDomain: "v.test", amountUsd: 0.1, tier: "basic", quantity: 1, purpose: "p" },
  quoteId: "q1",
  createdAt: 1,
  ...over,
});

describe("MemoryStore holds", () => {
  it("putHold, getHold and getHoldByDecision", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    expect(await s.getHold("h1")).toEqual(hold());
    expect(await s.getHoldByDecision("d1")).toEqual(hold());
    expect(await s.getHold("nope")).toBeUndefined();
    expect(await s.getHoldByDecision("nope")).toBeUndefined();
  });

  it("one hold per holdId and per decision", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    await expect(s.putHold(hold({ decisionId: "d2" }))).rejects.toThrow();
    await expect(s.putHold(hold({ holdId: "h2" }))).rejects.toThrow();
    expect(await s.listHolds()).toHaveLength(1);
  });

  it("listHolds filters by status, in insertion order", async () => {
    const s = new MemoryStore();
    await s.putHold(hold({ holdId: "a", decisionId: "da" }));
    await s.putHold(hold({ holdId: "b", decisionId: "db", status: "rejected" }));
    await s.putHold(hold({ holdId: "c", decisionId: "dc" }));
    expect((await s.listHolds()).map((h) => h.holdId)).toEqual(["a", "b", "c"]);
    expect((await s.listHolds({ status: "open" })).map((h) => h.holdId)).toEqual(["a", "c"]);
    expect((await s.listHolds({ status: "rejected" })).map((h) => h.holdId)).toEqual(["b"]);
    expect(await s.listHolds({ status: "approved" })).toEqual([]);
  });

  it("updateHold is compare-and-set on status", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    const claimed = await s.updateHold("h1", "open", { status: "approved", resolvedBy: "Sam", resolvedAt: 5 });
    expect(claimed).toMatchObject({ holdId: "h1", status: "approved", resolvedBy: "Sam", resolvedAt: 5 });
    expect(await s.updateHold("h1", "open", { status: "rejected" })).toBeUndefined();
    expect((await s.getHold("h1"))!.status).toBe("approved");
    expect(await s.updateHold("h1", "approved", { proposedRuleId: "r1" })).toMatchObject({ status: "approved", proposedRuleId: "r1" });
    expect(await s.updateHold("nope", "open", { status: "approved" })).toBeUndefined();
  });

  it("updateHold never changes holdId, decisionId or taskId", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    const sneaky = { status: "approved", holdId: "x", decisionId: "y", taskId: "z" } as unknown as Partial<Hold>;
    await s.updateHold("h1", "open", sneaky);
    expect(await s.getHold("h1")).toMatchObject({ holdId: "h1", decisionId: "d1", taskId: "t1", status: "approved" });
    expect(await s.getHold("x")).toBeUndefined();
  });

  it("returns copies", async () => {
    const s = new MemoryStore();
    await s.putHold(hold());
    (await s.getHold("h1"))!.req.amountUsd = 999;
    (await s.listHolds())[0].status = "rejected";
    expect(await s.getHold("h1")).toEqual(hold());
  });

  it("human decisions chain like any other decision (D28)", async () => {
    const s = new MemoryStore();
    const base: DecisionDraft = {
      decisionId: "d1", paymentRequestId: "p1", taskId: "t1", kind: "verdict", tier: 2, verdict: "hold",
      fieldOrigins: {}, evidence: {}, amountUsd: 0.1, payeeDomain: "v.test", category: "weather", floorReasons: [],
      reasons: ["judge: hold"], latencyMs: 1, costUsd: null, createdAt: 1,
    };
    await s.appendDecision(base);
    await s.appendDecision({ ...base, decisionId: "d2", kind: "human_approval", tier: null, verdict: "approve", linkedDecisionId: "d1", reasons: ["approved by Sam"], costUsd: 0, createdAt: 2 });
    await s.appendDecision({ ...base, decisionId: "d3", kind: "human_rejection", tier: null, verdict: "block", linkedDecisionId: "d1", reasons: ["rejected by Sam"], costUsd: 0, createdAt: 3 });
    const log = await s.listDecisions();
    expect(log.map((d) => d.kind)).toEqual(["verdict", "human_approval", "human_rejection"]);
    expect(log[1].linkedDecisionId).toBe("d1");
    expect(verifyChain(log)).toEqual({ ok: true });
  });
});
