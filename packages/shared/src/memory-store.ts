import type { Store } from "./store";
import type { Decision, Page, Plan, Quote, Task } from "./types";

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  private last = 0;
  private tasks = new Map<string, Task>();
  private plans = new Map<string, Plan>();
  private pages: Page[] = [];
  private quotes: Quote[] = [];
  private decisions = new Map<string, Decision>();

  now(): number {
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  async putTask(task: Task) { this.tasks.set(task.taskId, copy(task)); }
  async getTask(taskId: string) { const t = this.tasks.get(taskId); return t && copy(t); }

  async insertPlan(plan: Plan) {
    if (this.plans.has(plan.taskId)) return false;
    this.plans.set(plan.taskId, copy(plan));
    return true;
  }
  async getPlan(taskId: string) { const p = this.plans.get(taskId); return p && copy(p); }

  async putPage(page: Page) { this.pages.push(copy(page)); }
  async listPages(taskId: string) { return this.pages.filter((p) => p.taskId === taskId).map(copy); }

  async putQuote(quote: Quote) { this.quotes.push(copy(quote)); }
  async listQuotes(taskId: string) { return this.quotes.filter((q) => q.taskId === taskId).map(copy); }

  async putDecision(decision: Decision) { this.decisions.set(decision.decisionId, copy(decision)); }
  async getDecision(decisionId: string) { const d = this.decisions.get(decisionId); return d && copy(d); }
}
