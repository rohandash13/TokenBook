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
  quantity: number; // D16: amountUsd = unit price x quantity
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

/** One page line that contains a traced value. line is 1-based; text is trimmed, max 200 chars. */
export interface PageHit {
  pageId: string;
  url: string;
  line: number;
  text: string;
}

export type RuleStatus = "proposed" | "active" | "rejected";

/** Tier 1 rule. expiresAt is epoch ms (D19). Proposal/approval flow is M3. */
export interface Rule {
  ruleId: string;
  payee: string;
  category: string;
  capUsd: number;
  taskType: string;
  expiresAt: number;
  createdBy: string;
  status: RuleStatus;
}

/** "verdict" = the decision for a payment request; "executor_failure" = follow-up block after a failed pay (D23). */
export type DecisionKind = "verdict" | "executor_failure";

export interface Decision {
  decisionId: string;
  paymentRequestId: string;
  taskId: string;
  kind: DecisionKind;
  tier: 1 | 2 | null; // null = no tier ran (floor block, M1 hold, executor failure)
  verdict: Verdict;
  ruleId?: string;
  fieldOrigins: Partial<Record<PaymentField, Origin>>;
  evidence: Partial<Record<PaymentField, PageHit[]>>;
  amountUsd: number;
  payeeDomain: string;
  category: string | null;
  floorReasons: string[];
  judge?: { verdict: Verdict; reasons: string[] };
  reasons: string[];
  latencyMs: number;
  costUsd: number | null; // null = real cost unknown (D19)
  createdAt: number;
  prevHash: string;
  hash: string;
}

/** What callers hand to Store.appendDecision; the store fills prevHash and hash. */
export type DecisionDraft = Omit<Decision, "prevHash" | "hash">;
