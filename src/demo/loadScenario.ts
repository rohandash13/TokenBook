// OWNER: D
import { readFileSync } from "node:fs";
import type { Scenario } from "./scenario.js";

/** Reads the demo scenario JSON and checks that its references resolve. Throws a clear Error otherwise. */
export function loadScenario(path = "data/demo/scenario.json"): Scenario {
  const s = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  const personas = new Set(s.personas.map((p) => p.id));
  const channels = new Set(s.channels.map((c) => c.name));
  const ids = new Set(s.messages.map((m) => m.id));
  if (ids.size !== s.messages.length) throw new Error("scenario: duplicate message ids");
  for (const m of s.messages) {
    if (!channels.has(m.channel)) throw new Error(`scenario: message ${m.id} uses unknown channel "${m.channel}"`);
    if (!personas.has(m.persona)) throw new Error(`scenario: message ${m.id} uses unknown persona "${m.persona}"`);
    if (m.replyTo && !ids.has(m.replyTo)) throw new Error(`scenario: message ${m.id} replies to unknown message "${m.replyTo}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.day) || m.day.slice(0, 7) !== s.month) {
      throw new Error(`scenario: message ${m.id} day "${m.day}" is not in ${s.month}`);
    }
  }
  return s;
}
