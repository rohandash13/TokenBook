import { afterEach, describe, expect, it } from "vitest";
import { createGatewayClient } from "../src/gateway-client.js";
import { HOLD_POLL_MS, HOLD_WAIT_MS, runWorker, waitForHold, type GatewayClient, type ToolResult } from "@countersign/worker";

const ok = (body: unknown): ToolResult => ({ ok: true, status: 200, body });
const HELD = ok({ status: "held", reason: "judge: new payee", decisionId: "d1" });
const OPEN = ok({ holdId: "h1", decisionId: "d1", status: "open", reason: "held for review by Sam" });
const APPROVED = ok({ holdId: "h1", decisionId: "d1", status: "approved", reason: "approved by Sam; paid (simulated)", data: { tempC: 18 } });
const REJECTED = ok({ holdId: "h1", decisionId: "d1", status: "rejected", reason: "rejected by Sam" });

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps };
}

const unused = async (): Promise<ToolResult> => { throw new Error("not used in this test"); };

function holdClient(next: () => Promise<ToolResult>) {
  const calls: Array<[string, string]> = [];
  const client: GatewayClient = {
    declarePlan: unused,
    fetchUrl: unused,
    payAndFetch: unused,
    llm: unused,
    getHold: async (taskId, decisionId) => { calls.push([taskId, decisionId]); return next(); },
  };
  return { client, calls };
}

function sequence(...replies: ToolResult[]) {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
}

describe("waitForHold (D33)", () => {
  it("defaults: poll every second for up to two minutes", () => {
    expect(HOLD_POLL_MS).toBe(1000);
    expect(HOLD_WAIT_MS).toBe(120_000);
  });

  it("polls get_hold with the launcher's taskId until the hold resolves, then returns the resolution", async () => {
    const c = fakeClock();
    const { client, calls } = holdClient(sequence(OPEN, OPEN, APPROVED));
    const out = await waitForHold(client, "task-1", HELD, { now: c.now, sleep: c.sleep });
    expect(out).toEqual(APPROVED);
    expect(calls).toEqual([["task-1", "d1"], ["task-1", "d1"], ["task-1", "d1"]]);
    expect(c.sleeps).toEqual([1000, 1000, 1000]);
  });

  it("a rejection comes back the same way", async () => {
    const c = fakeClock();
    const { client } = holdClient(sequence(REJECTED));
    expect(await waitForHold(client, "t", HELD, { now: c.now, sleep: c.sleep })).toEqual(REJECTED);
  });

  it("still open when waitMs runs out: the original held result, unchanged", async () => {
    const c = fakeClock();
    const { client, calls } = holdClient(sequence(OPEN));
    const out = await waitForHold(client, "t", HELD, { pollMs: 1000, waitMs: 3000, now: c.now, sleep: c.sleep });
    expect(out).toBe(HELD);
    expect(calls).toHaveLength(3);
    expect(c.now()).toBe(3000);
  });

  it("the last sleep is cut to the deadline", async () => {
    const c = fakeClock();
    const { client } = holdClient(sequence(OPEN));
    await waitForHold(client, "t", HELD, { pollMs: 1000, waitMs: 2500, now: c.now, sleep: c.sleep });
    expect(c.sleeps).toEqual([1000, 1000, 500]);
  });

  it("a non-200 get_hold or a thrown call stops waiting and returns the held result", async () => {
    const c = fakeClock();
    const notFound = holdClient(sequence({ ok: false, status: 404, body: { error: { code: "HOLD_NOT_FOUND" } } }));
    expect(await waitForHold(notFound.client, "t", HELD, { now: c.now, sleep: c.sleep })).toBe(HELD);
    expect(notFound.calls).toHaveLength(1);
    const broken = holdClient(async () => { throw new Error("gateway down"); });
    expect(await waitForHold(broken.client, "t", HELD, { now: c.now, sleep: c.sleep })).toBe(HELD);
  });

  it("anything that is not a 200 held result with a decisionId passes straight through without polling", async () => {
    const c = fakeClock();
    const passThrough: ToolResult[] = [
      ok({ status: "approved", decisionId: "d", data: {} }),
      ok({ status: "blocked", decisionId: "d", reason: "x" }),
      { ok: false, status: 400, body: { error: { code: "BAD_INPUT" } } },
      ok({ status: "held", reason: "no id" }),
      ok(null),
    ];
    for (const r of passThrough) {
      const { client, calls } = holdClient(sequence(APPROVED));
      expect(await waitForHold(client, "t", r, { now: c.now, sleep: c.sleep })).toBe(r);
      expect(calls).toHaveLength(0);
    }
  });

  it("runWorker hands the resolved hold to the model as the pay_and_fetch tool result", async () => {
    const llmCalls: any[] = [];
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "pay_and_fetch", input: { url: "http://a/api", payeeDomain: "a", amountUsd: 0.1, purpose: "p" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ];
    let i = 0;
    const getHoldCalls: Array<[string, string]> = [];
    const client: GatewayClient = {
      llm: async (body) => { llmCalls.push(structuredClone(body)); return ok(replies[i++]); },
      declarePlan: unused,
      fetchUrl: unused,
      payAndFetch: async () => HELD,
      getHold: async (taskId, decisionId) => { getHoldCalls.push([taskId, decisionId]); return APPROVED; },
    };
    const c = fakeClock();
    const out = await runWorker({ client, taskId: "task-1", taskText: "x", now: c.now, sleep: c.sleep });
    expect(out.finalText).toBe("done");
    expect(getHoldCalls).toEqual([["task-1", "d1"]]);
    const toolResult = llmCalls[1].messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "p1", is_error: false });
    expect(JSON.parse(toolResult.content)).toEqual(APPROVED.body);
  });
  it("a getHold that never resolves cannot outlive waitMs: returns the unchanged held result", async () => {
    const { client, calls } = holdClient(() => new Promise<ToolResult>(() => {}));
    const t0 = Date.now();
    const out = await waitForHold(client, "t", HELD, { pollMs: 100, waitMs: 300 });
    expect(out).toBe(HELD);
    expect(calls).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("validates pollMs: clamps up to 100, NaN falls back to the default", async () => {
    for (const [pollMs, expected] of [[0, 100], [-5, 100], [50, 100], [Number.NaN, 1000], [Infinity, 1000]] as const) {
      const c = fakeClock();
      const { client } = holdClient(sequence(OPEN));
      await waitForHold(client, "t", HELD, { pollMs, waitMs: 1000, now: c.now, sleep: c.sleep });
      expect(c.sleeps[0], `pollMs=${pollMs}`).toBe(expected);
    }
  });

  it("validates waitMs: 0 never polls, negative never polls, NaN uses the default", async () => {
    for (const waitMs of [0, -10]) {
      const c = fakeClock();
      const { client, calls } = holdClient(sequence(APPROVED));
      expect(await waitForHold(client, "t", HELD, { waitMs, now: c.now, sleep: c.sleep })).toBe(HELD);
      expect(calls).toHaveLength(0);
    }
    const c = fakeClock();
    const { client, calls } = holdClient(sequence(OPEN));
    await waitForHold(client, "t", HELD, { waitMs: Number.NaN, now: c.now, sleep: c.sleep });
    expect(c.now()).toBe(HOLD_WAIT_MS);
    expect(calls).toHaveLength(HOLD_WAIT_MS / HOLD_POLL_MS);
  });

  async function endToEnd(getHold: () => ToolResult, opts: { waitMs?: number } = {}) {
    const llmCalls: any[] = [];
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "p1", name: "pay_and_fetch", input: { url: "http://a/api", payeeDomain: "a", amountUsd: 0.1, purpose: "p" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ];
    let i = 0;
    let getHoldCalls = 0;
    const client: GatewayClient = {
      llm: async (body) => { llmCalls.push(structuredClone(body)); return ok(replies[i++]); },
      declarePlan: unused,
      fetchUrl: unused,
      payAndFetch: async () => HELD,
      getHold: async () => { getHoldCalls++; return getHold(); },
    };
    const c = fakeClock();
    await runWorker({ client, taskId: "task-1", taskText: "x", now: c.now, sleep: c.sleep, ...opts });
    return { content: JSON.parse(llmCalls[1].messages.at(-1).content[0].content), getHoldCalls };
  }

  it("runWorker: a rejected hold reaches the model as the rejection body", async () => {
    const r = await endToEnd(() => REJECTED);
    expect(r.content).toEqual(REJECTED.body);
    expect(r.getHoldCalls).toBe(1);
  });

  it("runWorker: a hold still open at the deadline reaches the model as the held body", async () => {
    const r = await endToEnd(() => OPEN, { waitMs: 3000 });
    expect(r.content).toEqual(HELD.body);
    expect(r.getHoldCalls).toBe(3);
  });

  it("runWorker with waitMs: 0 never calls getHold", async () => {
    const r = await endToEnd(() => APPROVED, { waitMs: 0 });
    expect(r.content).toEqual(HELD.body);
    expect(r.getHoldCalls).toBe(0);
  });
});

describe("gateway client timeouts", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  function hangingFetch() {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
      })) as typeof fetch;
  }

  it("a gateway that never answers rejects after requestTimeoutMs", async () => {
    hangingFetch();
    const client = createGatewayClient("http://127.0.0.1:1", { requestTimeoutMs: 100 });
    const t0 = Date.now();
    await expect(client.fetchUrl("t", "http://a")).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("getHold is bounded by min(requestTimeoutMs, the remaining wait)", async () => {
    hangingFetch();
    const client = createGatewayClient("http://127.0.0.1:1", { requestTimeoutMs: 30_000 });
    const t0 = Date.now();
    await expect(client.getHold("t", "d", { timeoutMs: 100 })).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("a signal is passed on every call, default timeout configured", async () => {
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await createGatewayClient("http://127.0.0.1:1").llm({});
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
