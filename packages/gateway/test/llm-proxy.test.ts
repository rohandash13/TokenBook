import { describe, expect, it } from "vitest";
import { ANTHROPIC_MESSAGES_URL, createLlmProxy } from "@countersign/gateway";

function fakeFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ content: [], stop_reason: "end_turn" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("LLM proxy", () => {
  it("forwards to Anthropic with the gateway's key", async () => {
    const f = fakeFetch();
    const proxy = createLlmProxy({ apiKey: "sk-test", model: "model-from-env", fetchImpl: f.impl });
    const out = await proxy({ max_tokens: 10, messages: [] });
    expect(out.status).toBe(200);
    expect(f.calls[0].url).toBe(ANTHROPIC_MESSAGES_URL);
    expect((f.calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
  });

  it("forces the env model, ignoring any model the worker asks for", async () => {
    const f = fakeFetch();
    const proxy = createLlmProxy({ apiKey: "k", model: "model-from-env", fetchImpl: f.impl });
    await proxy({ model: "worker-chosen", max_tokens: 10, messages: [] });
    expect(JSON.parse(f.calls[0].init.body as string).model).toBe("model-from-env");
  });
});
