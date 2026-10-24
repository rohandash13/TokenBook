import { WORKER_MAIN, spawnWorker } from "./launcher";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }

const gatewayUrl = process.env.GATEWAY_URL ?? "http://127.0.0.1:4000";
const arenaPort = process.env.ARENA_PORT ?? "4101";
const text =
  process.argv.slice(2).join(" ") ||
  `Get the current weather for Berkeley from WeatherCo. Docs: http://127.0.0.1:${arenaPort}/docs. Budget $1.`;

const res = await fetch(new URL("/admin/tasks", gatewayUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text, budgetUsd: 1, taskType: "data-lookup" }),
});
if (!res.ok) throw new Error(`could not create task: ${res.status} ${await res.text()}`);
const { taskId } = (await res.json()) as { taskId: string };
console.log(`[run] task ${taskId}; spawning isolated worker`);

const child = spawnWorker(WORKER_MAIN, [], { GATEWAY_URL: gatewayUrl, TASK_ID: taskId, TASK_TEXT: text }, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
