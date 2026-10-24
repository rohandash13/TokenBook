import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";
import { listen, type Listening } from "../../../tests/helpers/listen";

const SECRET = "arena-test-secret";
let arena: Listening;
beforeAll(async () => { arena = await listen(createLegitVendor({ simPayerSecret: SECRET })); });
afterAll(() => arena.close());

describe("legit vendor", () => {
  it("serves a docs page that advertises the basic tier", async () => {
    const text = await (await fetch(`${arena.url}/docs`)).text();
    expect(text.split("\n")[1]).toContain("Basic tier: $0.10");
  });

  it("answers an unpaid call with a 402 quote in x402 accepts shape", async () => {
    const res = await fetch(`${arena.url}/api/weather?tier=basic&city=Berkeley`);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.simulated).toBe(true);
    expect(body.accepts[0]).toMatchObject({
      network: "base-sepolia",
      maxAmountRequired: "100000",
      resource: "/api/weather?tier=basic&city=Berkeley",
      extra: { tier: "basic", unit: "call" },
    });
  });

  it("quotes premium at $15", async () => {
    const body = await (await fetch(`${arena.url}/api/weather?tier=premium`)).json();
    expect(body.accepts[0].maxAmountRequired).toBe("15000000");
  });

  it("returns data for a correctly signed payment", async () => {
    const resource = "/api/weather?tier=basic&city=Berkeley";
    const header = signSimPayment(SECRET, { idempotencyKey: "k", resource, amountAtomic: "100000" });
    const res = await fetch(`${arena.url}${resource}`, { headers: { [SIM_PAYMENT_HEADER]: header } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ simulated: true, tier: "basic", city: "Berkeley" });
  });

  it("rejects a valid signature for the wrong amount", async () => {
    const resource = "/api/weather?tier=premium";
    const header = signSimPayment(SECRET, { idempotencyKey: "k", resource, amountAtomic: "100000" });
    const res = await fetch(`${arena.url}${resource}`, { headers: { [SIM_PAYMENT_HEADER]: header } });
    expect(res.status).toBe(402);
  });

  it("404s an unknown tier", async () => {
    expect((await fetch(`${arena.url}/api/weather?tier=gold`)).status).toBe(404);
  });

  it.each(["constructor", "__proto__", "toString"])("404s inherited key %s as a tier", async (tier) => {
    expect((await fetch(`${arena.url}/api/weather?tier=${tier}`)).status).toBe(404);
  });
});
