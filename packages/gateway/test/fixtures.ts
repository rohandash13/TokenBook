import type { Page, PaymentRequest, Plan, PlanItem, Rule, Task } from "@countersign/shared";
import { traceFields, type CatalogEntry, type QuoteInfo, type TraceInput, type TraceResult } from "@countersign/gateway";

export const HOST = "vendor.test:4101";

export const CATALOG: CatalogEntry[] = [
  { pathPrefix: "/api/weather", category: "weather" },
  { pathPrefix: "/api/forecast", category: "weather" },
  { pathPrefix: "/api/crypto", category: "crypto-prices" },
];

export function mkTask(text = "Get the weather in Berkeley", over: Partial<Task> = {}): Task {
  return { taskId: "t1", text, budgetUsd: 20, taskType: "data-lookup", createdAt: 1, ...over };
}

export function mkPlan(item: Partial<PlanItem> = {}, extra: PlanItem[] = []): Plan {
  return {
    taskId: "t1",
    goal: "current weather for Berkeley",
    expected: [
      { category: "weather", maxUnitUsd: 0.1, maxQuantity: 2, vendorDomains: [HOST], tiers: ["basic"], ...item },
      ...extra,
    ],
    declaredAt: 2,
  };
}

export function mkPage(path: string, lines: string[], pageId = "p1"): Page {
  return { pageId, taskId: "t1", url: `http://${HOST}${path}`, lines, fetchedAt: 3 };
}

export function mkQuote(over: Partial<QuoteInfo> = {}): QuoteInfo {
  return {
    payeeDomain: HOST,
    amountUsd: 0.1,
    amountAtomic: "100000",
    tier: "basic",
    unit: "call",
    quantity: 1,
    resource: "/api/weather?tier=basic",
    raw: {},
    ...over,
  };
}

export function mkReq(over: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    url: `http://${HOST}/api/weather?tier=basic`,
    payeeDomain: HOST,
    amountUsd: 0.1,
    tier: "basic",
    quantity: 1,
    purpose: "weather for Berkeley",
    ...over,
  };
}

/** A clean, legit basic purchase unless overridden. */
export function mkTrace(over: Partial<TraceInput> = {}): TraceResult {
  return traceFields({
    task: mkTask(),
    plan: mkPlan(),
    pages: [],
    quote: mkQuote(),
    req: mkReq(),
    catalog: CATALOG,
    ...over,
  });
}

export function mkRule(over: Partial<Rule> = {}): Rule {
  return {
    ruleId: "rule-1",
    payee: HOST,
    category: "weather",
    capUsd: 1,
    taskType: "data-lookup",
    expiresAt: Date.now() + 3_600_000,
    createdBy: "test",
    status: "active",
    ...over,
  };
}
