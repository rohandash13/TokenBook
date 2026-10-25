// OWNER: D
import { describe, expect, it } from "vitest";
import type { Estimate, Team, TeamContext } from "../shared/types.js";
import type { TrueUpApi } from "./api.js";
import type { Block, SlackClient } from "./checkin.js";
import { PendingStore } from "./extractDrivers.js";
import { buildOverview, buildOverviewBlocks, buildSummary, sendOverview } from "./overview.js";

const estimate = (team: Team, n: number, method: Estimate["method"] = "trueup"): Estimate => ({
  team, month: "2026-10", asOf: "2026-10-25", method, actualToDate: 0, estimate: n, confidence: "medium", basis: "",
});

const supportCtx: TeamContext = {
  team: "support", month: "2026-10", replied: false, inferred: true,
  events: [{
    date: "2026-10-27", multiplier: 3, note: "Support agent v2 launch", source: "slack",
    evidence: [
      { source: "slack", id: "slack:1", url: "https://slack.com/archives/C1/p1", text: "launches Oct 27", date: "2026-10-20" },
      { source: "github", id: "gh:milestone:1", url: "https://github.com/o/r/milestone/1", text: "m", date: "2026-10-27" },
    ],
  }],
};

const allText = (blocks: Block[]) => blocks.map((b) => (b.type === "section" ? b.text.text : "")).join("\n");

describe("buildOverview", () => {
  const out = buildOverview("support", "2026-10", supportCtx, estimate("support", 10040));
  const text = allText(out.blocks);

  it("lists the event with links, multiplier, estimate and the ask", () => {
    expect(text).toContain("Here's what TrueUp sees for Support in October 2026.");
    expect(text).toContain("• Support agent v2 launch — Oct 27, about 3x");
    expect(text).toContain("<https://slack.com/archives/C1/p1|Slack message, Oct 20>");
    expect(text).toContain("<https://github.com/o/r/milestone/1|GitHub milestone>");
    expect(text).toContain("Estimate for October: $10,040 (medium confidence).");
    expect(text).toContain("*Reply here only if this is wrong*");
    expect(out.text).toContain("Reply here only if this is wrong");
    expect(buildOverviewBlocks("support", "2026-10", supportCtx, undefined)).toHaveLength(3);
  });

  it("labels PR and release evidence", () => {
    const ctx: TeamContext = { ...supportCtx, events: [{ ...supportCtx.events[0], evidence: [
      { source: "github", id: "gh:pr:5", url: "u1", text: "", date: "2026-10-01" },
      { source: "github", id: "gh:release:6", url: "u2", text: "", date: "2026-10-01" },
    ] }] };
    const t = allText(buildOverview("support", "2026-10", ctx, undefined).blocks);
    expect(t).toContain("<u1|GitHub PR>");
    expect(t).toContain("<u2|GitHub release>");
    expect(t).not.toContain("Estimate for");
  });

  it("says so when there are no events", () => {
    const t = allText(buildOverview("growth", "2026-10", undefined, estimate("growth", 5000)).blocks);
    expect(t).toContain("Nothing unusual found in Slack or GitHub.");
    expect(t).toContain("Reply here only if this is wrong");
  });

  it("acknowledges a confirmed reply instead of asking", () => {
    const ctx: TeamContext = { ...supportCtx, replied: true, repliedAt: "2026-10-22T10:00:00Z" };
    const t = allText(buildOverview("support", "2026-10", ctx, estimate("support", 10040)).blocks);
    expect(t).toContain("You already confirmed this on Oct 22.");
    expect(t).not.toContain("Reply here only if");
  });
});

describe("buildSummary", () => {
  it("shows the source per team and the total", () => {
    const estimates = [
      estimate("support", 10040), estimate("support", 1, "runrate"),
      estimate("growth", 3000), estimate("search", 2000), estimate("platform", 1000),
    ];
    const contexts: TeamContext[] = [
      { ...supportCtx, replied: true },
      { team: "growth", month: "2026-10", replied: false, inferred: true, events: supportCtx.events },
      { team: "search", month: "2026-10", replied: false, inferred: true, events: [] },
    ];
    const { text, blocks } = buildSummary("2026-10", estimates, contexts);
    expect(text).toContain("Support: $10,040 — lead confirmed");
    expect(text).toContain("Growth: $3,000 — inferred from Slack/GitHub");
    expect(text).toContain("Search: $2,000 — run-rate, no signal");
    expect(text).toContain("Platform: $1,000 — run-rate, no signal");
    expect(text).toContain("Total accrual: $16,040");
    expect(allText(blocks)).toContain("Total accrual: $16,040");
  });
});

describe("sendOverview", () => {
  it("refreshes, posts to the lead's DM and registers a pending check-in", async () => {
    const calls: string[] = [];
    const posted: { channel: string; text: string; blocks?: Block[] }[] = [];
    const client: SlackClient = {
      conversations: { open: async ({ users }) => ({ channel: { id: `D-${users}` } }) },
      chat: { postMessage: async (a) => { posted.push(a); return {}; } },
    };
    const api: TrueUpApi = {
      postContext: async () => {},
      getEstimates: async () => [estimate("support", 10040)],
      getActualToDate: async () => 0,
      getContexts: async () => [supportCtx],
      refreshSignals: async () => { calls.push("refresh"); throw new Error("down"); },
    };
    const pending = new PendingStore();
    await sendOverview(client, "support", "2026-10", { api, pending, env: { SLACK_LEAD_SUPPORT: "U123" } });
    expect(calls).toEqual(["refresh"]);
    expect(posted).toHaveLength(1);
    expect(posted[0].channel).toBe("D-U123");
    expect(posted[0].text).toContain("$10,040");
    expect(pending.get("U123")).toEqual({ team: "support", month: "2026-10", buttons: {} });
  });

  it("throws when the lead id is not configured", async () => {
    const client = {} as SlackClient;
    await expect(sendOverview(client, "support", "2026-10", { api: {} as TrueUpApi, pending: new PendingStore(), env: {} })).rejects.toThrow();
  });
});

describe("buildOverview confirmed without a date", () => {
  it("drops the date when repliedAt is missing", () => {
    const t = buildOverview("support", "2026-10", { ...supportCtx, replied: true }, undefined).text;
    expect(t).toContain("You already confirmed this.");
    expect(t).not.toContain(" on .");
  });
});
