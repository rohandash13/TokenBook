import { describe, expect, it } from "vitest";
import { QuoteError, parseQuote } from "@countersign/gateway";

const body = (extra: Record<string, unknown>) => ({
  accepts: [{ maxAmountRequired: "200000", resource: "/api/weather?tier=basic&qty=2", extra }],
});

describe("parseQuote quantity (D16, D21)", () => {
  it("defaults to 1 when the vendor sends no quantity", () => {
    expect(parseQuote("http://v.test/api/weather", 402, body({ tier: "basic", unit: "call" })).quantity).toBe(1);
  });

  it("reads extra.quantity", () => {
    const q = parseQuote("http://v.test/api/weather?qty=2", 402, body({ tier: "basic", unit: "call", quantity: 2 }));
    expect(q).toMatchObject({ quantity: 2, amountUsd: 0.2, tier: "basic" });
  });

  it("rejects a quantity that is not a positive integer", () => {
    for (const quantity of [0, 2.5, "2", -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseQuote("http://v.test/x", 402, body({ tier: "basic", quantity }))).toThrow(QuoteError);
    }
  });
});
