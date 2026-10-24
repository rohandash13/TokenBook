import type { Origin, PaymentField } from "./types";

/**
 * D26: primitives shared by the gateway (tracer, floors) and packages/rules (Tier 1 matcher, replay).
 * Pure, no I/O. Moved here verbatim from the M2 gateway so both sides use the same functions.
 */
export const PAYMENT_FIELDS: PaymentField[] = ["payee", "amount", "tier", "quantity", "category"];

/** PAGE and UNKNOWN are taint; a missing origin is treated as UNKNOWN (fail closed). */
export function isTainted(o: Origin | undefined): boolean {
  return o === undefined || o === "PAGE" || o === "UNKNOWN";
}

/** USD -> 6-decimal integer units (USDC atomic). All amount comparisons go through this. */
export function toAtomic(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** "https://www.Vendor.test:4101/docs" -> "vendor.test:4101". Port kept: arena hosts differ only by port. */
export function normalizeDomain(s: string): string {
  let t = s.trim().toLowerCase();
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  t = t.split(/[/?#]/)[0];
  t = t.replace(/^www\./, "");
  t = t.replace(/\.$/, "");
  return t;
}

/** " Crypto Prices " -> "crypto-prices". */
export function normalizeCategory(s: string): string {
  return tokenize(s).join("-");
}
