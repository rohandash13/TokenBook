import { verifyChain, type Store } from "@countersign/shared";
import { budgetSnapshot } from "./settlement";
import { computeMetrics } from "./metrics";
import { ToolError } from "./common";
export function createReadTools(store: Store) {
  return {
    async listDecisions(taskId?: string) { return { decisions: (await store.listDecisions()).filter(d => !taskId || d.taskId === taskId).reverse() }; },
    async getDecision(id: string) { const decision = await store.getDecision(id); if (!decision) throw new ToolError("BAD_INPUT", "decision not found"); return { decision }; },
    async listReceipts(taskId?: string) { return { receipts: await store.listReceipts(taskId) }; },
    async getBudget(id: string) { const task = await store.getTask(id); if (!task) throw new ToolError("TASK_NOT_FOUND", "task not found"); return budgetSnapshot(store, id, task.budgetUsd); },
    async verifyChain() { const log = await store.listDecisions(); return { ...verifyChain(log), length: log.length, headHash: log.at(-1)?.hash ?? await store.getChainHead() }; },
    async listPayees() { return { payees: await store.listPayees() }; },
    async metrics() { return computeMetrics(store); },
  };
}
