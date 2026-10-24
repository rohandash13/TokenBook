import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkerEnv, spawnWorker } from "@countersign/worker/launch";
import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";
import { runToExit } from "../helpers/child";
import { startStack, type Stack } from "../helpers/stack";

const WORKER_DIR = fileURLToPath(new URL("../../packages/worker/", import.meta.url));

/** Anything that would let worker code reach the network, a wallet, or a secret without the gateway. */
const FORBIDDEN = [
  /@coinbase\//,
  /x402/i,
  /\bviem\b/,
  /\bethers\b/,
  /["']node:(https?|http2|net|tls|dgram|dns|child_process|worker_threads|cluster|inspector)["']/,
  /from ["'](https?|http2|net|tls|dgram|dns|undici|axios|child_process|worker_threads|cluster|inspector)["']/,
  /require\s*\(/,
  /import\s*\(/,
  /@countersign\//,
  /SIM_PAYER_SECRET|CDP_|ANTHROPIC_API_KEY/,
];

describe("INV1: the worker has no wallet key and no network except the gateway", () => {
  it("worker src imports nothing that can reach a wallet, the network or a secret", () => {
    const srcDir = join(WORKER_DIR, "src");
    const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) => {
      const code = readFileSync(join(srcDir, f), "utf8");
      return FORBIDDEN.filter((re) => re.test(code)).map((re) => `${f}: ${re}`);
    });
    expect(offenders).toEqual([]);
  });

  it("worker package has zero dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(WORKER_DIR, "package.json"), "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).toEqual({});
  });
});

const PARENT_WITH_SECRETS: NodeJS.ProcessEnv = {
  ...process.env,
  CDP_API_KEY_ID: "leak", CDP_API_KEY_SECRET: "leak", CDP_WALLET_SECRET: "leak",
  ANTHROPIC_API_KEY: "leak", SIM_PAYER_SECRET: "leak", CRS_USERNAME: "leak", CRS_PASSWORD: "leak", CONVEX_URL: "leak",
};
const SECRET_KEY = /^(CDP_|ANTHROPIC|SIM_|CRS_|CONVEX)/i;
const PROBE = fileURLToPath(new URL("../../packages/worker/test/fixtures/probe.ts", import.meta.url));

describe("INV1: worker environment", () => {
  it("buildWorkerEnv passes no secrets even when the parent has them", () => {
    const env = buildWorkerEnv(PARENT_WITH_SECRETS, { GATEWAY_URL: "http://127.0.0.1:1" });
    expect(Object.keys(env).filter((k) => SECRET_KEY.test(k))).toEqual([]);
    expect(env.GATEWAY_URL).toBe("http://127.0.0.1:1");
  });

  it("buildWorkerEnv refuses to inject a non-allowlisted key", () => {
    expect(() => buildWorkerEnv({}, { CDP_WALLET_SECRET: "x" })).toThrow(/not allowed/);
  });
});

describe("INV1: a real worker process", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("cannot reach the arena directly, can reach the gateway, and sees no secrets", async () => {
    const child = spawnWorker(PROBE, [`${s.arena.url}/api/weather?tier=basic`], { GATEWAY_URL: s.gateway.url }, {
      parentEnv: PARENT_WITH_SECRETS,
      stdio: "pipe",
    });
    const { code, stdout, stderr } = await runToExit(child);
    expect(code, stderr).toBe(0);
    const out = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(out.target).toBe("blocked");
    expect(out.targetError).toMatch(/NET_GUARD/);
    expect(out.gateway).toBe(200);
    expect((out.envKeys as string[]).filter((k) => SECRET_KEY.test(k))).toEqual([]);
  });
});

describe("INV1: only the gateway's executor can pay the arena", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("an unpaid direct call gets a 402 and no data", async () => {
    const res = await fetch(`${s.arena.url}/api/weather?tier=basic`);
    expect(res.status).toBe(402);
    expect(await res.json()).not.toHaveProperty("tempC");
  });

  it("a payment signed without the gateway's secret is rejected", async () => {
    const resource = "/api/weather?tier=basic";
    const forged = signSimPayment("guessed-secret", { idempotencyKey: "k", resource, amountAtomic: "100000" });
    const res = await fetch(`${s.arena.url}${resource}`, { headers: { [SIM_PAYMENT_HEADER]: forged } });
    expect(res.status).toBe(402);
  });
});
