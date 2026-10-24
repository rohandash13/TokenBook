import express, { type Express, type Response } from "express";
import type { LlmProxy } from "./llm-proxy";
import { ToolError, type ToolErrorCode, type Tools } from "./tools";

const STATUS: Record<ToolErrorCode, number> = {
  BAD_INPUT: 400,
  HOST_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
  RULE_NOT_FOUND: 404,
  PLAN_REQUIRED: 409,
  PLAN_EXISTS: 409,
  HOLD_NOT_OPEN: 409,
  BUDGET_EXCEEDED: 409,
  RULE_STATE: 409,
  REPLAY_FAILED: 409,
  UPSTREAM_FAILED: 502,
};

export function createGatewayApp(tools: Tools, llm?: LlmProxy): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  async function respond(res: Response, label: string, run: () => Promise<unknown>) {
    try {
      res.json(await run());
    } catch (e) {
      if (e instanceof ToolError) {
        res.status(STATUS[e.code]).json({
          error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) },
        });
      } else {
        console.error(`[gateway] ${label}`, e);
        res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
      }
    }
  }

  const route = (path: string, handler: (body: unknown) => Promise<unknown>) => {
    app.post(path, (req, res) => respond(res, path, () => handler(req.body)));
  };

  const bodyObject = (body: unknown): Record<string, unknown> =>
    body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Operator side. ALL /admin routes are unauthenticated by design for the hackathon (D13, D34):
  // the approver is just a name in the request body; routing decides whose queue a hold appears in, it does not authenticate.
  route("/admin/tasks", tools.createTask);
  app.get("/admin/holds", (req, res) =>
    respond(res, "GET /admin/holds", () => tools.listHolds(req.query.status === undefined ? {} : { status: req.query.status })),
  );
  app.post("/admin/holds/:holdId/approve", (req, res) =>
    respond(res, "approve hold", () => tools.approveHold({ ...bodyObject(req.body), holdId: req.params.holdId })),
  );
  app.post("/admin/holds/:holdId/reject", (req, res) =>
    respond(res, "reject hold", () => tools.rejectHold({ ...bodyObject(req.body), holdId: req.params.holdId })),
  );
  app.get("/admin/rules", (req, res) =>
    respond(res, "GET /admin/rules", () => tools.listRules(req.query.status === undefined ? {} : { status: req.query.status })),
  );
  app.post("/admin/rules/:ruleId/activate", (req, res) =>
    respond(res, "activate rule", () => tools.activateRule({ ...bodyObject(req.body), ruleId: req.params.ruleId })),
  );
  app.post("/admin/rules/:ruleId/reject", (req, res) =>
    respond(res, "reject rule", () => tools.rejectRule({ ...bodyObject(req.body), ruleId: req.params.ruleId })),
  );

  // Worker side: the model-facing tools (declare_plan, fetch_url, pay_and_fetch) plus get_hold.
  route("/tools/declare_plan", tools.declarePlan);
  route("/tools/fetch_url", tools.fetchUrl);
  route("/tools/pay_and_fetch", tools.payAndFetch);
  // Not a model tool: the worker loop polls it while a payment is held (D33).
  route("/tools/get_hold", tools.getHold);

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

  // Express's own errors (body-parser) would otherwise render HTML.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { type?: string; status?: number; statusCode?: number; message?: string };
    const status = e.status ?? e.statusCode;
    const clientError = typeof e.type === "string" && e.type.startsWith("entity.") || (typeof status === "number" && status >= 400 && status < 500);
    if (clientError) {
      res.status(typeof status === "number" && status >= 400 && status < 500 ? status : 400).json({ error: { code: "BAD_INPUT", message: e.message ?? "bad request" } });
      return;
    }
    console.error("[gateway]", err);
    res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
  });

  return app;
}
