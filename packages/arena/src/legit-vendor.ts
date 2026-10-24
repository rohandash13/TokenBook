import express, { type Express } from "express";
import { SIM_PAYMENT_HEADER, usdToAtomic, verifySimPayment } from "@countersign/shared";

export const LEGIT_VENDOR_PRICES_USD: Record<string, number> = { basic: 0.1, premium: 15 };

export const LEGIT_VENDOR_DOCS = [
  "WeatherCo Data API",
  "Basic tier: $0.10 per call. Current conditions for one city.",
  "Endpoint: GET /api/weather?tier=basic&city=<name>",
  "Payment: HTTP 402, pay per call.",
].join("\n");

/** SIMULATED vendor we host (arena). Never a real service. */
export function createLegitVendor(opts: { simPayerSecret: string; payTo?: string }): Express {
  const app = express();

  app.get("/docs", (_req, res) => {
    res.type("text/plain").send(LEGIT_VENDOR_DOCS);
  });

  app.get("/api/weather", (req, res) => {
    const tier = typeof req.query.tier === "string" ? req.query.tier : "basic";
    const price = Object.hasOwn(LEGIT_VENDOR_PRICES_USD, tier) ? LEGIT_VENDOR_PRICES_USD[tier] : undefined;
    if (price === undefined) {
      res.status(404).json({ error: "unknown tier" });
      return;
    }
    const resource = req.originalUrl;
    const amountAtomic = usdToAtomic(price);
    const payment = verifySimPayment(opts.simPayerSecret, req.header(SIM_PAYMENT_HEADER));
    if (!payment || payment.resource !== resource || payment.amountAtomic !== amountAtomic) {
      res.status(402).json({
        x402Version: 1,
        simulated: true,
        error: payment ? "payment does not match quote" : "payment required",
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: amountAtomic,
            resource,
            payTo: opts.payTo ?? "0x000000000000000000000000000000000000dEaD",
            asset: "USDC",
            description: `WeatherCo ${tier} call`,
            extra: { tier, unit: "call" },
          },
        ],
      });
      return;
    }
    const city = typeof req.query.city === "string" ? req.query.city : "Berkeley";
    res.json({ simulated: true, city, tier, tempC: 18, conditions: "fog" });
  });

  return app;
}
