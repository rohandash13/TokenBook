import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Operator-side. Builds the worker's entire environment from an allowlist (INV1, D8). */
export const WORKER_PASSTHROUGH_ENV = ["PATH", "SYSTEMROOT", "TEMP", "TMP"] as const;
export const WORKER_EXTRA_ENV = ["GATEWAY_URL", "TASK_ID", "TASK_TEXT"] as const;

/** Repo root, so `--import tsx` resolves regardless of the caller's cwd. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const WORKER_MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/** Windows env keys are case-insensitive ("Path" vs "PATH"), so match case-insensitively. */
function lookup(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const hit = Object.keys(env).find((k) => k.toUpperCase() === key);
  return hit === undefined ? undefined : env[hit];
}

export function buildWorkerEnv(parent: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of WORKER_PASSTHROUGH_ENV) {
    const value = lookup(parent, key);
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!(WORKER_EXTRA_ENV as readonly string[]).includes(key)) throw new Error(`worker env key not allowed: ${key}`);
    env[key] = value;
  }
  return env;
}

export function spawnWorker(
  entry: string,
  args: string[],
  extra: Record<string, string>,
  opts: { parentEnv?: NodeJS.ProcessEnv; stdio?: "pipe" | "inherit" } = {},
): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: REPO_ROOT,
    env: buildWorkerEnv(opts.parentEnv ?? process.env, extra),
    stdio: opts.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}
