import express, { type Express } from "express";
import type { LlmProxy } from "./llm-proxy";
import { ToolError, type ToolErrorCode, type Tools } from "./tools";

const STATUS: Record<ToolErrorCode, number> = {
  BAD_INPUT: 400,
  HOST_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  PLAN_REQUIRED: 409,
  PLAN_EXISTS: 409,
  UPSTREAM_FAILED: 502,
};

export function createGatewayApp(tools: Tools, llm?: LlmProxy): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const route = (path: string, handler: (body: unknown) => Promise<unknown>) => {
    app.post(path, async (req, res) => {
      try {
        res.json(await handler(req.body));
      } catch (e) {
        if (e instanceof ToolError) {
          res.status(STATUS[e.code]).json({ error: { code: e.code, message: e.message } });
        } else {
          console.error(`[gateway] ${path}`, e);
          res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
        }
      }
    });
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Operator side. Unauthenticated by design for the hackathon (D13).
  route("/admin/tasks", tools.createTask);

  // Worker side: the only three tools.
  route("/tools/declare_plan", tools.declarePlan);
  route("/tools/fetch_url", tools.fetchUrl);
  route("/tools/pay_and_fetch", tools.payAndFetch);

  app.post("/llm/messages", async (req, res) => {
    if (!llm) {
      res.status(503).json({ error: { code: "LLM_DISABLED", message: "gateway has no ANTHROPIC_API_KEY/WORKER_MODEL" } });
      return;
    }
    try {
      const out = await llm(req.body ?? {});
      res.status(out.status).json(out.json);
    } catch (e) {
      console.error("[gateway] /llm/messages", e);
      res.status(502).json({ error: { code: "UPSTREAM_FAILED", message: "LLM call failed" } });
    }
  });

  return app;
}
