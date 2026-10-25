# Signals: TrueUp reads Slack and GitHub instead of waiting on leads

Owner: Nikhil (D), with small asks of Rohan (C), Antoine (A) and Junghwan (B).
Goal for tonight's 10 PM freeze: for each team, TrueUp collects the month's Slack and GitHub activity, infers forecast drivers with cited evidence, and uses them when the lead hasn't replied. A lead's reply still overrides. The Slack bot sends a month-start "here's what we see, reply only if wrong" overview and a month-end summary.

Cut: Jira, private channels, thread replies beyond the first message.

## How it fits the current code

- `TeamContext` already carries `events: {date, multiplier, note}[]`. Inferred drivers become events with two optional extra fields (`source`, `evidence`), and the context gets `inferred: true` with `replied: false`.
- `POST /api/contexts` already upserts one context per team and month, so a lead's reply replaces an inferred context. The refresh job must never overwrite a context with `replied: true`.
- `estimateAll` in `src/estimate/estimate.ts` is still a stub. Antoine's real `trueUp` must apply events when `replied || inferred`, with confidence `medium` for inferred-only. Until it lands, the estimate does not move.

## Shared contract changes (T0, needs the team's OK)

```ts
// src/shared/types.ts — additive, all optional
export type Evidence = { source: "slack" | "github"; id: string; url: string; text: string; date: string; author?: string };
export type ContextEvent = { date: string; multiplier: number; note: string; source?: "lead" | "slack" | "github"; evidence?: Evidence[] };
export type TeamContext = {
  team: Team; month: Month; replied: boolean;
  events: ContextEvent[];
  quote?: string; repliedAt?: string; leadName?: string;
  inferred?: boolean; inferredAt?: string;
};

// src/signals/types.ts — internal to the signals lane
export type SignalKind = "message" | "milestone" | "release" | "pr";
export type Signal = {
  id: string;            // "slack:C123:1729790000.0001", "gh:milestone:org/repo:7"
  source: "slack" | "github"; kind: SignalKind;
  team: Team; date: string;       // YYYY-MM-DD the signal was created
  text: string;                   // message text, or "Milestone 'Support agent launch' due 2026-10-27"
  url: string; author?: string;
  dueDate?: string;               // milestones only
  previousDueDate?: string;       // milestones only, when the fixture/API shows it moved
  labels?: string[];              // PRs only
};
```

Config (`src/shared/config.ts`): `TEAM_SIGNALS: Record<Team, { slackChannels: string[]; githubRepos: string[] }>` and `KIND_MULTIPLIER = { launch: 2, campaign: 1.5, load_test: 1.3, deprecation: 0.8 }`.

## Number and date guard (the safety rule)

An inferred event is kept only if all of these hold, else it is dropped:
1. It cites at least one signal id that exists in the input.
2. Its date is inside the month and equals either a cited signal's `dueDate` or a date written in a cited signal's text.
3. Its multiplier either appears verbatim in a cited signal's text ("3x", "~3x", "3×", "triple" → 3) or equals `KIND_MULTIPLIER[kind]`.
4. No cited milestone has `dueDate` outside the month (a slipped milestone produces no event).

Without an LLM, a deterministic rule produces the same kind of event: a milestone due in the month whose title matches launch/campaign/load test keywords, at the table multiplier, plus a verbatim multiplier from a Slack message mentioning the same date.

## Tasks, models and waves

| # | Task | Model | Files | Wave |
| --- | --- | --- | --- | --- |
| T0 | Contracts: types, Signal type, config, server schema accepts new fields; commit pending fixes; remove button debug logs | Opus (lead session) | `src/shared/types.ts`, `src/shared/config.ts`, `src/signals/types.ts`, `ContextBody` in `src/server/routes.ts`, `src/slack/app.ts` | 0 |
| T1 | Slack channel reader + fixture fallback | Sonnet | `src/signals/slack.ts`, test | 1 |
| T2 | GitHub reader (milestones, releases, labelled merged PRs) + fixture fallback | Sonnet | `src/signals/github.ts`, test | 1 |
| T3 | `inferDrivers`: LLM + guard + deterministic fallback | Sonnet (Opus-written brief) | `src/llm/inferDrivers.ts`, test | 1 |
| T7 | Signal fixtures matching `events.json` ground truth | Haiku | `data/fixtures/signals/slack.json`, `github.json` | 1 |
| T4 | Refresh job, routes, CLI | Sonnet | `src/signals/refresh.ts`, test, route group in `src/server/routes.ts`, `package.json` script | 2 |
| T5 | Month-start overview and month-end summary DMs | Sonnet | `src/slack/overview.ts`, test, `src/slack/trigger.ts`, `src/slack/app.ts` | 2 |
| T6 | Source badges and evidence links in the UI | Sonnet | `web/src/screens/CheckinPreview.tsx`, `web/src/screens/AccrualReview.tsx`, `web/src/api.ts` if needed | 2 |
| T8 | Review the whole diff | Sonnet (`d-reviewer`) | read-only | 3 |
| T9 | Integration run, fix-ups, docs, commit, push | Opus (lead session) | `docs/handoff-d.md`, README section | 3 |

Why these models: Opus only where judgement matters (contracts, briefs, integration). Sonnet for each module with tests. Haiku for writing fixture JSON from an exact spec.

### T1 brief: Slack reader
`readSlackSignals(team, month, deps): Promise<Signal[]>`. Resolve channel names in `TEAM_SIGNALS[team].slackChannels` to ids with `conversations.list` (public channels, paginate on `response_metadata.next_cursor`). For each, `conversations.history` with `oldest`/`latest` set to the month's first day minus 14 days through the month's last day, paginated, skipping messages with a `subtype` and bot messages. Map each to a `Signal` (`kind: "message"`, date from `ts` in UTC, url from `chat.getPermalink` or `https://slack.com/archives/<channel>/p<ts without dot>`). The client is injected (`Pick<WebClient, "conversations" | "chat">`-shaped interface). No `SLACK_BOT_TOKEN`, or any API error → read `data/fixtures/signals/slack.json` filtered by team and month, and log one warning. Tests with a fake client: pagination, subtype and bot skipping, date conversion, fixture fallback.

### T2 brief: GitHub reader
`readGithubSignals(team, month, deps): Promise<Signal[]>` for each repo in `TEAM_SIGNALS[team].githubRepos` (`owner/name`). REST with `fetch`, headers `Authorization: Bearer $GITHUB_TOKEN`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`:
- `GET /repos/{o}/{r}/milestones?state=all&per_page=100` → `kind: "milestone"`, `dueDate` from `due_on`, text `"Milestone '<title>' due <date>: <description>"`.
- `GET /repos/{o}/{r}/releases?per_page=30` → releases published in the window.
- `GET /search/issues?q=repo:{o}/{r}+is:pr+is:merged+merged:{from}..{to}` → PRs, keep `labels`.
`fetch` is injected. No `GITHUB_TOKEN`, a non-2xx, or a network error → fixture `data/fixtures/signals/github.json` filtered by team and month, one warning. Tests with a fake fetch for each endpoint, the window filter, and the fallback.

### T3 brief: inferDrivers
`inferDrivers(team, month, signals, llm?): Promise<{ events: ContextEvent[]; dropped: { reason: string; event: unknown }[] }>`.
- Prompt Claude (via `completeJson`) for `{ "events": [{ "kind": "launch|campaign|load_test|deprecation", "date": "YYYY-MM-DD", "multiplier": number, "note": "2-5 words", "evidenceIds": ["..."] }] }`, with the signals as a numbered list of `id | date | source/kind | text | dueDate | previousDueDate`. Tell it: only events that change AI API volume this month; cite ids; use a multiplier only if stated in a cited signal, else omit it; a milestone moved out of the month means no event.
- Run every proposed event through the guard above. Fill a missing multiplier from `KIND_MULTIPLIER`. Attach `evidence` built from the cited signals and `source` = the source of the first cited signal.
- No LLM, or `completeJson` returns null → the deterministic rule. Return sorted events and the dropped list (for logging and tests).
- Export `guardEvent` and `parseMultiplier(text)` for tests.
- Tests: verbatim "~3x" accepted; invented 4x rejected; date not in any cited signal rejected; uncited event rejected; slipped milestone rejected; deterministic fallback on the fixture set gives Support a launch on 2026-10-27 at 3 and Growth no October event.

### T7 brief: fixtures (Haiku)
Write `data/fixtures/signals/slack.json` and `github.json` as `Signal[]` for 2026-10 matching `data/fixtures/events.json`:
- Support: a `#support-eng` message on 2026-10-20 from Priya, "Support agent v2 launches Oct 27, expect ~3x traffic on the API", and a milestone "Support agent v2 launch" due 2026-10-27 in `northwind-demo/support-agent`.
- Growth: a `#growth` message on 2026-10-08, "Fall campaign kicks off Oct 21", then 2026-10-19, "Campaign pushed to Nov 4, creative not ready", and a milestone "Fall campaign" with `dueDate` 2026-11-04 and `previousDueDate` 2026-10-21.
- Search and Platform: 2 or 3 routine messages each with no volume change.
Read `events.json` first and match its dates and multipliers exactly where they overlap.

### T4 brief: refresh job and routes
`refreshSignals(month, deps): Promise<{ team; signals: number; events: number; skipped?: "lead replied" }[]>`. For each team: if the stored context for (team, month) has `replied: true`, skip. Else read both sources, `inferDrivers`, and upsert `{ team, month, replied: false, inferred: true, inferredAt, events, leadName }`. Keep the last signals per team in memory for `GET /api/signals?month=&team=`. Routes, added at the `APPEND NEW ROUTE GROUPS` marker: `POST /api/signals/refresh?month=` and `GET /api/signals`. `demoReset` runs one refresh from fixtures after seeding, except it must not create a context for the live team that would hide the "no reply yet" state; instead the live team gets its inferred context, which is the new demo moment. Script `"signals": "tsx src/signals/refresh.ts"` with a CLI that refreshes `DEMO.month`. Tests with fake readers and store.

### T5 brief: overview DMs
`src/slack/overview.ts`: `buildOverviewBlocks(team, month, context, estimate)`, which says "Here's what TrueUp sees for {Team} in {Month}", lists each event with its date, multiplier, source and evidence links, then shows the trueup estimate, followed by "Reply here only if this is wrong." With no events, it says "Nothing unusual found. Estimate $X." `buildSummaryBlocks(month, estimates)` is the month-end summary per team with method, estimate and basis. `sendOverview(client, team, month, deps)` DMs the lead and registers a pending check-in so a reply goes through the existing `handleReply`. Add `POST /overview {team, month?}` and `POST /summary {month?}` to `trigger.ts`, and `--overview <team>` / `--summary` to the CLI. Tests for both block builders and the pending registration.

### T6 brief: UI
`CheckinPreview.tsx`: per team, a badge for "Lead replied", "Inferred from Slack/GitHub" or "No signal". Each event shows a source badge and its evidence as links with date and a one-line excerpt. Add a "Refresh signals" button calling `POST /api/signals/refresh`. `AccrualReview.tsx`: the confidence cell shows the source badge next to confidence. Keep the existing manual-reply form. Run `npm run typecheck`.

## Human tasks (Nikhil), while helpers run

1. Tell the team in one message: the additive `types.ts` change; Antoine's `trueUp` must use events when `replied || inferred` (confidence medium); Rohan, two new routes and badges are going into his files.
2. In the Slack app: add bot scopes `channels:history` and `channels:read`, reinstall the app, and paste the new bot token into `.env` if it changed. Create `#support-eng` and `#growth`, then `/invite @TrueUpApp` in each and post the demo messages from T7.
3. GitHub: create the demo repos (or one repo with both milestones) and the two milestones, then make a fine-grained read-only token for those repos and set `GITHUB_TOKEN` in `.env`.

## Risks

- Antoine's estimate is still a stub, so inferred events change nothing on screen until his `trueUp` lands. Fallback: T4 can set the stub to apply event multipliers for demo-only use, clearly marked, if Antoine is not merged by 8 PM.
- The button-click bug is still open. Overviews are confirm-by-exception, so the demo no longer depends on buttons.
- Reinstalling the Slack app can rotate the bot token, so update `.env` after the reinstall.
