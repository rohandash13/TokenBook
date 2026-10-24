# TrueUp: build brief (source of truth)

This is the original build brief, kept word for word. If anything here conflicts with `docs/PLAN.md`, this file wins on *what* to build; the plan decides *who* builds it and *when*.

---

You are scaffolding a hackathon repo for a 4-person team building TrueUp at Cal Hacks 13.0. The Devpost deadline is Sunday 9:00 AM PT, and the team freezes features Saturday 10:00 PM. Your job right now is a working skeleton: every module exists, every interface between modules is fixed, fake data flows end to end, and each of the 4 owners can start building their part immediately without waiting on anyone. Don't over-build any single module. Prefer simple, readable code.

## What TrueUp is

TrueUp closes the books on a company's AI API spend. Each month it:

1. pulls usage and cost per team (Anthropic Usage & Cost Admin API, plus an OpenAI fixture),
2. asks each team lead in Slack what's planned for the rest of the month,
3. estimates each team's monthly accrual (deterministic math, never the LLM),
4. prepares a balanced accrual journal entry for the controller to approve,
5. when the actual bill arrives, posts the reversal and true-up and computes the variance per team,
6. drafts an audit memo for significant variances, citing data and the lead's Slack reply,
7. tracks each team's over/under-accrual bias over time.

Demo company: Northwind Labs (fictional). Four teams: `support` (customer-facing AI agent → cost of revenue), `search`, `growth`, `platform` (internal → R&D). People: Dana (Controller), Marcus (CFO), Priya (Support lead), plus leads for the other teams.

## Stack (keep it simple)

* Node 22, TypeScript, npm, ESM. Single repo, no monorepo tooling.
* Server: Express. Storage: JSON files in `data/store/` behind a tiny `store.ts` (read/write helpers). No database.
* Web: Vite + React + TypeScript in `web/`, calling the server's REST API. Plain CSS or Tailwind; finance look (tables, right-aligned numbers).
* Slack: `@slack/bolt` in Socket Mode.
* LLM: `@anthropic-ai/sdk`, model from env `ANTHROPIC_MODEL`. Used ONLY for (a) turning Slack replies into structured drivers and (b) drafting memo text. Always validate LLM JSON with `zod`; on failure, retry once, then fall back.
* Tests: `vitest`.
* Scripts in `package.json`: `dev` (server + web concurrently), `gen` (generate fixtures), `test`, `slack` (start Slack app), `demo:reset` (reset store to fixtures).

## Folder layout

```
src/shared/types.ts        # the contracts below; the ONLY cross-module dependency
src/shared/config.ts       # teams, account map, thresholds, period helpers
src/fixtures/generate.ts   # Owner B
src/ingest/                # Owner B: anthropicAdmin.ts, openaiFixture.ts, loadUsage.ts
src/estimate/              # Owner A: estimate.ts, methods.ts, bias.ts (+ tests)
src/close/                 # Owner C: journal.ts, trueup.ts, variance.ts, memoTrigger.ts (+ tests)
src/slack/                 # Owner D: app.ts, checkin.ts, extractDrivers.ts
src/llm/                   # Owner D: client.ts, extractDrivers.ts, draftMemo.ts
src/server/                # Owner C: index.ts, routes.ts, store.ts
web/                       # Owner C: 3 screens
data/fixtures/             # generated + hand-written fakes
data/store/                # runtime state (gitignored)
```

Put a short `// OWNER: A|B|C|D` comment at the top of each module.

## Contracts (`src/shared/types.ts`) — write exactly these

```ts
export type Team = "support" | "search" | "growth" | "platform";
export type Month = string; // "2026-10"

export type UsageDay = { date: string; team: Team; model: string; costUsd: number; inputTokens: number; outputTokens: number; source: "anthropic" | "openai" };

export type TeamContext = {
  team: Team; month: Month; replied: boolean;
  events: { date: string; multiplier: number; note: string }[]; // e.g. launch on 2026-10-27, 3x
  quote?: string; repliedAt?: string; leadName?: string;
};

export type Method = "lastmonth" | "runrate" | "trueup";
export type Estimate = {
  team: Team; month: Month; asOf: string; method: Method;
  actualToDate: number; estimate: number;
  confidence: "high" | "medium" | "low"; basis: string; biasSuggestionPct?: number;
};

export type Actual = { team: Team; month: Month; actualUsd: number };

export type JournalLine = { account: string; team?: Team; debit: number; credit: number; memo: string; evidence: string[] };
export type JournalEntry = { id: string; month: Month; date: string; kind: "accrual" | "reversal" | "actual"; lines: JournalLine[]; status: "prepared" | "approved" | "exported"; approvedBy?: string };

export type Variance = { team: Team; month: Month; estimate: number; actual: number; varianceUsd: number; variancePct: number; needsMemo: boolean };

export type MemoInput = { team: Team; month: Month; estimate: number; actual: number; variancePct: number; basis: string; quote?: string; approvedBy: string; sources: string[] };
export type Memo = MemoInput & { text: string; createdAt: string };
```

## Config (`src/shared/config.ts`)

* Accounts: `5010 Cost of revenue – AI APIs` (support), `6130 R&D – AI APIs` (search, growth, platform), `2100 Accrued liabilities`, `2000 Accounts payable`.
* Memo threshold: `|variancePct| > 10%` AND `|varianceUsd| > $500` (configurable).
* Period helpers: days in month, days remaining from `asOf`.
* Team → lead name, Slack user id (from env/config), Anthropic workspace id / API key ids (for mapping).

## Module specs

### Owner B — fixtures + ingest

`src/fixtures/generate.ts` (seeded, deterministic) writes:

* `usage.json`: `UsageDay[]` for 9 months (2026-02 … 2026-10), all 4 teams, 2–3 models each, weekday/weekend pattern, growth trend, noise.
* Planted events (with ground truth in `events.json`): Support launch 2026-10-27 (~3x after), a Growth campaign planned for October that slips to November, a mid-period model price change, one month where a lead doesn't reply.
* `contexts.json`: `TeamContext[]` per team per month (what leads "said"; some wrong, one missing).
* `actuals.json`: `Actual[]` per team per month (sum of usage; October's actual reflects the slipped campaign).
* Also hand-write tiny fakes in `data/fixtures/fake/` FIRST (one month, 4 teams) so others can start before the generator is done.

`src/ingest/anthropicAdmin.ts`: client for `GET https://api.anthropic.com/v1/organizations/usage_report/messages` and `GET /v1/organizations/cost_report` with headers `x-api-key: $ANTHROPIC_ADMIN_KEY`, `anthropic-version: 2023-06-01`; support `starting_at`, `ending_at`, `bucket_width=1d`, `group_by[]=workspace_id`/`api_key_id`/`model`, pagination via `has_more`/`next_page`. Map workspace/key → team via config. If `ANTHROPIC_ADMIN_KEY` is missing, log a warning and return fixture data. Admin keys require an organization (individual accounts can't use it). `src/ingest/loadUsage.ts`: `loadUsage(month, asOf?): UsageDay[]` from API or fixtures.

### Owner A — estimate engine

`src/estimate/methods.ts`, pure functions:

* `lastMonth(team, month)`: last month's actual.
* `runRate(usage, asOf)`: `actualToDate + remainingDays × recentDailyRate` (recent = last 7 days, linear weights).
* `trueUp(usage, context, asOf, history)`: like run-rate, but each remaining day is multiplied by context event multipliers effective from their date; if `context.replied === false` use the trailing 3-month average daily cost for remaining days and set confidence `low`. Include a `basis` string explaining the inputs in plain English.
* `src/estimate/bias.ts`: per team, rolling mean of `(estimate − actual)/actual` over prior months → `biasSuggestionPct`. Shown as a suggestion only; never applied automatically.
* `estimateAll(month, asOf): Estimate[]` returning all three methods per team.
* Tests: worked example — Support has $6,120 through Oct 25 at ~$245/day; no context → ~$7,590; with a 3x event from Oct 27 → ~$10,040. Fallback path. Bias calc.

### Owner C — close engine, server, UI

`src/close/journal.ts`:

* `buildAccrual(month, estimates, approvedBy?)`: one JE: debit each team's expense account (5010 or 6130) by its `trueup` estimate, credit 2100 for the total; evidence = estimate basis + data source ids. Must balance (throw if not; test it).
* `buildReversal(accrualJE)`: opposite entry dated day 1 of next month.
* `buildActual(month, actuals)`: debit expense by team, credit 2000.
* `src/close/variance.ts`: per team `estimate` vs `actual` → `Variance`, `needsMemo` per thresholds.
* `src/close/memoTrigger.ts`: builds `MemoInput[]` for variances needing memos and calls `draftMemo` (Owner D) — use a placeholder text if the LLM is unavailable.
* Export: `toCsv(JournalEntry)` → columns `date,je_id,account,team,debit,credit,memo,evidence`. Label in UI: "ERP-ready export — this is where Hyphenate would post it."

`src/server/routes.ts` (REST, JSON):

* `GET /api/usage?month=` · `GET /api/estimates?month=&asOf=` · `GET /api/contexts?month=` · `POST /api/contexts` (from Slack)
* `POST /api/close/:month/prepare` → accrual JE (status prepared) · `POST /api/journal/:id/approve {approvedBy}` · `GET /api/journal/:id/export.csv`
* `POST /api/close/:month/actuals` (load actuals) → reversal + actual JEs + variances + memos · `GET /api/variances?month=` · `GET /api/memos?month=`
* `GET /api/history` → per team per month: estimates by method, actual, error % (for the proof table)
* `POST /api/demo/reset`

`web/` — three screens (from the team's wireframes):

1. Accrual review (Dana): header "October close · AI API accruals", table Team | Actual to date | Estimate | Basis | Confidence (low highlighted), footer showing the JE summary ("Dr AI API expense by team · Cr Accrued liabilities · balanced"), buttons Approve entry / Edit / Export CSV. Poll `/api/estimates` every 3s so a Slack reply updates the row live.
2. Slack check-in preview: read-only view of each team's latest `TeamContext` (quote, events, replied/no reply).
3. Variance & audit memo: left: variance by team (over/under, red when memo needed); right: memo text with sources; buttons Attach to close / Edit memo. Plus a simple History page: table of mean absolute error by method (last month / run-rate / TrueUp) and per-team bias.

### Owner D — Slack + LLM

`src/slack/app.ts` (Bolt, Socket Mode; env `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`):

* `sendCheckIn(team, month)`: DM the team lead: "Closing {Month} for {Team}. ${actualToDate} of AI APIs used so far." Then 3 prompts: launches/big runs? [Yes][No]; expected volume vs last week [Lower][Same][Higher][Much higher]; free-text "Anything else finance should know?"
* On reply: call `extractDrivers(text, buttons, month)` → `TeamContext`; POST to `/api/contexts`; reply with the confirmation ("Got it: launch Oct 27, about 3x. That moves your estimate from $X to $Y. Dana will review it.") using `/api/estimates`.
* Trigger check-ins via `POST /api/demo/checkin` or `npm run slack -- --checkin support` (no cron needed for the demo). `src/llm/extractDrivers.ts`: prompt Claude to return JSON `{ events: [{date, multiplier, note}], quote }`; zod-validate; on failure, use button answers only (e.g. Higher=1.3x, Much higher=2x from today). `src/llm/draftMemo.ts`: from `MemoInput`, draft a short auditor-ready memo: estimate, actual, variance, drivers used, the lead's quote with timestamp, approver, sources, and what changes next month. Must not invent numbers: pass all numbers in and instruct Claude to use only those.

## Environment (`.env.example`, never commit real values)

```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
ANTHROPIC_ADMIN_KEY=          # optional; org Admin key for usage/cost API
OPENAI_ADMIN_KEY=             # optional; otherwise fixture
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_LEAD_SUPPORT=           # Slack user ids for each lead
SLACK_LEAD_SEARCH=
SLACK_LEAD_GROWTH=
SLACK_LEAD_PLATFORM=
PORT=8787
```

## What to deliver in this session

1. The full folder structure, `package.json` scripts, `tsconfig`, `.gitignore` (`data/store`, `.env`), `.env.example`.
2. `src/shared/types.ts` and `config.ts` exactly as above.
3. Hand-written fake fixtures in `data/fixtures/fake/` (one month, 4 teams) and a working `generate.ts` for the 9-month set.
4. Working implementations (simple but real) of: `estimate/methods.ts` with tests, `close/journal.ts` + `variance.ts` with balanced-entry tests, server routes on the JSON store, the three web screens wired to the API.
5. Stubs with clear TODOs for: Anthropic Admin API client (fixture fallback working), Slack app (can send one check-in and receive one reply), `extractDrivers`, `draftMemo` (placeholder fallback working).
6. `README.md`: what TrueUp is, how to run (`npm i`, `npm run gen`, `npm run dev`, `npm run slack`), ownership table (A estimate, B data/ingest, C close/server/UI, D Slack/LLM/story), "real vs simulated" section, and a short accounting note (accrual → reversal → actual; Support is cost of revenue; not tax or accounting advice).
7. A `npm run demo:reset` that loads fixtures so the full flow works offline: estimates show → approve → load October actuals → variances + memos appear.

## Rules

* All money math is deterministic TypeScript. The LLM never produces a number that gets booked.
* Every journal entry balances; a test enforces it.
* Every displayed estimate and memo carries its `basis`/`sources`.
* No secrets in code. Everything works without API keys using fixtures.
* Keep each module behind the shared types so owners can work in parallel.
* When done, print a short checklist of what works end to end and what is stubbed, per owner.
