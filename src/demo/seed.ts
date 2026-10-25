// OWNER: D
// CLI: npm run seed:demo [-- --slack --github --reset --dry-run --fixtures]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebClient } from "@slack/web-api";
import { loadScenario } from "./loadScenario.js";
import { seedGithub } from "./seedGithub.js";
import { seedSlack } from "./seedSlack.js";
import { scenarioToFixtures } from "./toFixtures.js";

async function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    /* no .env */
  }
  const args = new Set(process.argv.slice(2));
  const reset = args.has("--reset");
  const dryRun = args.has("--dry-run");
  const scenario = loadScenario();

  if (args.has("--fixtures")) {
    const fx = scenarioToFixtures(scenario);
    const dir = path.join("data", "fixtures", "signals");
    fs.mkdirSync(dir, { recursive: true });
    for (const k of ["slack", "github"] as const) {
      fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(fx[k], null, 2) + "\n");
      console.log(`wrote ${path.join(dir, `${k}.json`)} (${fx[k].length} signals)`);
    }
    return;
  }

  const explicit = args.has("--slack") || args.has("--github");
  const doSlack = !explicit || args.has("--slack");
  const doGithub = !explicit || args.has("--github");
  const log = (m: string) => console.log(m);

  const slackToken = process.env.SLACK_BOT_TOKEN;
  const ghToken = process.env.GITHUB_SEED_TOKEN;
  if (doSlack && !slackToken) throw new Error("SLACK_BOT_TOKEN is not set (see .env.example).");
  if (doGithub && !ghToken) throw new Error("GITHUB_SEED_TOKEN is not set. It is required for seeding; GITHUB_TOKEN is never used.");

  if (doSlack) {
    const s = await seedSlack(scenario, new WebClient(slackToken), { reset, dryRun, log });
    console.log(`Slack: ${s.channels} channels, ${s.posted} posted, ${s.deleted} deleted${dryRun ? " (dry run)" : ""}`);
  }
  if (doGithub) {
    const g = await seedGithub(scenario, { token: ghToken!, reset, dryRun, log });
    console.log(
      `GitHub: ${g.milestones} milestones, ${g.issues} issues, ${g.prs} PRs, ${g.releases} releases, ${g.deleted} deleted${dryRun ? " (dry run)" : ""}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
