export type Origin = "TASK" | "PLAN" | "QUOTE" | "PAGE" | "UNKNOWN";
export type Verdict = "approve" | "hold" | "block";
export type PaymentField = "payee" | "amount" | "tier" | "quantity" | "category";

export interface Task {
  taskId: string;
  text: string;
  budgetUsd: number;
  taskType: string;
  createdAt: number;
}

export interface PlanItem {
  category: string;
  maxUnitUsd: number;
  maxQuantity: number;
  vendorDomains: string[];
  tiers?: string[]; // DECISIONS D2
}

/** Immutable once inserted. declaredAt precedes every page fetch for the task. */
export interface Plan {
  taskId: string;
  goal: string;
  expected: PlanItem[];
  declaredAt: number;
}

/** Line-indexed so the trace view can point at "page line N". */
export interface Page {
  pageId: string;
  taskId: string;
  url: string;
  lines: string[];
  fetchedAt: number;
}

/** Built from the vendor's 402 payment-required response. */
export interface Quote {
  quoteId: string;
  taskId: string;
  payeeDomain: string;
  amountUsd: number;
  tier: string | null;
  unit: string;
  rawRequirements: unknown;
  receivedAt: number;
}

export interface PaymentRequest {
  url: string;
  payeeDomain: string;
  amountUsd: number;
  tier?: string;
  quantity?: number;
  purpose: string; // agent free text: UI only, never evidence
}

export interface PayResult {
  status: "approved" | "held" | "blocked";
  reason: string;
  data?: unknown;
  decisionId: string;
}

export interface Decision {
  decisionId: string;
  paymentRequestId: string;
  taskId: string;
  tier: 1 | 2 | null; // null = no tier ran (M1 fail-closed)
  verdict: Verdict;
  ruleId?: string;
  fieldOrigins: Partial<Record<PaymentField, Origin>>;
  reasons: string[];
  latencyMs: number;
  costUsd: number;
  createdAt: number;
}
