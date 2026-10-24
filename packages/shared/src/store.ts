import type { Decision, DecisionDraft, Hold, HoldPatch, HoldStatus, Page, Plan, Quote, Rule, Task } from "./types";

/** Persistence boundary. MemoryStore now; a Convex adapter implements the same interface later (D5). */
export interface Store {
  /** Strictly increasing timestamp source, so ordering checks (plan before page) are reliable. */
  now(): number;
  putTask(task: Task): Promise<void>;
  getTask(taskId: string): Promise<Task | undefined>;
  /** Atomic insert-if-absent. Returns false if the task already has a plan. */
  insertPlan(plan: Plan): Promise<boolean>;
  getPlan(taskId: string): Promise<Plan | undefined>;
  putPage(page: Page): Promise<void>;
  listPages(taskId: string): Promise<Page[]>;
  putQuote(quote: Quote): Promise<void>;
  listQuotes(taskId: string): Promise<Quote[]>;
  /** Append-only (D18). Atomically sets prevHash from the last appended decision and computes hash. */
  appendDecision(draft: DecisionDraft): Promise<Decision>;
  /** Every decision in append order, all tasks. */
  listDecisions(): Promise<Decision[]>;
  getDecision(decisionId: string): Promise<Decision | undefined>;
  /** Upsert by ruleId. */
  putRule(rule: Rule): Promise<void>;
  listRules(): Promise<Rule[]>;
  /** Compare-and-set: applies patch only if the rule's status is `from` (a patch may keep the status). ruleId never changes. Undefined if missing or changed. */
  updateRule(ruleId: string, from: Rule["status"], patch: Partial<Rule>): Promise<Rule | undefined>;
  /** Insert. Throws if this holdId or decisionId already has a hold (one hold per held decision, D27). */
  putHold(hold: Hold): Promise<void>;
  getHold(holdId: string): Promise<Hold | undefined>;
  getHoldByDecision(decisionId: string): Promise<Hold | undefined>;
  /** Insertion order. */
  listHolds(filter?: { status?: HoldStatus }): Promise<Hold[]>;
  /** Compare-and-set: applies patch only if the hold's status is `from`. Undefined if missing or changed (D28). */
  updateHold(holdId: string, from: HoldStatus, patch: HoldPatch): Promise<Hold | undefined>;
}
