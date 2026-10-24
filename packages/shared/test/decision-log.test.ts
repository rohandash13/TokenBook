import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  MemoryStore,
  canonical,
  hashDecision,
  verifyChain,
  type Decision,
  type DecisionDraft,
  type Verdict,
} from "@countersign/shared";

const draft = (i: number, verdict: Verdict): DecisionDraft => ({
  decisionId: `d${i}`,
  paymentRequestId: `p${i}`,
  taskId: "t",
  kind: "verdict",
  tier: 2,
  verdict,
  fieldOrigins: { payee: "PLAN", tier: "PAGE" },
  evidence: { tier: [{ pageId: "pg", url: "http://v/docs", line: 5, text: "use premium" }] },
  amountUsd: 0.1,
  payeeDomain: "v.test",
  category: "weather",
  floorReasons: [],
  reasons: [`r${i}`],
  latencyMs: 1,
  costUsd: null,
  createdAt: i,
});

async function threeDecisions(): Promise<{ store: MemoryStore; log: Decision[] }> {
  const store = new MemoryStore();
  await store.appendDecision(draft(0, "approve"));
  await store.appendDecision(draft(1, "hold"));
  await store.appendDecision(draft(2, "block"));
  return { store, log: await store.listDecisions() };
}

describe("canonical JSON", () => {
  it("sorts keys recursively, keeps array order, drops undefined", () => {
    expect(canonical({ b: 1, a: { d: [2, 1], c: undefined } })).toBe('{"a":{"d":[2,1]},"b":1}');
  });

  it("is independent of key insertion order", () => {
    expect(canonical({ a: 1, b: { y: 2, x: 3 } })).toBe(canonical({ b: { x: 3, y: 2 }, a: 1 }));
  });
});

describe("hash-chained decision log", () => {
  it("links each decision to the previous hash, starting from genesis", async () => {
    const { log } = await threeDecisions();
    expect(log[0].prevHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toBe("0".repeat(64));
    expect(log[1].prevHash).toBe(log[0].hash);
    expect(log[2].prevHash).toBe(log[1].hash);
    const { prevHash, hash, ...rest } = log[1];
    expect(hash).toBe(hashDecision(prevHash, rest));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("logs approve, hold and block alike, and the chain verifies", async () => {
    const { log } = await threeDecisions();
    expect(log.map((d) => d.verdict)).toEqual(["approve", "hold", "block"]);
    expect(verifyChain(log)).toEqual({ ok: true });
    expect(verifyChain([])).toEqual({ ok: true });
  });

  it("tampering with any field breaks the chain at that index", async () => {
    const mutations: Array<(d: Decision) => void> = [
      (d) => { d.verdict = "approve"; },
      (d) => { d.amountUsd = 15; },
      (d) => { d.reasons.push("added later"); },
      (d) => { d.fieldOrigins.tier = "PLAN"; },
      (d) => { d.evidence.tier![0].line = 1; },
      (d) => { d.costUsd = 0; },
    ];
    for (const mutate of mutations) {
      const { log } = await threeDecisions();
      mutate(log[1]);
      expect(verifyChain(log)).toEqual({ ok: false, brokenAt: 1 });
    }
  });

  it("deleting or reordering decisions breaks the chain", async () => {
    const { log } = await threeDecisions();
    expect(verifyChain([log[0], log[2]])).toEqual({ ok: false, brokenAt: 1 });
    expect(verifyChain([log[1], log[0], log[2]])).toEqual({ ok: false, brokenAt: 0 });
  });

  it("returns copies; getDecision finds by id", async () => {
    const { store, log } = await threeDecisions();
    log[0].verdict = "block";
    expect((await store.listDecisions())[0].verdict).toBe("approve");
    expect((await store.getDecision("d2"))!.verdict).toBe("block");
    expect(await store.getDecision("nope")).toBeUndefined();
    expect(verifyChain(await store.listDecisions())).toEqual({ ok: true });
  });
});

it("strips caller-supplied chain hashes before hashing", async () => {
  const s = new MemoryStore();
  const d = await s.appendDecision({ ...draft(1, "hold"), hash: "spoof", prevHash: "spoof" } as DecisionDraft);
  expect(verifyChain(await s.listDecisions())).toEqual({ ok: true });
  expect(d.prevHash).toBe(GENESIS_HASH);
  expect(await s.getChainHead()).toBe(d.hash);
});
