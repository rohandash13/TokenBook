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
  reused?: boolean;
  savedUsd?: number;
}

/** One page line that contains a traced value. line is 1-based; text is trimmed, max 200 chars. */
export interface PageHit {
  pageId: string;
  url: string;
  line: number;
  text: string;
}

export type RuleStatus = "proposed" | "active" | "rejected";

/** What replay found for a candidate rule (spec §9, D30). Every count comes from a real run. */
export interface ReplayResult {
  ranAt: number;
  decisionsChecked: number;
  attacksChecked: number;
  casesChecked: number; // decisionsChecked + attacksChecked
  wouldAutoApprove: number;
  newlyAutoApproved: number;
  knownBadMatched: Array<{ decisionId: string; why: string }>;
  attacksMatched: Array<{ caseId: string; name: string }>;
  summary: string; // "N cases, M attacks matched, K known-bad matched"
}

/** Tier 1 rule. expiresAt is epoch ms (D19). Proposed from an approved hold, activated after replay (M3). */
export interface Rule {
  ruleId: string;
  payee: string;
  category: string;
  capUsd: number;
  taskType: string;
  expiresAt: number;
  createdBy: string;
  status: RuleStatus;
  replayResult?: ReplayResult;
  sourceHoldId?: string;
  resolvedBy?: string; // who activated or rejected it
  resolvedAt?: number;
}

/**
 * "verdict" = the decision for a payment request; "executor_failure" = follow-up block after a failed pay (D23);
 * "human_approval" / "human_rejection" = an approver resolved a hold (D28).
 */
export type DecisionKind = "verdict" | "executor_failure" | "human_approval" | "human_rejection" | "duplicate_reused" | "payment_unconfirmed";

export interface Decision {
  decisionId: string;
  paymentRequestId: string;
  taskId: string;
  kind: DecisionKind;
  tier: 1 | 2 | null; // null = no tier ran (floor block, M1 hold, executor failure)
  verdict: Verdict;
  ruleId?: string;
  linkedDecisionId?: string; // human decisions and their executor failures: the decision they resolve (D28)
  fieldOrigins: Partial<Record<PaymentField, Origin>>;
  evidence: Partial<Record<PaymentField, PageHit[]>>;
  amountUsd: number;
  payeeDomain: string;
  category: string | null;
  floorReasons: string[];
  savedUsd?: number;
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

export type HoldStatus = "open" | "approved" | "rejected";

/** Result of executing an approved hold. decisionId = the human_approval (settled) or executor_failure (failed) decision. */
export interface HoldPayment {
  status: "settled" | "failed" | "unknown";
  reason: string;
  data?: unknown;
  decisionId: string;
}

/** One per held verdict decision (D27). */
export interface Hold {
  holdId: string;
  decisionId: string;
  taskId: string;
  routedTo: string;
  status: HoldStatus;
  /** The exact request, so an approval pays with the same idempotency key as the original attempt. */
  req: PaymentRequest;
  /** The stored quote the approval pays against. */
  quoteId: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  resolutionDecisionId?: string;
  payment?: HoldPayment;
  proposedRuleId?: string;
}

/** Fields an update may change. holdId, decisionId and taskId never change. */
export type HoldPatch = Partial<Omit<Hold, "holdId" | "decisionId" | "taskId">>;

export interface Reservation {
  reservationId: string; taskId: string; paymentRequestId: string; amountUsd: number;
  state: "reserved" | "committed" | "released"; createdAt: number; updatedAt: number;
}
export interface PaymentRecord {
  idempotencyKey: string; taskId: string; firstDecisionId: string;
  state: "pending" | "settled" | "failed" | "unknown";
  reservationId?: string; receiptId?: string; result?: unknown;
  createdAt: number; updatedAt: number;
}
export interface Receipt {
  receiptId: string; decisionId: string; taskId: string; quotedUsd: number; paidUsd: number | null;
  deliveryStatus: "ok" | "empty" | "bad_format" | "unknown"; amountMismatch: boolean;
  reasons: string[]; txRef: string | null; simulated: boolean; createdAt: number;
}
export interface Payee {
  payeeId: string; domain: string; crsStatus: "unchecked" | "approved_vendor" | "failed";
  liens: number; ofacHit: boolean; firstSeenAt: number; deliveryFailures: number;
  checkNote?: string;
}
