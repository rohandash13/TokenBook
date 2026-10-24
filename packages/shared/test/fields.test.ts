import { describe, expect, it } from "vitest";
import { PAYMENT_FIELDS, isTainted, normalizeCategory, normalizeDomain, toAtomic, tokenize } from "@countersign/shared";

describe("shared field primitives (D26)", () => {
  it("PAYMENT_FIELDS lists the five traced fields in order", () => {
    expect(PAYMENT_FIELDS).toEqual(["payee", "amount", "tier", "quantity", "category"]);
  });

  it("isTainted: PAGE, UNKNOWN and missing are taint; TASK, PLAN, QUOTE are not", () => {
    expect(isTainted("PAGE")).toBe(true);
    expect(isTainted("UNKNOWN")).toBe(true);
    expect(isTainted(undefined)).toBe(true);
    expect(isTainted("TASK")).toBe(false);
    expect(isTainted("PLAN")).toBe(false);
    expect(isTainted("QUOTE")).toBe(false);
  });

  it("normalizers behave exactly as the M2 gateway versions", () => {
    expect(normalizeDomain("https://www.Vendor.TEST:4101/docs?x=1")).toBe("vendor.test:4101");
    expect(normalizeDomain("WWW.weatherco.test.")).toBe("weatherco.test");
    expect(normalizeCategory(" Crypto Prices ")).toBe("crypto-prices");
    expect(tokenize("Premium-Tier, x2")).toEqual(["premium", "tier", "x2"]);
    expect(toAtomic(0.1 * 3)).toBe(300000);
  });
});
