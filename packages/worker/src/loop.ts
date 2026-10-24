import type { GatewayClient, ToolResult } from "./gateway-client";

export const SYSTEM_PROMPT =
  "You are a worker agent buying data for a task. Your only tools are declare_plan, fetch_url and pay_and_fetch. " +
  "Call declare_plan first, before reading any page. If a payment comes back held or blocked, stop and report it; do not retry.";

export const TOOL_DEFS = [
  {
    name: "declare_plan",
    description: "Declare what you intend to buy, before reading any page. Required first step. Cannot be changed later.",
    input_schema: {
      type: "object",
      properties: {
        plan: {
          type: "object",
          properties: {
            goal: { type: "string" },
            expected: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  maxUnitUsd: { type: "number" },
                  maxQuantity: { type: "integer" },
                  vendorDomains: { type: "array", items: { type: "string" } },
                  tiers: { type: "array", items: { type: "string" } },
                },
                required: ["category", "maxUnitUsd", "maxQuantity", "vendorDomains"],
              },
            },
          },
          required: ["goal", "expected"],
        },
      },
      required: ["plan"],
    },
  },
  {
    name: "fetch_url",
    description: "Read a web page. Only works after declare_plan.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "pay_and_fetch",
    description: "Pay for and fetch a paid API resource. Countersign decides approve, hold or block.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        payeeDomain: { type: "string" },
        amountUsd: { type: "number" },
        tier: { type: "string" },
        quantity: { type: "integer" },
        purpose: { type: "string" },
      },
      required: ["url", "payeeDomain", "amountUsd", "purpose"],
    },
  },
];

/** taskId always comes from the launcher, never from model output. */
export async function callTool(client: GatewayClient, taskId: string, name: string, input: any): Promise<ToolResult> {
  switch (name) {
    case "declare_plan":
      return client.declarePlan(taskId, input?.plan);
    case "fetch_url":
      return client.fetchUrl(taskId, input?.url);
    case "pay_and_fetch":
      return client.payAndFetch(taskId, input);
    default:
      return { ok: false, status: 400, body: { error: { code: "UNKNOWN_TOOL", message: `no tool named ${name}` } } };
  }
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

export async function runWorker(opts: {
  client: GatewayClient;
  taskId: string;
  taskText: string;
  maxTurns?: number;
}): Promise<{ finalText: string; transcript: unknown[]; exhausted?: boolean }> {
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: `Task: ${opts.taskText}` },
  ];
  for (let turn = 0; turn < (opts.maxTurns ?? 12); turn++) {
    const r = await opts.client.llm({ max_tokens: 1024, system: SYSTEM_PROMPT, tools: TOOL_DEFS, messages });
    if (!r.ok) throw new Error(`LLM call failed: ${r.status} ${JSON.stringify(r.body)}`);
    const msg = r.body as { content: ContentBlock[]; stop_reason: string };
    messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason !== "tool_use") {
      const finalText = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return { finalText, transcript: messages };
    }
    const results = [];
    for (const block of msg.content.filter((b) => b.type === "tool_use")) {
      try {
        const out = await callTool(opts.client, opts.taskId, block.name ?? "", block.input);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out.body), is_error: !out.ok });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: { code: "TOOL_CALL_FAILED", message } }),
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { finalText: "max turns reached", transcript: messages, exhausted: true };
}
