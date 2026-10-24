import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseApprovers, type ApproverConfig, type AttackCase } from "@countersign/rules";
import type { Hold, HoldStatus, Store } from "@countersign/shared";
import { ToolError, parseInput } from "./common";
import type { Executor } from "./executor";

export function loadApproversFile(path: string | URL): ApproverConfig {
  return parseApprovers(JSON.parse(readFileSync(path, "utf8")));
}

/** What the worker sees for a hold (D33). */
export interface HoldView {
  holdId: string;
  decisionId: string;
  status: HoldStatus;
  reason: string;
  data?: unknown;
}

export function holdView(h: Hold): HoldView {
  const base = { holdId: h.holdId, decisionId: h.decisionId };
  if (h.status === "open") return { ...base, status: "open", reason: `held for review by ${h.routedTo}` };
  if (h.status === "rejected") return { ...base, status: "rejected", reason: `rejected by ${h.resolvedBy ?? "an approver"}` };
  // Approved, but the payment has not finished: the worker keeps waiting.
  if (!h.payment) return { ...base, status: "open", reason: `approved by ${h.resolvedBy ?? "an approver"}; payment in progress` };
  return {
    ...base,
    status: "approved",
    reason: h.payment.reason,
    ...(h.payment.status === "settled" ? { data: h.payment.data } : {}),
  };
}

const GetHoldSchema = z.object({ taskId: z.string().min(1), decisionId: z.string().min(1) });

export interface HoldToolDeps {
  store: Store;
  executor: Executor;
  ruleTtlMs: number;
  attackCorpus: AttackCase[];
}

export function createHoldTools(deps: HoldToolDeps) {
  const { store } = deps;
  return {
    /** Worker tool (D33). 404 unless this task owns a held decision; no existence leak. */
    async getHold(input: unknown): Promise<HoldView> {
      const { taskId, decisionId } = parseInput(GetHoldSchema, input);
      const hold = await store.getHoldByDecision(decisionId);
      if (!hold || hold.taskId !== taskId) throw new ToolError("HOLD_NOT_FOUND", `no hold for decision ${decisionId} in this task`);
      return holdView(hold);
    },
  };
}

export type HoldTools = ReturnType<typeof createHoldTools>;
