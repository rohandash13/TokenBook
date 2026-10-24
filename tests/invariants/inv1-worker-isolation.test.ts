import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKER_DIR = fileURLToPath(new URL("../../packages/worker/", import.meta.url));

/** Anything that would let worker code reach the network, a wallet, or a secret without the gateway. */
const FORBIDDEN = [
  /@coinbase\//,
  /x402/i,
  /\bviem\b/,
  /\bethers\b/,
  /["']node:(https?|net|tls|dgram|child_process)["']/,
  /from ["'](https?|net|tls|dgram|undici|axios|child_process)["']/,
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
