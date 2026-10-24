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
    headers: { [SIM_PAYMENT_HEADER]: signSimPayment(SECRET, { idempotencyKey: resource, resource, amountAtomic }) },
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

  const BAD_QTY = ["qty=1&qty=2", "qty=", "qty=-1", "qty=%2B1", "qty=%201", "qty=1e2", "qty=0x10", "qty=007", "qty=01"];
  for (const path of ["/api/weather", "/api/forecast", "/api/crypto"]) {
    it(`${path} rejects non-canonical qty with 400`, async () => {
      for (const q of BAD_QTY) {
        expect((await fetch(`${arena.url}${path}?tier=basic&${q}`)).status, q).toBe(400);
      }
    });
    it(`${path} rejects a repeated tier with 400`, async () => {
      expect((await fetch(`${arena.url}${path}?tier=basic&tier=premium`)).status).toBe(400);
    });
    it(`${path} unknown tier is 404`, async () => {
      expect((await fetch(`${arena.url}${path}?tier=gold`)).status).toBe(404);
    });
  }

  it("inherited object keys are not tiers (404)", async () => {
    for (const path of ["/api/forecast", "/api/crypto"]) {
      for (const t of ["__proto__", "constructor", "toString"]) {
        expect((await fetch(`${arena.url}${path}?tier=${t}`)).status, `${path} ${t}`).toBe(404);
      }
    }
  });

  it("a valid payment that does not match the quote or resource is 402", async () => {
    const qtyRes = "/api/weather?tier=basic&qty=2";
    const wrongAmount = await fetch(`${arena.url}${qtyRes}`, {
      headers: { [SIM_PAYMENT_HEADER]: signSimPayment(SECRET, { idempotencyKey: "mismatch", resource: qtyRes, amountAtomic: "100000" }) },
    });
    expect(wrongAmount.status).toBe(402);
    const wrongResource = await fetch(`${arena.url}${qtyRes}`, {
      headers: { [SIM_PAYMENT_HEADER]: signSimPayment(SECRET, { idempotencyKey: "mismatch", resource: "/api/weather?tier=basic", amountAtomic: "200000" }) },
    });
    expect(wrongResource.status).toBe(402);
  });
});
