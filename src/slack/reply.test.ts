// OWNER: D
import { describe, expect, it, vi } from "vitest";
import type { Estimate, TeamContext } from "../shared/types.js";
import type { TrueUpApi } from "./api.js";
import { PendingStore } from "./extractDrivers.js";
import { handleReply } from "./reply.js";

vi.mock("../llm/extractDrivers.js", () => ({
  extractDrivers: vi.fn(async (input: { team: string; month: string; text: string; repliedAt?: string }) => ({
    team: input.team, month: input.month, replied: true, quote: input.text, repliedAt: input.repliedAt,
    events: /moved|Nov/i.test(input.text) ? [{ date: "2026-10-30", multiplier: 2, note: "launch moved" }] : [],
  })),
}));

const inferred: TeamContext = {
  team: "support", month: "2026-10", replied: false, inferred: true,
  events: [{
    date: "2026-10-27", multiplier: 3, note: "support agent v2 launch", source: "slack",
    evidence: [{ source: "slack", id: "slack:1", url: "u", text: "t", date: "2026-10-20" }],
  }],
};
const est = (n: number): Estimate => ({
  team: "support", month: "2026-10", asOf: "2026-10-25", method: "trueup", actualToDate: 0, estimate: n, confidence: "medium", basis: "",
});

function setup(getContexts: TrueUpApi["getContexts"]) {
  const posted: TeamContext[] = [];
  const api: TrueUpApi = {
    postContext: async (c) => { posted.push(c); },
    getEstimates: async () => [est(10040)],
    getActualToDate: async () => 0,
    getContexts,
    refreshSignals: async () => {},
  };
  const pending = new PendingStore();
  pending.start("U1", "support", "2026-10");
  return { api, pending, posted };
}

describe("handleReply", () => {
  it("keeps inferred events when the reply is a bare confirmation", async () => {
    const { api, pending, posted } = setup(async () => [inferred]);
    const out = await handleReply("U1", "looks right", { api, pending });
    expect(posted[0].replied).toBe(true);
    expect(posted[0].quote).toBe("looks right");
    expect(posted[0].events).toEqual(inferred.events);
    expect(out).toBe("Thanks — keeping support agent v2 launch Oct 27, about 3x. Your estimate stays at $10,040.");
  });

  it("replaces inferred events when the lead corrects them", async () => {
    const { api, pending, posted } = setup(async () => [inferred]);
    const out = await handleReply("U1", "launch moved to Oct 30", { api, pending });
    expect(posted[0].events).toEqual([{ date: "2026-10-30", multiplier: 2, note: "launch moved", source: "lead" }]);
    expect(out).toContain("launch moved Oct 30");
  });

  it("falls back to the plain behaviour when getContexts fails", async () => {
    const { api, pending, posted } = setup(async () => { throw new Error("down"); });
    const out = await handleReply("U1", "yep", { api, pending });
    expect(posted[0].events).toEqual([]);
    expect(out).toContain("nothing unusual planned");
  });
});
