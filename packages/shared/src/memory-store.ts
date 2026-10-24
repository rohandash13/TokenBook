import { GENESIS_HASH, hashDecision } from "./decision-log";
import type { Store } from "./store";
import type { Decision, DecisionDraft, Hold, HoldPatch, HoldStatus, Page, Plan, Quote, Rule, Task } from "./types";

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  private last = 0;
  private tasks = new Map<string, Task>();
  private plans = new Map<string, Plan>();
  private pages: Page[] = [];
  private quotes: Quote[] = [];
  private decisions: Decision[] = [];
  private rules = new Map<string, Rule>();
  private holds = new Map<string, Hold>();

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

  /** Single-threaded JS: read-last-then-push has no await in between, so it is atomic. */
  async appendDecision(draft: DecisionDraft) {
    const prevHash = this.decisions.at(-1)?.hash ?? GENESIS_HASH;
    const body = copy(draft);
    const decision: Decision = { ...body, prevHash, hash: hashDecision(prevHash, body) };
    this.decisions.push(decision);
    return copy(decision);
  }
  async listDecisions() { return this.decisions.map(copy); }
  async getDecision(decisionId: string) {
    const d = this.decisions.find((x) => x.decisionId === decisionId);
    return d && copy(d);
  }

  async putRule(rule: Rule) { this.rules.set(rule.ruleId, copy(rule)); }
  async listRules() { return [...this.rules.values()].map(copy); }

  async putHold(hold: Hold) {
    if (this.holds.has(hold.holdId) || [...this.holds.values()].some((h) => h.decisionId === hold.decisionId)) {
      throw new Error(`a hold already exists for hold ${hold.holdId} or decision ${hold.decisionId}`);
    }
    this.holds.set(hold.holdId, copy(hold));
  }
  async getHold(holdId: string) { const h = this.holds.get(holdId); return h && copy(h); }
  async getHoldByDecision(decisionId: string) {
    const h = [...this.holds.values()].find((x) => x.decisionId === decisionId);
    return h && copy(h);
  }
  async listHolds(filter: { status?: HoldStatus } = {}) {
    return [...this.holds.values()].filter((h) => !filter.status || h.status === filter.status).map(copy);
  }
  /** No await between read and write: atomic in single-threaded JS. */
  async updateHold(holdId: string, from: HoldStatus, patch: HoldPatch) {
    const current = this.holds.get(holdId);
    if (!current || current.status !== from) return undefined;
    const next: Hold = { ...current, ...copy(patch), holdId: current.holdId, decisionId: current.decisionId, taskId: current.taskId };
    this.holds.set(holdId, next);
    return copy(next);
  }
}
