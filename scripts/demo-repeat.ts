/** Operator helper: one new crypto purchase after activating its rule in the dashboard. No model call. */
const gateway = "http://127.0.0.1:4000";
const host = "127.0.0.1:4101";
async function post(path: string, body: unknown) {
  const res = await fetch(gateway+path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`); return data;
}
const { taskId } = await post("/admin/tasks", { text: "Get crypto prices for ETH", budgetUsd: 1, taskType: "data-lookup" });
await post("/tools/declare_plan", { taskId, plan: { goal: "Get crypto prices", expected: [{ category: "crypto-prices", maxUnitUsd: .1, maxQuantity: 1, tiers: ["basic"], vendorDomains: [host] }] } });
console.log(await post("/tools/pay_and_fetch", { taskId, req: { url: `http://${host}/api/crypto?symbol=ETH`, payeeDomain: host, amountUsd: .1, tier: "basic", quantity: 1, purpose: "Requested crypto lookup" } }));
export {};
