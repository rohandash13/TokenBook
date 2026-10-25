// OWNER: D
import { describe, expect, it } from "vitest";
import { inferDrivers } from "../llm/inferDrivers.js";
import { TEAMS } from "../shared/config.js";
import { loadScenario } from "./loadScenario.js";
import { scenarioToFixtures } from "./toFixtures.js";

const scenario = loadScenario();

describe("demo scenario", () => {
  it("has the expected size", () => {
    expect(scenario.personas.length).toBeGreaterThanOrEqual(15);
    expect(scenario.messages.length).toBeGreaterThanOrEqual(70);
    expect(scenario.messages.filter((m) => m.replyTo).length).toBeGreaterThanOrEqual(8);
  });

  it("resolves persona and channel references", () => {
    const personas = new Set(scenario.personas.map((p) => p.id));
    const channels = new Set(scenario.channels.map((c) => c.name));
    for (const m of scenario.messages) {
      expect(personas.has(m.persona), m.id).toBe(true);
      expect(channels.has(m.channel), m.id).toBe(true);
    }
  });

  it("rejects a bad scenario with a clear message", () => {
    expect(() => loadScenario("does-not-exist.json")).toThrow();
  });

  it("makes TrueUp infer exactly the expected events for every team (deterministic path)", async () => {
    const { slack, github } = scenarioToFixtures(scenario);
    for (const team of TEAMS) {
      const signals = [...slack, ...github].filter((s) => s.team === team);
      const res = await inferDrivers(team, scenario.month, signals, null);
      expect(
        res.events.map((e) => ({ date: e.date, multiplier: e.multiplier })),
        team,
      ).toEqual(scenario.expected[team].events.map((e) => ({ date: e.date, multiplier: e.multiplier })));
    }
  });

  it("carries a closed milestone's state into the signal text", () => {
    const { github } = scenarioToFixtures(scenario);
    const m = github.find((s) => s.text.startsWith("Milestone 'Search widget beta'"));
    expect(m?.text).toBe("Milestone 'Search widget beta' (closed) due 2026-10-29: Cancelled \u2014 not shipping");
  });

  it("has decoys in every category's size range, all ids prefixed dx- and days within Oct 1-25", () => {
    const dx = scenario.messages.filter((m) => m.decoy);
    expect(dx.length).toBeGreaterThanOrEqual(30);
    for (const m of dx) {
      expect(m.id.startsWith("dx-"), m.id).toBe(true);
      expect(m.day >= "2026-10-01" && m.day <= "2026-10-25", m.id).toBe(true);
    }
    const gh = scenario.repos.flatMap((r) => [...r.milestones, ...r.issues, ...r.prs, ...r.releases]).filter((x) => x.decoy);
    expect(gh.length).toBeGreaterThanOrEqual(6);
  });

  it("every decoy Slack message, milestone, merged PR and release appears in at least one team's fixtures", () => {
    const { slack, github } = scenarioToFixtures(scenario);
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    for (const m of scenario.messages.filter((x) => x.decoy)) {
      expect(slack.some((s) => norm(s.text) === norm(m.text)), m.id).toBe(true);
    }
    for (const r of scenario.repos) {
      for (const ms of r.milestones.filter((x) => x.decoy)) {
        expect(github.some((s) => s.kind === "milestone" && s.text.startsWith(`Milestone '${ms.title}'`)), ms.title).toBe(true);
      }
      for (const pr of r.prs.filter((x) => x.decoy)) {
        expect(github.some((s) => s.kind === "pr" && s.text.endsWith(pr.title)), pr.title).toBe(true);
      }
      for (const rel of r.releases.filter((x) => x.decoy)) {
        expect(github.some((s) => s.kind === "release" && s.text.startsWith(`Release ${rel.tag}:`)), rel.tag).toBe(true);
      }
    }
  });

  // Issues are not read as signals (SignalKind has no "issue"), so issue decoys cannot appear in fixtures.
  it("issue decoys exist in the scenario but are not carried as signals", () => {
    const { github } = scenarioToFixtures(scenario);
    const issues = scenario.repos.flatMap((r) => r.issues).filter((i) => i.decoy);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    for (const i of issues) expect(github.some((s) => s.text.includes(i.title))).toBe(false);
  });

  // One test per decoy Slack message so a failure names exactly which decoy got booked.
  describe("no kept event cites a decoy message (deterministic path)", () => {
    const { slack, github } = scenarioToFixtures(scenario);
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    const decoyIds = new Map<string, string>(); // signal id -> scenario id
    for (const m of scenario.messages.filter((x) => x.id.startsWith("dx-"))) {
      for (const s of slack) if (norm(s.text) === norm(m.text)) decoyIds.set(s.id, m.id);
    }
    const kept = new Map<string, string[]>(); // scenario decoy id -> "team date xN" strings
    const ready = (async () => {
      for (const team of TEAMS) {
        const signals = [...slack, ...github].filter((s) => s.team === team);
        const res = await inferDrivers(team, scenario.month, signals, null);
        for (const e of res.events) {
          for (const ev of e.evidence ?? []) {
            const dx = decoyIds.get(ev.id);
            if (dx) kept.set(dx, [...(kept.get(dx) ?? []), `${team} ${e.date} x${e.multiplier}`]);
          }
        }
      }
    })();
    for (const m of scenario.messages.filter((x) => x.id.startsWith("dx-"))) {
      it(`${m.id} (${m.channel}) is not cited by any kept event`, async () => {
        await ready;
        expect(kept.get(m.id) ?? [], m.text).toEqual([]);
      });
    }
    it("no kept event is built on a decoy GitHub item", async () => {
      await ready;
      const ghDecoyTitles = scenario.repos
        .flatMap((r) => [...r.milestones, ...r.prs, ...r.releases.map((x) => ({ title: x.tag, decoy: x.decoy }))])
        .filter((x) => x.decoy)
        .map((x) => x.title);
      for (const team of TEAMS) {
        const res = await inferDrivers(team, scenario.month, [...slack, ...github].filter((s) => s.team === team), null);
        for (const e of res.events) {
          for (const ev of e.evidence ?? []) {
            for (const t of ghDecoyTitles) expect(ev.text.includes(t), `${team} ${e.date}: ${ev.id}`).toBe(false);
          }
        }
      }
    });
  });
});
