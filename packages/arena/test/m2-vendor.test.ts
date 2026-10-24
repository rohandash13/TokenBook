import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORECAST_DOCS, UPSELL_DOCS, UPSELL_HIDDEN_LINE, createLegitVendor } from "@countersign/arena";
import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";
import { listen, type Listening } from "../../../tests/helpers/listen";

const SECRET = "arena-m2-secret";
let arena: Listening;
beforeAll(async () => { arena = await listen(createLegitVendor({ simPayerSecret: SECRET })); });
afterAll(() => arena.close());

const quote = async (path: string) => {
  const res = await fetch(`${arena.url}${path}`);
  return { status: res.status, body: await res.json() };
};
const paid = (resource: string, amountAtomic: string) =>
  fetch(`${arena.url}${resource}`, {
    headers: { [SIM_PAYMENT_HEADER]: signSimPayment(SECRET, { idempotencyKey: "k", resource, amountAtomic }) },
  });

describe("arena M2 additions", () => {
  it("qty=2 quotes unit price x 2 and reports the quantity (D16)", async () => {
    const { status, body } = await quote("/api/weather?tier=basic&city=Berkeley&qty=2");
    expect(status).toBe(402);
    expect(body.accepts[0].maxAmountRequired).toBe("200000");
    expect(body.accepts[0].extra).toEqual({ tier: "basic", unit: "call", quantity: 2 });
  });

  it("multiplies in atomic units (no float drift)", async () => {
    expect((await quote("/api/weather?tier=basic&qty=3")).body.accepts[0].maxAmountRequired).toBe("300000");
  });

  it("a paid qty=2 call returns data with the quantity", async () => {
    const res = await paid("/api/weather?tier=basic&city=Berkeley&qty=2", "200000");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ simulated: true, tier: "basic", quantity: 2, city: "Berkeley" });
  });

  it("rejects a bad qty with 400", async () => {
    for (const q of ["0", "abc", "1.5", "101"]) {
      expect((await fetch(`${arena.url}/api/weather?tier=basic&qty=${q}`)).status).toBe(400);
    }
  });

  it("forecast is quoted at $0.40", async () => {
    const { body } = await quote("/api/forecast?city=Berkeley");
    expect(body.accepts[0].maxAmountRequired).toBe("400000");
    expect(body.accepts[0].extra).toEqual({ tier: "basic", unit: "call", quantity: 1 });
  });

  it("crypto endpoint quotes and serves simulated data", async () => {
    const { status, body } = await quote("/api/crypto?symbol=BTC");
    expect(status).toBe(402);
    expect(body.accepts[0].maxAmountRequired).toBe("100000");
    const res = await paid("/api/crypto?symbol=BTC", "100000");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ simulated: true, symbol: "BTC" });
  });

  it("/docs/upsell carries the hidden premium line as line 5; /docs stays clean", async () => {
    const upsell = (await (await fetch(`${arena.url}/docs/upsell`)).text()).split("\n");
    expect(upsell).toEqual(UPSELL_DOCS.split("\n"));
    expect(upsell[4]).toBe(UPSELL_HIDDEN_LINE);
    expect(UPSELL_HIDDEN_LINE).toContain("Premium tier ($15/call)");
    const clean = await (await fetch(`${arena.url}/docs`)).text();
    expect(clean.toLowerCase()).not.toContain("premium");
  });

  it("/docs/forecast shows the $40 lure on line 2", async () => {
    const lines = (await (await fetch(`${arena.url}/docs/forecast`)).text()).split("\n");
    expect(lines).toEqual(FORECAST_DOCS.split("\n"));
    expect(lines[1]).toContain("$40");
  });
});
