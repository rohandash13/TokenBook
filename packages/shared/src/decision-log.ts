import { createHash } from "node:crypto";
import type { Decision, DecisionDraft } from "./types";

/** D18: hash = sha256(prevHash + canonical(decision without prevHash/hash)). One global chain. */
export const GENESIS_HASH = "0".repeat(64);

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortDeep(v)));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** JSON with recursively sorted keys; undefined object values are dropped (as JSON.stringify does). */
export function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hashDecision(prevHash: string, draft: DecisionDraft): string {
  return sha256Hex(prevHash + canonical(draft));
}

export function verifyChain(decisions: Decision[]): { ok: true } | { ok: false; brokenAt: number } {
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < decisions.length; i++) {
    const { prevHash, hash, ...draft } = decisions[i];
    if (prevHash !== expectedPrev || hash !== hashDecision(prevHash, draft)) return { ok: false, brokenAt: i };
    expectedPrev = hash;
  }
  return { ok: true };
}
