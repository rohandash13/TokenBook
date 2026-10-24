import { describe, expect, it } from "vitest";
import { createLlmProxy } from "@countersign/gateway";
import { WORKER_MAIN, spawnWorker } from "@countersign/worker/launch";
import { runToExit } from "./helpers/child";
import { createTestTask, startStack } from "./helpers/stack";

try { process.loadEnvFile(); } catch { /* no .env */ }
const { ANTHROPIC_API_KEY, WORKER_MODEL } = process.env;

describe("M1 live: a real Claude worker in an isolated process", () => {
  it.skipIf(!ANTHROPIC_API_KEY || !WORKER_MODEL)(
    "declares a plan through the gateway and every payment it attempts is held",
    async () => {
      const s = await startStack({ llm: createLlmProxy({ apiKey: ANTHROPIC_API_KEY!, model: WORKER_MODEL! }) });
      try {
        const taskId = await createTestTask(s.gateway.url);
        const text = `Get the current weather for Berkeley from WeatherCo. Docs: ${s.arena.url}/docs. Vendor host: ${s.arena.host}. Budget $1.`;
        const child = spawnWorker(WORKER_MAIN, [], { GATEWAY_URL: s.gateway.url, TASK_ID: taskId, TASK_TEXT: text });
        const { code, stdout, stderr } = await runToExit(child, 110_000);
        console.log(stdout);
        expect(code, stderr).toBe(0);
        expect(await s.store.getPlan(taskId)).toBeDefined();
        expect(s.paySpy).not.toHaveBeenCalled();
      } finally {
        await s.close();
      }
    },
    120_000,
  );
});
