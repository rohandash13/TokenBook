export interface ToolResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface GatewayClient {
  declarePlan(taskId: string, plan: unknown): Promise<ToolResult>;
  fetchUrl(taskId: string, url: string): Promise<ToolResult>;
  payAndFetch(taskId: string, req: unknown): Promise<ToolResult>;
  /** Not a model tool: the loop polls it while a payment is held (D33). */
  getHold(taskId: string, decisionId: string, opts?: { timeoutMs?: number }): Promise<ToolResult>;
  llm(body: Record<string, unknown>): Promise<ToolResult>;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function createGatewayClient(baseUrl: string, cfg: { requestTimeoutMs?: number } = {}): GatewayClient {
  const requestTimeoutMs =
    typeof cfg.requestTimeoutMs === "number" && Number.isFinite(cfg.requestTimeoutMs) && cfg.requestTimeoutMs > 0
      ? cfg.requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  async function post(path: string, body: unknown, timeoutMs = requestTimeoutMs): Promise<ToolResult> {
    const res = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, timeoutMs))),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }
  return {
    declarePlan: (taskId, plan) => post("/tools/declare_plan", { taskId, plan }),
    fetchUrl: (taskId, url) => post("/tools/fetch_url", { taskId, url }),
    payAndFetch: (taskId, req) => post("/tools/pay_and_fetch", { taskId, req }),
    getHold: (taskId, decisionId, opts) => post("/tools/get_hold", { taskId, decisionId }, opts?.timeoutMs),
    llm: (body) => post("/llm/messages", body),
  };
}
