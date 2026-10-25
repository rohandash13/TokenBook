# TrueUp

TrueUp closes the books on a company's AI API spend. Each month it asks team leads what's planned via Slack, estimates monthly accruals, prepares balanced journal entries, and drafts audit memos for significant variances.

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
