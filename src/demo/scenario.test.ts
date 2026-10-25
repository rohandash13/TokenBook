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
});
