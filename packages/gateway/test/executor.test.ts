import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import { QuoteError, SimulatedExecutor, parseQuote } from "@countersign/gateway";
import { listen, type Listening } from "../../../tests/helpers/listen";

describe("parseQuote", () => {
  it("throws when the response is not a 402", () => {
    expect(() => parseQuote("http://v.test/x", 200, {})).toThrow(QuoteError);
  });

  it("throws when the 402 has no payment requirements", () => {
    expect(() => parseQuote("http://v.test/x", 402, { accepts: [] })).toThrow(QuoteError);
  });

  it("extracts payee host, USD amount, tier and resource", () => {
    const q = parseQuote("http://Vendor.test:4101/api/weather?tier=basic", 402, {
      accepts: [{ maxAmountRequired: "100000", resource: "/api/weather?tier=basic", extra: { tier: "basic", unit: "call" } }],
    });
    expect(q).toMatchObject({ payeeDomain: "vendor.test:4101", amountUsd: 0.1, amountAtomic: "100000", tier: "basic", unit: "call", resource: "/api/weather?tier=basic" });
  });
});

describe("SimulatedExecutor against the arena", () => {
  const SECRET = "exec-test-secret";
  let arena: Listening;
  beforeAll(async () => { arena = await listen(createLegitVendor({ simPayerSecret: SECRET })); });
  afterAll(() => arena.close());

  it("quotes then pays, and labels the result simulated", async () => {
    const url = `${arena.url}/api/weather?tier=basic&city=Oakland`;
    const exec = new SimulatedExecutor(SECRET);
    const quote = await exec.getQuote(url);
    expect(quote.amountUsd).toBe(0.1);
    const out = await exec.pay(url, quote, "idem-0001-abcdef-xyz");
    expect(out).toMatchObject({ status: "settled", httpStatus: 200, simulated: true, txRef: "sim-idem-0001-abcdef" });
    expect(out.data).toMatchObject({ city: "Oakland", tier: "basic", simulated: true });
  });

  it("fails when the executor's secret is wrong", async () => {
    const url = `${arena.url}/api/weather?tier=basic`;
    const exec = new SimulatedExecutor("wrong-secret");
    const out = await exec.pay(url, await exec.getQuote(url), "idem-2");
    expect(out).toMatchObject({ status: "failed", httpStatus: 402, txRef: null });
  });
});
