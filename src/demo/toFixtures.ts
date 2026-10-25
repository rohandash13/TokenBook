// OWNER: D
// Turns the demo scenario into the offline Slack/GitHub signal fixtures (what the readers would see live).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Team } from "../shared/types.js";
import type { Signal } from "../signals/types.js";
import { loadScenario } from "./loadScenario.js";
import type { Scenario } from "./scenario.js";
// Same team matching as the live Slack reader, so the offline demo sees exactly what the live one would.
import { mentionsTeam } from "../signals/slack.js";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function slackTs(day: string, index: number): string {
  const secs = Date.parse(`${day}T09:00:00Z`) / 1000 + index * 60;
  return `${secs}.000100`;
}

export function scenarioToFixtures(scenario: Scenario): { slack: Signal[]; github: Signal[] } {
  const slack: Signal[] = [];
  const names = new Map(scenario.personas.map((p) => [p.id, p.name]));
  const channels = new Map(scenario.channels.map((c) => [c.name, c]));
  scenario.messages.forEach((m, i) => {
    const channel = channels.get(m.channel);
    if (!channel) throw new Error(`unknown channel ${m.channel}`);
    const cid = `C_${m.channel.toUpperCase().replace(/-/g, "_")}`;
    const ts = slackTs(m.day, i);
    const teams =
      channel.teams.length === 1
        ? channel.teams
        : channel.teams.filter((t) => mentionsTeam(t, m.text));
    for (const team of teams) {
      slack.push({
        id: `slack:${cid}:${ts}`,
        source: "slack",
        kind: "message",
        team,
        date: m.day,
        text: m.text,
        url: `https://northwind.slack.com/archives/${cid}/p${ts.replace(".", "")}`,
        author: names.get(m.persona) ?? m.persona,
      });
    }
  });

  const github: Signal[] = [];
  for (const r of scenario.repos) {
    const author = r.repo.split("/")[0];
    r.milestones.forEach((ms, i) => {
      const n = i + 1;
      const moved = /moved from ([A-Za-z]+)\.? (\d{1,2})/i.exec(ms.description);
      let previousDueDate: string | undefined;
      if (moved) {
        const mo = MONTHS.indexOf(moved[1].slice(0, 3).toLowerCase()) + 1;
        if (mo > 0) previousDueDate = `${ms.dueOn.slice(0, 4)}-${String(mo).padStart(2, "0")}-${moved[2].padStart(2, "0")}`;
      }
      github.push({
        id: `gh:milestone:${r.repo}:${n}`,
        source: "github",
        kind: "milestone",
        team: r.team,
        date: "2026-10-24",
        dueDate: ms.dueOn,
        ...(previousDueDate ? { previousDueDate } : {}),
        text: `Milestone '${ms.title}' due ${ms.dueOn}${ms.description ? `: ${ms.description}` : ""}`,
        url: `https://github.com/${r.repo}/milestone/${n}`,
        author,
      });
    });
    r.prs.forEach((pr, i) => {
      if (!pr.merge) return;
      const n = r.issues.length + i + 1;
      github.push({
        id: `gh:pr:${r.repo}:${n}`,
        source: "github",
        kind: "pr",
        team: r.team,
        date: "2026-10-23",
        labels: pr.labels,
        text: `PR #${n} ${pr.title}`,
        url: `https://github.com/${r.repo}/pull/${n}`,
        author,
      });
    });
    for (const rel of r.releases) {
      github.push({
        id: `gh:release:${r.repo}:${rel.tag}`,
        source: "github",
        kind: "release",
        team: r.team,
        date: "2026-10-24",
        text: `Release ${rel.tag}: ${rel.body}`,
        url: `https://github.com/${r.repo}/releases/tag/${rel.tag}`,
        author,
      });
    }
  }
  return { slack, github };
}

// CLI: `npx tsx src/demo/toFixtures.ts` writes data/fixtures/signals/{slack,github}.json
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { slack, github } = scenarioToFixtures(loadScenario());
  mkdirSync("data/fixtures/signals", { recursive: true });
  writeFileSync("data/fixtures/signals/slack.json", JSON.stringify(slack, null, 2) + "\n");
  writeFileSync("data/fixtures/signals/github.json", JSON.stringify(github, null, 2) + "\n");
  console.log(`wrote ${slack.length} slack and ${github.length} github signals`);
}
