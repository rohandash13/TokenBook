import { describe, expect, it } from "vitest";
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
});
