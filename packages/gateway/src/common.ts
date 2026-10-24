import type { z } from "zod";
import { canonical, sha256Hex, type PaymentRequest } from "@countersign/shared";

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

/** Spec section 8: sha256(taskId + payeeDomain + requestHash). Same request -> same key. */
export function idempotencyKey(taskId: string, payee: string, req: PaymentRequest): string {
  return sha256Hex(taskId + payee + canonical(req));
}

export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ToolError("BAD_INPUT", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}
