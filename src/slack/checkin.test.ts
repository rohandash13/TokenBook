// OWNER: D
import { describe, expect, it } from "vitest";
import type { TeamContext } from "../shared/types.js";
import { trueupEstimate, type TrueUpApi } from "./api.js";
import { buildCheckInBlocks, sendCheckIn, type SlackClient } from "./checkin.js";
import { buildConfirmation } from "./confirm.js";
import { applyButton, parseButtonValue, PendingStore } from "./extractDrivers.js";

describe("buildCheckInBlocks", () => {
  const blocks = buildCheckInBlocks("support", "2026-10", 4321.6);
  const buttons = blocks.flatMap((b) => (b.type === "actions" ? b.elements : []));

  it("starts with the header text", () => {
    const first = blocks[0];
    expect(first.type === "section" && first.text.text).toBe(
      "Closing October 2026 for Support. $4,322 of AI APIs used so far.",
    );
  });

  it("has unique checkin_ action ids for every button", () => {
    const ids = buttons.map((b) => b.action_id);
    expect(ids).toEqual([
      "checkin_launches_yes", "checkin_launches_no",
      "checkin_volume_lower", "checkin_volume_same", "checkin_volume_higher", "checkin_volume_much_higher",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buttons.map((b) => b.text.text)).toEqual(["Yes", "No", "Lower", "Same", "Higher", "Much higher"]);
  });

  it("button values carry team, month and answer", () => {
    expect(JSON.parse(buttons[0].value)).toEqual({ team: "support", month: "2026-10", field: "launches", answer: "yes" });
    expect(JSON.parse(buttons[5].value)).toEqual({ team: "support", month: "2026-10", field: "volume", answer: "much_higher" });
  });

  it("asks the free-text question", () => {
    const texts = blocks.map((b) => (b.type === "section" ? b.text.text : "")).join("\n");
    expect(texts).toContain("Anything else finance should know?");
  });
});

describe("button mapping", () => {
  const [yes, , , , higher] = buildCheckInBlocks("search", "2026-10", 0)
    .flatMap((b) => (b.type === "actions" ? b.elements : []));

  it("round-trips button values into CheckInButtons", () => {
    const a = parseButtonValue(yes.value)!;
    const b = parseButtonValue(higher.value)!;
    expect(applyButton(applyButton({}, a), b)).toEqual({ launches: "yes", volume: "higher" });
  });

  it("rejects values we did not send", () => {
    expect(parseButtonValue(undefined)).toBeNull();
    expect(parseButtonValue("not json")).toBeNull();
    expect(parseButtonValue(JSON.stringify({ team: "search", month: "2026-10", field: "volume", answer: "huge" }))).toBeNull();
  });

  it("pending store keeps answers per user and resets for a new month", () => {
    const store = new PendingStore();
    store.start("U1", "search", "2026-10");
    store.recordButton("U1", parseButtonValue(yes.value)!);
    store.recordButton("U1", parseButtonValue(higher.value)!);
    expect(store.get("U1")).toEqual({ team: "search", month: "2026-10", buttons: { launches: "yes", volume: "higher" } });
    expect(store.get("U2")).toBeUndefined();
    store.recordButton("U1", { team: "search", month: "2026-11", field: "launches", answer: "no" });
    expect(store.get("U1")?.buttons).toEqual({ launches: "no" });
  });
});

describe("buildConfirmation", () => {
  const base: TeamContext = { team: "support", month: "2026-10", replied: true, events: [] };

  it("describes events and the estimate move", () => {
    const ctx = { ...base, events: [{ date: "2026-10-27", multiplier: 3, note: "launch" }] };
    expect(buildConfirmation(ctx, 7590, 10040)).toBe(
      "Got it: launch Oct 27, about 3x. That moves your estimate from $7,590 to $10,040. Dana will review it.",
    );
  });

  it("says the estimate stays when there are no events", () => {
    expect(buildConfirmation(base, 7590, 7590)).toBe(
      "Got it: nothing unusual planned. Your estimate stays at $7,590. Dana will review it.",
    );
  });
});

describe("sendCheckIn", () => {
  it("DMs the lead from SLACK_LEAD_<TEAM> and marks the check-in pending", async () => {
    const posted: { channel: string; text: string }[] = [];
    const client: SlackClient = {
      conversations: { open: async ({ users }) => ({ channel: { id: `D-${users}` } }) },
      chat: { postMessage: async (args) => { posted.push(args); return {}; } },
    };
    const api: TrueUpApi = {
      postContext: async () => {},
      getEstimates: async () => [],
      getActualToDate: async () => 1234,
    };
    const pending = new PendingStore();
    await sendCheckIn(client, "support", "2026-10", { api, pending, env: { SLACK_LEAD_SUPPORT: "U123" } });
    expect(posted[0].channel).toBe("D-U123");
    expect(posted[0].text).toBe("Closing October 2026 for Support. $1,234 of AI APIs used so far.");
    expect(pending.get("U123")).toEqual({ team: "support", month: "2026-10", buttons: {} });
    await expect(sendCheckIn(client, "growth", "2026-10", { api, pending, env: {} })).rejects.toThrow("SLACK_LEAD_GROWTH");
  });

  it("picks the trueup estimate for the team", () => {
    const e = { month: "2026-10", asOf: "2026-10-24", actualToDate: 0, confidence: "high", basis: "" } as const;
    expect(trueupEstimate([
      { ...e, team: "support", method: "runrate", estimate: 1 },
      { ...e, team: "support", method: "trueup", estimate: 2 },
      { ...e, team: "search", method: "trueup", estimate: 3 },
    ], "support")).toBe(2);
  });
});
