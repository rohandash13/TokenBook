import { describe, expect, it } from "vitest";
import { signSimPayment, usdToAtomic, verifySimPayment } from "@countersign/shared";

const p = { idempotencyKey: "k1", resource: "/api/weather?tier=basic", amountAtomic: "100000" };

describe("simulated payment header", () => {
  it("round-trips with the right secret", () => {
    expect(verifySimPayment("s", signSimPayment("s", p))).toMatchObject(p);
  });

  it("rejects the wrong secret", () => {
    expect(verifySimPayment("other", signSimPayment("s", p))).toBeNull();
  });

  it("rejects a tampered amount", () => {
    const decoded = JSON.parse(Buffer.from(signSimPayment("s", p), "base64").toString("utf8"));
    decoded.amountAtomic = "15000000";
    expect(verifySimPayment("s", Buffer.from(JSON.stringify(decoded)).toString("base64"))).toBeNull();
  });

  it("rejects missing or garbage headers", () => {
    expect(verifySimPayment("s", undefined)).toBeNull();
    expect(verifySimPayment("s", "not-base64-json")).toBeNull();
  });

  it("converts USD to 6-decimal USDC atomic units", () => {
    expect(usdToAtomic(0.1)).toBe("100000");
    expect(usdToAtomic(15)).toBe("15000000");
    expect(usdToAtomic(0.4)).toBe("400000");
  });
});

it("rejects invalid amounts and ambiguous MAC framing and strips extra keys", () => {
  for (const n of [NaN, -1, Infinity]) expect(() => usdToAtomic(n)).toThrow();
  const header = signSimPayment("s", { idempotencyKey: "a|b", resource: "c", amountAtomic: "1" });
  const body = JSON.parse(Buffer.from(header, "base64").toString());
  const encode = (p: unknown) => Buffer.from(JSON.stringify(p)).toString("base64");
  expect(verifySimPayment("s", encode({ ...body, idempotencyKey: "a", resource: "b|c" }))).toBeNull();
  expect(verifySimPayment("s", encode({ ...body, extra: "drop" }))).toEqual(body);
  expect(() => signSimPayment("s", { idempotencyKey: "a", resource: "b", amountAtomic: "1x" })).toThrow();
});
