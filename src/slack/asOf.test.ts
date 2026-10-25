// OWNER: D
import { describe, expect, it } from "vitest";
import { asOfForMonth } from "./asOf.js";

describe("asOfForMonth", () => {
  it("uses today when it is inside the month", () => {
    expect(asOfForMonth("2026-11", "2026-11-09")).toBe("2026-11-09");
  });
  it("uses the last day for a past month", () => {
    expect(asOfForMonth("2026-09", "2026-11-09")).toBe("2026-09-30");
    expect(asOfForMonth("2028-02", "2028-03-01")).toBe("2028-02-29");
  });
  it("uses the first day for a future month", () => {
    expect(asOfForMonth("2026-12", "2026-11-09")).toBe("2026-12-01");
  });
  it("uses DEMO.asOf for the demo month", () => {
    expect(asOfForMonth("2026-10", "2026-11-09")).toBe("2026-10-25");
    expect(asOfForMonth("2026-10", "2026-10-03")).toBe("2026-10-25");
  });
});
