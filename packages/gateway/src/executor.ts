import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";

export interface QuoteInfo {
  payeeDomain: string;
  amountUsd: number;
  amountAtomic: string;
  tier: string | null;
  unit: string;
  quantity: number; // D16
  resource: string;
  raw: unknown;
}

export interface PayOutcome {
  status: "settled" | "failed";
  httpStatus: number;
  data?: unknown;
  txRef: string | null;
  simulated: boolean;
  paidAtomic?: string;
}

/** The only component that can move money. Lives in the gateway process. */
export interface Executor {
  readonly kind: "simulated" | "x402";
  getQuote(url: string): Promise<QuoteInfo>;
  pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome>;
  confirm?(idempotencyKey: string, quote: QuoteInfo, url: string): Promise<PayOutcome | { status: "unknown" }>;
}

export class QuoteError extends Error {}

/** Reads an x402-shaped 402 body: { accepts: [{ maxAmountRequired, resource, extra: { tier, unit, quantity } }] }. */
export function parseQuote(url: string, status: number, body: unknown): QuoteInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new QuoteError(`invalid vendor URL: ${url}`);
  }
  if (status !== 402) throw new QuoteError(`expected 402 from ${url}, got ${status}`);
  const req = (body as { accepts?: Array<Record<string, any>> } | null)?.accepts?.[0];
  if (!req || typeof req.maxAmountRequired !== "string") {
    throw new QuoteError(`no payment requirements in 402 from ${url}`);
  }
  if (!/^\d+$/.test(req.maxAmountRequired)) {
    throw new QuoteError(`invalid maxAmountRequired from ${url}`);
  }
  const rawQty = req.extra?.quantity;
  let quantity = 1;
  if (rawQty !== undefined) {
    if (typeof rawQty !== "number" || !Number.isSafeInteger(rawQty) || rawQty < 1) {
      throw new QuoteError(`invalid quantity in 402 from ${url}`); // D21: fail closed
    }
    quantity = rawQty;
  }
  return {
    payeeDomain: parsed.host.toLowerCase(),
    amountUsd: Number(req.maxAmountRequired) / 1_000_000,
    amountAtomic: req.maxAmountRequired,
    tier: typeof req.extra?.tier === "string" ? req.extra.tier : null,
    unit: typeof req.extra?.unit === "string" ? req.extra.unit : "call",
    quantity,
    resource: typeof req.resource === "string" ? req.resource : parsed.pathname + parsed.search,
    raw: body,
  };
}

/** SIMULATED (D10): signs an HMAC header the arena verifies. No chain, no x402 wire format. */
export class SimulatedExecutor implements Executor {
  readonly kind = "simulated" as const;

  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async getQuote(url: string): Promise<QuoteInfo> {
    const res = await this.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => null);
    return parseQuote(url, res.status, body);
  }

  async pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome> {
    const header = signSimPayment(this.secret, {
      idempotencyKey,
      resource: quote.resource,
      amountAtomic: quote.amountAtomic,
    });
    const res = await this.fetchImpl(url, { headers: { [SIM_PAYMENT_HEADER]: header }, redirect: "manual", signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => null);
    return {
      status: res.ok ? "settled" : "failed",
      httpStatus: res.status,
      data,
      txRef: res.ok ? `sim-${idempotencyKey.slice(0, 16)}` : null,
      simulated: true,
      paidAtomic: res.ok ? quote.amountAtomic : "0",
    };
  }
  async confirm(key: string, quote: QuoteInfo, url: string): Promise<PayOutcome | { status: "unknown" }> {
    try {
      const statusUrl = new URL(`/payments/${encodeURIComponent(key)}`, url);
      const res = await this.fetchImpl(statusUrl, { redirect: "manual", signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { status: "unknown" };
      const body = await res.json() as Record<string, unknown>;
      if (body.simulated !== true || typeof body.settled !== "boolean") return { status: "unknown" };
      if (!body.settled) return { status: "failed", httpStatus: 0, simulated: true, txRef: null };
      if (body.resource !== quote.resource || body.amountAtomic !== quote.amountAtomic || typeof body.paidAtomic !== "string") return { status: "unknown" };
      return { status: "settled", httpStatus: 200, simulated: true, txRef: `sim-${key}`, data: body.data, paidAtomic: body.paidAtomic };
    } catch { return { status: "unknown" }; }
  }
}
