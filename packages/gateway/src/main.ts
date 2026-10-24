import { readFileSync } from "node:fs";
import { MemoryStore } from "@countersign/shared";
import { loadCatalogFile } from "./catalog";
import { SimulatedExecutor } from "./executor";
import { judgeFromEnv } from "./judge";
import { createLlmProxy } from "./llm-proxy";
import { createGatewayApp } from "./server";
import { createTools } from "./tools";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }
const env = process.env;

if ((env.EXECUTOR ?? "simulated") !== "simulated") {
  throw new Error("Only EXECUTOR=simulated exists so far; the real x402 executor lands after B's M0 test");
}
if (!env.SIM_PAYER_SECRET) throw new Error("SIM_PAYER_SECRET is required (see .env.example)");

const { fetchHosts, payeeAllowlist = [] } = JSON.parse(
  readFileSync(new URL("../../../config/allowlist.json", import.meta.url), "utf8"),
) as { fetchHosts: string[]; payeeAllowlist?: string[] };
const catalog = loadCatalogFile(new URL("../../../config/catalog.json", import.meta.url));

const executor = new SimulatedExecutor(env.SIM_PAYER_SECRET);
const judge = judgeFromEnv(env);
const tools = createTools({ store: new MemoryStore(), executor, fetchHosts, catalog, payeeAllowlist, judge });
const llm =
  env.ANTHROPIC_API_KEY && env.WORKER_MODEL
    ? createLlmProxy({ apiKey: env.ANTHROPIC_API_KEY, model: env.WORKER_MODEL })
    : undefined;
const port = Number(env.GATEWAY_PORT ?? 4000);
const host = env.GATEWAY_HOST ?? "127.0.0.1";

createGatewayApp(tools, llm).listen(port, host, () => {
  console.log(
    `[gateway] http://${host}:${port}  executor=${executor.kind.toUpperCase()}  llm=${llm ? "on" : "off"}  judge=${judge ? "on" : "off (every Tier 2 case is HOLD)"}  fetchHosts=${fetchHosts.join(",")}  catalog=${catalog.length} entries`,
  );
});
