import type { z } from "zod";
import { canonical, sha256Hex, toAtomic, type PaymentRequest } from "@countersign/shared";

/** Shared by tools.ts and holds.ts (kept apart so holds.ts never imports tools.ts). */
export type ToolErrorCode =
  | "BAD_INPUT"
  | "TASK_NOT_FOUND"
  | "PLAN_REQUIRED"
  | "PLAN_EXISTS"
  | "HOST_NOT_ALLOWED"
  | "UPSTREAM_FAILED"
  | "HOLD_NOT_FOUND"
  | "HOLD_NOT_OPEN"
  | "BUDGET_EXCEEDED"
  | "RULE_NOT_FOUND"
  | "RULE_STATE"
  | "REPLAY_FAILED";

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const EXECUTOR_FAILED_PREFIX = "executor failed";

/** Payment-relevant fields only; callers supply quote-charged amount/tier/quantity. Purpose never affects identity. */
export function idempotencyKey(taskId: string, payee: string, req: PaymentRequest): string {
  return sha256Hex(taskId + "|" + canonical({ url: req.url, payeeDomain: payee, amountAtomic: toAtomic(req.amountUsd), tier: req.tier ?? null, quantity: req.quantity ?? 1 }));
}

export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ToolError("BAD_INPUT", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}
