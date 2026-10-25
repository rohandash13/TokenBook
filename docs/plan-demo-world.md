# Demo world: a full synthetic Northwind Labs in Slack and GitHub

Goal: one command (`npm run seed:demo`) fills the TrueUp Slack workspace and four GitHub repos with a believable October 2026 at Northwind Labs: 4 teams, ~16 personas, team and shared channels, threads, milestones, issues, merged PRs and releases. Lots of noise, few real drivers. TrueUp must book only what's real.

Decisions (Nikhil, 6:30 PM): keep the 4 finance teams (no `Team` type change); Nikhil creates the extra repos; seed writes use a separate `GITHUB_SEED_TOKEN`; TrueUp's own `GITHUB_TOKEN` stays read-only.

## The story (October 2026, as of Oct 25)

| Team | What really happens in October | Noise that must NOT become a driver | Expected TrueUp result |
| --- | --- | --- | --- |
| Support | Support agent v2 goes to all customers Oct 27, ~3x API traffic. Confirmed in #support-eng, #launches, a GitHub milestone due Oct 27, a merged PR, an RC release. | Staging load test "no prod impact"; an Oct 18 incident spike already in actuals. | 1 event: 2026-10-27, 3x |
| Growth | Fall campaign was planned for Oct 26 (~2x) but creative slipped it to Nov 4. Milestone moved Oct 26 → Nov 4. | Maya's lead reply still says Oct 26 (stale). Early "kicks off Oct 26" messages. | No October event (slip); flags that the lead's reply disagrees with signals |
| Search | Nothing changes in October. Reindex v3 is scheduled Nov 10 ("2x for a few days in November"). | Reranker shipped (latency, not volume); staging load test; November reindex. | No event |
| Platform | Nothing changes in October. Legacy embeddings pipeline retired Nov 15 (will lower spend). Key rotation. | Oct 18 incident (past); November deprecation. | No event |

Keeps `data/fixtures/events.json` ground truth: Support launch Oct 27 3x; Growth planned Oct 26 2x, slipped.

## Contracts

- `src/demo/scenario.ts` (done): `Scenario`, `Persona`, `SeedChannel`, `SeedMessage`, `SeedRepo`…, `SEED_EVENT_TYPE = "trueup_seed"`, `SEED_GITHUB_MARKER`.
- `seedSlack(scenario, client, opts: { reset?: boolean; dryRun?: boolean; log?: (m: string) => void }): Promise<{ channels: number; posted: number; deleted: number }>` in `src/demo/seedSlack.ts`.
- `seedGithub(scenario, opts: { token: string; fetch?: typeof fetch; reset?: boolean; dryRun?: boolean; log?: (m: string) => void }): Promise<{ milestones: number; issues: number; prs: number; releases: number; deleted: number }>` in `src/demo/seedGithub.ts`.
- `scenarioToFixtures(scenario): { slack: Signal[]; github: Signal[] }` in `src/demo/toFixtures.ts`, written to `data/fixtures/signals/*.json` so the offline demo matches the live one.
- CLI `src/demo/seed.ts`, script `"seed:demo"`: flags `--slack`, `--github` (default both), `--reset` (wipe seeded items first), `--dry-run`, `--fixtures` (only regenerate fixture files).
- Slack posts: `chat.postMessage` with `username` = persona name, `icon_url` = persona avatar, `metadata: { event_type: "trueup_seed", event_payload: { id } }`, `thread_ts` for replies.
- Config (`src/shared/config.ts`): `TEAM_SIGNALS[team].slackChannels` = team channels; new `SHARED_CHANNELS: { name: string; teams: Team[] }[]` and `TEAM_KEYWORDS: Record<Team, string[]>`; repos per team updated.

## Tasks

| # | Task | Model | Files |
| --- | --- | --- | --- |
| W0 | Scenario types; trueUp: inferred with no upcoming events = run-rate at medium ("checked Slack and GitHub, nothing found"); demo reset clears October replies for Support, Search and Platform (Growth keeps Maya's stale reply) | Opus | `src/demo/scenario.ts`, `src/estimate/methods.ts`+test, `src/server/demoReset.ts`+test |
| W1 | Scenario content + fixture generator + scenario tests | Sonnet | `data/demo/scenario.json`, `src/demo/loadScenario.ts`, `src/demo/toFixtures.ts`, `src/demo/scenario.test.ts`, `data/fixtures/signals/*.json` |
| W2 | Slack seeder + CLI | Sonnet | `src/demo/seedSlack.ts`+test, `src/demo/seed.ts`, `package.json` script |
| W3 | GitHub seeder | Sonnet | `src/demo/seedGithub.ts`+test |
| W4 | Readers: seeded bot messages, thread replies, shared channels by keyword, single-team repos take everything; config | Sonnet | `src/signals/slack.ts`+test, `src/signals/github.ts`+test, `src/shared/config.ts` |
| W5 | Review | Sonnet | read-only |
| W6 | Seed live, refresh, rehearse, push | Opus | — |

## Nikhil's setup

1. Slack bot scopes `chat:write.customize`, `channels:manage`; reinstall; update `SLACK_BOT_TOKEN`.
2. Create repos `northwind-search`, `northwind-growth`, `northwind-platform` (with README).
3. `GITHUB_SEED_TOKEN`: fine-grained, the 4 northwind repos, Read and write on Contents, Issues, Pull requests. Extend the read-only `GITHUB_TOKEN` to the 3 new repos.
4. Delete the three messages posted by hand in `#support-eng` and `#growth` (the bot can't delete a person's messages); the seed re-creates them as personas. The old "Fall campaign" milestone in `northwind-demo` is removed by the GitHub seeder (`legacyCleanup` in the scenario).
