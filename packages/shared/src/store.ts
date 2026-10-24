import type { Decision, Page, Plan, Quote, Task } from "./types";

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
  putDecision(decision: Decision): Promise<void>;
  getDecision(decisionId: string): Promise<Decision | undefined>;
}
