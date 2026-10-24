import { describe, expect, it } from "vitest";
import { runWorker, type GatewayClient, type ToolResult } from "@countersign/worker";

function fakeClient(llmReplies: unknown[]) {
  const calls: unknown[][] = [];
  let i = 0;
  const ok = (body: unknown): ToolResult => ({ ok: true, status: 200, body });
  const client: GatewayClient = {
    // clone: the loop keeps mutating its messages array after each call
    llm: async (body) => { calls.push(["llm", structuredClone(body)]); return ok(llmReplies[i++]); },
    declarePlan: async (taskId, plan) => { calls.push(["declare_plan", taskId, plan]); return ok({ ok: true }); },
    fetchUrl: async (taskId, url) => { calls.push(["fetch_url", taskId, url]); return ok({ pageId: "p", text: "docs" }); },
    payAndFetch: async (taskId, req) => { calls.push(["pay_and_fetch", taskId, req]); return ok({ status: "held", reason: "r", decisionId: "d" }); },
    getHold: async (taskId, decisionId) => { calls.push(["get_hold", taskId, decisionId]); return ok({ status: "open", reason: "r" }); },
  };
  return { client, calls };
}

describe("worker loop", () => {
  it("runs tools under the launcher's taskId, never one the model supplies", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "fetch_url", input: { url: "http://a/docs", taskId: "evil" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ]);
    const out = await runWorker({ client, taskId: "task-1", taskText: "x" });
    expect(calls[1]).toEqual(["fetch_url", "task-1", "http://a/docs"]);
    expect(out.finalText).toBe("done");
  });

  it("never sends a model id: the gateway chooses it", async () => {
    const { client, calls } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
    await runWorker({ client, taskId: "t", taskText: "x" });
    expect(calls[0][1]).not.toHaveProperty("model");
  });

  it("returns an unknown tool to the model as an error result", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "shell", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    await runWorker({ client, taskId: "t", taskText: "x" });
    const second = calls[1][1] as { messages: Array<{ content: unknown }> };
    expect(second.messages.at(-1)!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: true }),
    ]);
  });

  it("returns a failed tool call to the model as an error result and keeps going", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "fetch_url", input: { url: "http://a" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "gave up" }] },
    ]);
    client.fetchUrl = async () => { throw new Error("gateway down"); };
    const out = await runWorker({ client, taskId: "t", taskText: "x" });
    const second = calls[1][1] as { messages: Array<{ content: any[] }> };
    const block = second.messages.at(-1)!.content[0];
    expect(block).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: true });
    expect(JSON.parse(block.content)).toEqual({ error: { code: "TOOL_CALL_FAILED", message: "gateway down" } });
    expect(out.finalText).toBe("gave up");
    expect(out.exhausted).toBeUndefined();
  });

  it("uses the launcher's taskId for declare_plan and pay_and_fetch too", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [
        { type: "tool_use", id: "a", name: "declare_plan", input: { taskId: "evil", plan: { goal: "g", expected: [] } } },
        { type: "tool_use", id: "b", name: "pay_and_fetch", input: { taskId: "evil", url: "http://a", payeeDomain: "a", amountUsd: 1, purpose: "p" } },
      ] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ]);
    await runWorker({ client, taskId: "task-1", taskText: "x", waitMs: 0 });
    expect(calls[1][0]).toBe("declare_plan");
    expect(calls[1][1]).toBe("task-1");
    expect(calls[2][0]).toBe("pay_and_fetch");
    expect(calls[2][1]).toBe("task-1");
  });

  it("reports exhaustion when maxTurns runs out", async () => {
    const tool = { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "fetch_url", input: { url: "u" } }] };
    const { client } = fakeClient([tool, tool]);
    const out = await runWorker({ client, taskId: "t", taskText: "x", maxTurns: 2 });
    expect(out).toMatchObject({ finalText: "max turns reached", exhausted: true });
  });
});
