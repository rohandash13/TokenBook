import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";

export interface QuoteInfo {
  payeeDomain: string;
  amountUsd: number;
  amountAtomic: string;
  tier: string | null;
  unit: string;
  resource: string;
  raw: unknown;
}

export interface PayOutcome {
  status: "settled" | "failed";
  httpStatus: number;
  data?: unknown;
  txRef: string | null;
  simulated: boolean;
}

/** The only component that can move money. Lives in the gateway process. */
export interface Executor {
  readonly kind: "simulated" | "x402";
  getQuote(url: string): Promise<QuoteInfo>;
  pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome>;
}

export class QuoteError extends Error {}

/** Reads an x402-shaped 402 body: { accepts: [{ maxAmountRequired, resource, extra: { tier, unit } }] }. */
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
  return {
    payeeDomain: parsed.host.toLowerCase(),
    amountUsd: Number(req.maxAmountRequired) / 1_000_000,
    amountAtomic: req.maxAmountRequired,
    tier: typeof req.extra?.tier === "string" ? req.extra.tier : null,
    unit: typeof req.extra?.unit === "string" ? req.extra.unit : "call",
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
    const res = await this.fetchImpl(url, { redirect: "manual" });
    const body = await res.json().catch(() => null);
    return parseQuote(url, res.status, body);
  }

  async pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome> {
    const header = signSimPayment(this.secret, {
      idempotencyKey,
      resource: quote.resource,
      amountAtomic: quote.amountAtomic,
    });
    const res = await this.fetchImpl(url, { headers: { [SIM_PAYMENT_HEADER]: header }, redirect: "manual" });
    const data = await res.json().catch(() => null);
    return {
      status: res.ok ? "settled" : "failed",
      httpStatus: res.status,
      data,
      txRef: res.ok ? `sim-${idempotencyKey.slice(0, 16)}` : null,
      simulated: true,
    };
  }
}
