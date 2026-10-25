// OWNER: D
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextEvent, Month, Team, TeamContext } from "../shared/types.js";
import { listContexts } from "../server/store.js";
import { clearSignalCache, defaultRefreshDeps, lastSignals, refreshSignals, type RefreshDeps } from "./refresh.js";
import type { Signal } from "./types.js";

const sig = (team: Team, id: string): Signal => ({
  id, source: "slack", kind: "message", team, date: "2026-10-20", text: "hi", url: "https://x/" + id,
});
const event: ContextEvent = { date: "2026-10-27", multiplier: 3, note: "launch", source: "slack" };

function fakeDeps(over: Partial<RefreshDeps> = {}, stored: TeamContext[] = []) {
  const saved: TeamContext[] = [];
  const deps: RefreshDeps = {
    readSlack: vi.fn(async (team: Team) => [sig(team, "s1")]),
    readGithub: vi.fn(async (team: Team) => [sig(team, "g1")]),
    infer: vi.fn(async () => ({ events: [event], dropped: [], usedLlm: false })),
    getContext: (team: Team, month: Month) => stored.find((c) => c.team === team && c.month === month),
    saveContext: (c) => { saved.push(c); },
    now: () => "2026-10-24T00:00:00.000Z",
    log: () => {},
    ...over,
  };
  return { deps, saved };
}

describe("refreshSignals", () => {
  it("skips teams whose lead replied without reading or writing", async () => {
    const { deps, saved } = fakeDeps({}, [{ team: "support", month: "2026-10", replied: true, events: [] }]);
    const out = await refreshSignals("2026-10", deps, ["support"]);
    expect(out).toEqual([{ team: "support", signals: 0, events: 0, usedLlm: false, skipped: "lead replied" }]);
    expect(deps.readSlack).not.toHaveBeenCalled();
    expect(deps.readGithub).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("saves an inferred context with events and inferredAt, and caches signals", async () => {
    const { deps, saved } = fakeDeps();
    const out = await refreshSignals("2026-10", deps, ["support"]);
    expect(out).toEqual([{ team: "support", signals: 2, events: 1, usedLlm: false }]);
    expect(saved).toEqual([{
      team: "support", month: "2026-10", replied: false, inferred: true,
      inferredAt: "2026-10-24T00:00:00.000Z", events: [event], leadName: "Priya",
    }]);
    expect(lastSignals("support", "2026-10").map((s) => s.id)).toEqual(["s1", "g1"]);
  });

  it("keeps an existing lead name", async () => {
    const { deps, saved } = fakeDeps({}, [{ team: "support", month: "2026-10", replied: false, events: [], leadName: "Pri" }]);
    await refreshSignals("2026-10", deps, ["support"]);
    expect(saved[0].leadName).toBe("Pri");
  });

  it("still saves an inferred context when there are zero events", async () => {
    const { deps, saved } = fakeDeps({ infer: async () => ({ events: [], dropped: [{}], usedLlm: false }) });
    const out = await refreshSignals("2026-10", deps, ["growth"]);
    expect(out[0].events).toBe(0);
    expect(saved[0]).toMatchObject({ team: "growth", inferred: true, replied: false, events: [] });
  });

  it("does not save when the lead replies during the reads", async () => {
    const replied: TeamContext = { team: "support", month: "2026-10", replied: true, events: [] };
    const getContext = vi.fn()
      .mockReturnValueOnce({ team: "support", month: "2026-10", replied: false, events: [] })
      .mockReturnValueOnce(replied);
    const { deps, saved } = fakeDeps({ getContext });
    const out = await refreshSignals("2026-10", deps, ["support"]);
    expect(out).toEqual([{ team: "support", signals: 2, events: 0, usedLlm: false, skipped: "lead replied" }]);
    expect(saved).toEqual([]);
  });

  it("skips and saves nothing when a live source fell back to fixtures", async () => {
    const { deps, saved } = fakeDeps({ sourceFellBack: (team) => team === "support" });
    const out = await refreshSignals("2026-10", deps, ["support", "growth"]);
    expect(out[0]).toEqual({ team: "support", signals: 0, events: 0, usedLlm: false, skipped: "source unavailable" });
    expect(out[1].skipped).toBeUndefined();
    expect(saved.map((c) => c.team)).toEqual(["growth"]);
  });

  it("clearSignalCache empties lastSignals", async () => {
    const { deps } = fakeDeps();
    await refreshSignals("2026-10", deps, ["search"]);
    expect(lastSignals("search", "2026-10")).toHaveLength(2);
    clearSignalCache();
    expect(lastSignals("search", "2026-10")).toEqual([]);
  });

  it("reads both sources for every non-skipped team", async () => {
    const { deps, saved } = fakeDeps({}, [{ team: "search", month: "2026-10", replied: true, events: [] }]);
    const out = await refreshSignals("2026-10", deps);
    expect(out.map((r) => r.skipped)).toEqual([undefined, "lead replied", undefined, undefined]);
    expect(deps.readSlack).toHaveBeenCalledTimes(3);
    expect(deps.readGithub).toHaveBeenCalledTimes(3);
    expect(saved).toHaveLength(3);
  });
});

describe("defaultRefreshDeps online fallback detection", () => {
  it("flags a team when GITHUB_TOKEN is set but the GitHub reader fell back (fake fetch)", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "fake");
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deps = defaultRefreshDeps();
      expect(deps.sourceFellBack!("support", "2026-10")).toBe(false);
      await deps.readGithub("support", "2026-10");
      expect(deps.sourceFellBack!("support", "2026-10")).toBe(true);
      expect(deps.sourceFellBack!("support", "2026-10")).toBe(false); // consumed
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("does not flag a fallback for a source whose token is unset", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deps = defaultRefreshDeps();
      await deps.readSlack("support", "2026-10");
      await deps.readGithub("support", "2026-10");
      expect(deps.sourceFellBack!("support", "2026-10")).toBe(false);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe("defaultRefreshDeps offline on fixtures", () => {
  beforeEach(() => {
    process.env.TRUEUP_STORE_DIR = mkdtempSync(join(tmpdir(), "trueup-refresh-"));
  });

  it("gives support one 3x launch on 2026-10-27 and growth none", async () => {
    const deps = { ...defaultRefreshDeps({ offline: true }), log: () => {} };
    const out = await refreshSignals("2026-10", deps);
    expect(out.find((r) => r.team === "support")?.events).toBe(1);
    expect(out.find((r) => r.team === "growth")?.events).toBe(0);
    const ctxs = listContexts("2026-10");
    const support = ctxs.find((c) => c.team === "support")!;
    expect(support.inferred).toBe(true);
    expect(support.events).toHaveLength(1);
    expect(support.events[0]).toMatchObject({ date: "2026-10-27", multiplier: 3 });
    expect(ctxs.find((c) => c.team === "growth")).toMatchObject({ inferred: true, events: [] });
  });
});
