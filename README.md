# TokenBook

TokenBook closes the books on a company's AI API spend. Each month it asks team leads what's planned via Slack, estimates monthly accruals, prepares balanced journal entries, and drafts audit memos for significant variances.

Built at Cal Hacks 13.0 by Antoine, Junghwan, Rohan, and Nikhil.

## Stack

Node 22 · TypeScript · ESM · Express · Vite + React · Slack Bolt (Socket Mode) · Anthropic SDK · vitest

## Setup

```bash
cp .env.example .env   # fill in your keys
npm install
npm test               # 41 tests, no keys needed
```

## Running

```bash
npm run dev            # server + web (once Rohan's server is up)
npm run slack          # start the Slack bot
npm run slack -- --checkin support --month 2026-10   # trigger one check-in DM
```

## Environment variables

See `.env.example`. Everything works offline from fixtures without any API keys — missing `ANTHROPIC_API_KEY` falls back to deterministic placeholders; missing Slack tokens logs and exits cleanly.

## Modules

| Folder | Owner | What it does |
| --- | --- | --- |
| `src/estimate/` | Antoine | Estimate engine: run-rate, last-month, TrueUp methods, bias tracking |
| `src/ingest/` | Junghwan | Anthropic Admin API client, OpenAI fixture, usage loader |
| `src/close/` | Rohan | Journal entries, variance, memo triggers |
| `src/server/` | Rohan | Express REST API, JSON store |
| `src/llm/` | Nikhil | LLM client, `extractDrivers`, `draftMemo` (all zod-validated) |
| `src/slack/` | Nikhil | Bolt app, check-in DM, button/reply handling |
| `web/` | Rohan | React dashboard: accrual review, journal, history |
| `data/fixtures/` | Junghwan | 9-month generated fakes + hand-written October ground truth |

Full spec: [`docs/SPEC.md`](docs/SPEC.md) · Team plan: [`docs/PLAN.md`](docs/PLAN.md)


## Local Slack and GitHub demo access

Slack source links use real permalinks in the **Northwind** demo workspace (`northwindlabsglobal.slack.com`). After seeding or changing the workspace domain, run `npx tsx src/demo/syncSlackLinks.ts`; this reads existing seed-tagged messages, repairs local evidence URLs, and posts nothing.

The GitHub demo repositories are private. Sign into GitHub with an account that can access `nikhilrajgopal/northwind-demo`, `northwind-search`, `northwind-growth` and `northwind-platform` before clicking evidence links. Browser authentication is separate from the server's API access.

For API collection, prefer a repo-scoped read-only `GITHUB_TOKEN`. On this development machine, `GITHUB_USE_CLI=1` in the local `.env` opts into the existing `gh auth login` session when no token is supplied. The adapter only runs GET requests for milestone/release/search endpoints; it never copies the CLI credential into `.env` or uses the seed token. This option depends on the locally installed/authenticated `gh` CLI and is not production credential setup.

Run `npx tsx src/signals/refresh.ts --deterministic` to read live Slack/GitHub and extract locally without sending source text to Claude. `--offline` uses fixtures and does not use CLI authentication. Lead replies are preserved. A browser refresh may be needed after a CLI refresh.
