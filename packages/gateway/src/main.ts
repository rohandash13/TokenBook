import { readFileSync } from "node:fs";
import { MemoryStore } from "@countersign/shared";
import { SimulatedExecutor } from "./executor";
import { createLlmProxy } from "./llm-proxy";
import { createGatewayApp } from "./server";
import { createTools } from "./tools";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }
const env = process.env;

if ((env.EXECUTOR ?? "simulated") !== "simulated") {
  throw new Error("Only EXECUTOR=simulated exists in M1; the real x402 executor lands after B's M0 test");
}
if (!env.SIM_PAYER_SECRET) throw new Error("SIM_PAYER_SECRET is required (see .env.example)");

const { fetchHosts } = JSON.parse(
  readFileSync(new URL("../../../config/allowlist.json", import.meta.url), "utf8"),
) as { fetchHosts: string[] };

const executor = new SimulatedExecutor(env.SIM_PAYER_SECRET);
const tools = createTools({ store: new MemoryStore(), executor, fetchHosts });
const llm =
  env.ANTHROPIC_API_KEY && env.WORKER_MODEL
    ? createLlmProxy({ apiKey: env.ANTHROPIC_API_KEY, model: env.WORKER_MODEL })
    : undefined;
const port = Number(env.GATEWAY_PORT ?? 4000);

createGatewayApp(tools, llm).listen(port, () => {
  console.log(
    `[gateway] http://localhost:${port}  executor=${executor.kind.toUpperCase()}  llm=${llm ? "on" : "off"}  fetchHosts=${fetchHosts.join(",")}`,
  );
});
