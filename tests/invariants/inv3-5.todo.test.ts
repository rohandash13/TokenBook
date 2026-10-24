import { describe, it } from "vitest";

describe("invariants pending later milestones", () => {
  it.todo("INV3: any PAGE/UNKNOWN field origin forces final verdict >= HOLD even if Tier 1 or the judge approves (M2)");
  it.todo("INV4: Tier 2 judge input never contains page text, page summaries or the agent's purpose text (M2)");
  it.todo("INV5: a timeout never triggers a second payment; status is confirmed before any retry (M4)");
});
