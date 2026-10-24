import { createHmac, timingSafeEqual } from "node:crypto";

/** SIMULATED payment proof (D10). Not x402. Only the gateway and the arena know the secret. */
export const SIM_PAYMENT_HEADER = "x-sim-payment";

export interface SimPayment {
  idempotencyKey: string;
  resource: string;
  amountAtomic: string;
  sig: string;
}

export function usdToAtomic(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}

function mac(secret: string, p: Omit<SimPayment, "sig">): string {
  return createHmac("sha256", secret).update(`${p.idempotencyKey}|${p.resource}|${p.amountAtomic}`).digest("hex");
}

export function signSimPayment(secret: string, p: Omit<SimPayment, "sig">): string {
  const body: SimPayment = { ...p, sig: mac(secret, p) };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

export function verifySimPayment(secret: string, header: string | undefined): SimPayment | null {
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as SimPayment;
    if (![p.idempotencyKey, p.resource, p.amountAtomic, p.sig].every((v) => typeof v === "string")) return null;
    const expected = Buffer.from(mac(secret, p), "hex");
    const got = Buffer.from(p.sig, "hex");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    return p;
  } catch {
    return null;
  }
}
