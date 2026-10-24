export interface ToolResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface GatewayClient {
  declarePlan(taskId: string, plan: unknown): Promise<ToolResult>;
  fetchUrl(taskId: string, url: string): Promise<ToolResult>;
  payAndFetch(taskId: string, req: unknown): Promise<ToolResult>;
  llm(body: Record<string, unknown>): Promise<ToolResult>;
}

export function createGatewayClient(baseUrl: string): GatewayClient {
  async function post(path: string, body: unknown): Promise<ToolResult> {
    const res = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }
  return {
    declarePlan: (taskId, plan) => post("/tools/declare_plan", { taskId, plan }),
    fetchUrl: (taskId, url) => post("/tools/fetch_url", { taskId, url }),
    payAndFetch: (taskId, req) => post("/tools/pay_and_fetch", { taskId, req }),
    llm: (body) => post("/llm/messages", body),
  };
}
