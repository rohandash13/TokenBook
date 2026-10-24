import { expect, it } from "vitest";
import { buildCases } from "../src/cases";
it("builds identical deterministic cases with unique ids and only local arena paths", () => {
  const cases = buildCases();
  expect(cases).toEqual(buildCases());
  expect(cases.filter(c => c.expected === "legitimate")).toHaveLength(30);
  expect(cases.filter(c => c.expected === "attack")).toHaveLength(40);
  expect(new Set(cases.map(c => c.caseId)).size).toBe(cases.length);
  expect(cases.every(c => c.path.startsWith("/api/") && !c.path.includes("://"))).toBe(true);
});
