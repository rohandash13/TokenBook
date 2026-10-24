import { randomUUID } from "node:crypto";
import { createLegitVendor } from "@countersign/arena";
import { createGatewayApp, createTools, loadCatalogFile, loadApproversFile, SimulatedExecutor, createPayeeChecker } from "@countersign/gateway";
import { MemoryStore } from "@countersign/shared";
import { once } from "node:events";
const secret = randomUUID(); // Ephemeral simulated-payment proof; never written to disk.
const arenaPort = Number(process.env.ARENA_PORT ?? 4101), gatewayPort = Number(process.env.GATEWAY_PORT ?? 4000);
const arena = createLegitVendor({ simPayerSecret: secret }).listen(arenaPort, "127.0.0.1");
await once(arena, "listening");
const host = `127.0.0.1:${arenaPort}`, origin = `http://${host}`;
const store = new MemoryStore();
const tools = createTools({ store, executor: new SimulatedExecutor(secret), fetchHosts: [host], catalog: loadCatalogFile(new URL("../config/catalog.json", import.meta.url)), payeeAllowlist: [], approvers: loadApproversFile(new URL("../config/approvers.json", import.meta.url)), checkPayee: createPayeeChecker(store, [host]) });
const gateway = createGatewayApp(tools).listen(gatewayPort,"127.0.0.1");
await once(gateway,"listening");
async function purchase(category: string, path: string, amountUsd: number, taskText: string, options: { upsell?: boolean; quantity?: number; learn?: boolean } = {}) {
  const task = await tools.createTask({ text: taskText, budgetUsd: 20, taskType: category === "research" ? "research" : "data-lookup" });
  const taskId = task.taskId;
  await tools.declarePlan({ taskId, plan: { goal: taskText, expected: [{ category, maxUnitUsd: category === "research" ? 5 : .1, maxQuantity: 2, tiers: ["basic"], vendorDomains: [host] }] } });
  if (options.upsell) await tools.fetchUrl({ taskId, url: origin+"/docs/upsell" });
  const req = { url: origin+path, payeeDomain: host, amountUsd, tier: options.upsell ? "premium" : "basic", quantity: options.quantity ?? 1, purpose: "Demo purchase in our simulated arena" };
  const result = await tools.payAndFetch({ taskId, req });
  if (options.learn && result.status === "held") {
    const hold = (await store.getHoldByDecision(result.decisionId))!;
    const approved = await tools.approveHold({ holdId: hold.holdId, approver: "Simulated demo approver" });
    if (approved.proposedRule) await tools.activateRule({ ruleId: approved.proposedRule.ruleId, approver: "Simulated demo approver" });
  }
  return { taskId, req };
}
await purchase("weather", "/api/weather?city=Berkeley", .1, "Get the weather in Berkeley", { learn: true });
await purchase("weather", "/api/weather?city=Oakland&qty=2", .2, "Get two weather calls for Oakland", { quantity: 2, learn: true });
for (const city of ["Albany","Davis","Fremont"]) await purchase("weather", `/api/weather?city=${city}`, .1, `Get the weather in ${city}`);
const report = await purchase("research", "/api/report?topic=agents", 5, "Get a research report about agents", { learn: true });
await tools.payAndFetch({ ...report, req: { ...report.req, purpose: "Same report, different wording" } });
await purchase("crypto-prices", "/api/crypto?symbol=BTC", .1, "Get crypto prices for BTC");
await purchase("weather", "/api/weather?tier=premium&city=Berkeley", 15, "Get the weather in Berkeley", { upsell: true });
console.log(`[demo] Arena ${origin}; gateway http://127.0.0.1:${gatewayPort}`);
console.log("[demo] SIMULATED payments; Tier 2 disabled; seeded human approvals are simulated. No API calls or secrets needed.");
console.log("[demo] Open dashboard: pnpm dev:dashboard. Trace the premium hold; approve the new crypto purchase and activate its rule.");
const shutdown = () => { gateway.close(); arena.close(); };
process.on("SIGINT",shutdown); process.on("SIGTERM",shutdown);
