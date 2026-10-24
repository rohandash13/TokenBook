import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPROVER_CONFIG, parseApprovers, routeHold } from "@countersign/rules";

const CONFIG = parseApprovers(JSON.parse(readFileSync(new URL("../../../config/approvers.json", import.meta.url), "utf8")));

describe("approver routing is config (spec §9, D27)", () => {
  it("loads config/approvers.json", () => {
    expect(CONFIG).toEqual({ routes: [{ when: { category: "coding", maxUsd: 5 }, approver: "Priya" }], default: "Sam" });
  });

  it("small coding purchases go to Priya; everything else to Sam", () => {
    expect(routeHold(CONFIG, { category: "coding", amountUsd: 2 })).toBe("Priya");
    expect(routeHold(CONFIG, { category: "coding", amountUsd: 5 })).toBe("Priya");
    expect(routeHold(CONFIG, { category: " Coding ", amountUsd: 1 })).toBe("Priya");
    expect(routeHold(CONFIG, { category: "coding", amountUsd: 5.01 })).toBe("Sam");
    expect(routeHold(CONFIG, { category: "weather", amountUsd: 0.1 })).toBe("Sam");
    expect(routeHold(CONFIG, { category: null, amountUsd: 0.1 })).toBe("Sam");
  });

  it("first matching route wins; an empty `when` matches everything", () => {
    const cfg = parseApprovers({
      routes: [
        { when: { maxUsd: 1 }, approver: "A" },
        { when: { category: "weather" }, approver: "B" },
        { when: {}, approver: "C" },
      ],
      default: "D",
    });
    expect(routeHold(cfg, { category: "weather", amountUsd: 0.5 })).toBe("A");
    expect(routeHold(cfg, { category: "weather", amountUsd: 2 })).toBe("B");
    expect(routeHold(cfg, { category: "crypto-prices", amountUsd: 2 })).toBe("C");
  });

  it("the built-in default (only when no config is given) sends everything to Sam", () => {
    expect(routeHold(DEFAULT_APPROVER_CONFIG, { category: "coding", amountUsd: 1 })).toBe("Sam");
  });

  it("rejects malformed configs", () => {
    expect(() => parseApprovers({ routes: [] })).toThrow();
    expect(() => parseApprovers({ routes: [], default: "" })).toThrow();
    expect(() => parseApprovers({ routes: [{ when: { maxUsd: -1 }, approver: "A" }], default: "S" })).toThrow();
    expect(() => parseApprovers({ routes: [{ when: { vendor: "x" }, approver: "A" }], default: "S" })).toThrow();
    expect(() => parseApprovers({ routes: [{ when: {}, approver: "" }], default: "S" })).toThrow();
  });

  it("a non-finite or invalid amount never matches a maxUsd route (falls to the default)", () => {
    for (const amountUsd of [NaN, Infinity, -Infinity, "1" as unknown as number, null as unknown as number]) {
      expect(routeHold(CONFIG, { category: "coding", amountUsd }), String(amountUsd)).toBe("Sam");
    }
    const cfg = parseApprovers({ routes: [{ when: { maxUsd: 5 }, approver: "A" }], default: "D" });
    expect(routeHold(cfg, { category: null, amountUsd: NaN })).toBe("D");
    expect(routeHold(cfg, { category: null, amountUsd: Infinity })).toBe("D");
  });

  it("maxUsd must be finite and > 0; a category that normalizes to empty is rejected", () => {
    for (const maxUsd of [0, Infinity, NaN, -1]) {
      expect(() => parseApprovers({ routes: [{ when: { maxUsd }, approver: "A" }], default: "S" }), String(maxUsd)).toThrow();
    }
    for (const category of ["!!!", "  ", "---"]) {
      expect(() => parseApprovers({ routes: [{ when: { category }, approver: "A" }], default: "S" }), category).toThrow();
    }
  });
});
