# Owner D (Nikhil): Slack, LLM, story

Branch: `d/slack-llm`. Touch only `src/llm/`, `src/slack/` and their tests. `package.json`, `tsconfig.json` and `src/shared/types.ts` on this branch are temporary stand-ins until Rohan's skeleton lands on `main`; on rebase, keep Rohan's versions and add D's three dependencies (`@anthropic-ai/sdk`, `@slack/bolt`, `zod`).

Spec: `docs/SPEC.md` (Owner D section). Rules that matter most here:
- The LLM never produces a number that gets booked or shown as fact.
- Every LLM JSON reply is validated with zod, retried once, then a deterministic fallback runs.
- Everything works with no keys: no `ANTHROPIC_API_KEY` means fallbacks; no Slack tokens means the Slack app logs and exits.

## Fixed interfaces (do not change without telling the other D tasks)

```ts
// src/llm/client.ts (done)
type LlmClient = { complete(system: string, user: string): Promise<string> };
getLlm(env?): LlmClient | null;
completeJson<T>(llm, system, user, schema): Promise<T | null>; // retry once, null = fall back

// src/llm/extractDrivers.ts
type Volume = "lower" | "same" | "higher" | "much_higher";
type CheckInButtons = { launches?: "yes" | "no"; volume?: Volume };
type ExtractInput = { team; month; text; buttons; today; leadName?; repliedAt? };
extractDrivers(input: ExtractInput, llm?): Promise<TeamContext>;
driversFromButtons(input: ExtractInput): TeamContext;

// src/llm/draftMemo.ts
draftMemo(input: MemoInput, llm?, now?): Promise<Memo>;
placeholderMemo(input: MemoInput): string;
```

The REST API is Rohan's (`docs/SPEC.md`, server routes). The Slack app reaches it at `TRUEUP_API_URL` (default `http://localhost:8787`) and uses only `POST /api/contexts`, `GET /api/estimates?month=&asOf=` and `GET /api/usage?month=`.

## Tasks

| # | Task | Status | Depends on |
| --- | --- | --- | --- |
| 1 | LLM client: `client.ts` | done | — |
| 2 | `extractDrivers` + button fallback + tests | delegated | 1 |
| 3 | `draftMemo` + number guard + placeholder + tests | delegated | 1 |
| 4 | Slack app: check-in DM, buttons, reply, confirmation + tests | delegated | interfaces of 2 |
| 5 | Create the Slack app and tokens (browser) | Nikhil | — |
| 6 | Live test: DM yourself, reply, see `/api/contexts` updated | Nikhil | 4, 5, Rohan's routes |
| 7 | README sections, demo script, Devpost write-up, backup video | Nikhil | after the 8 PM dry run |

### Task 2: extractDrivers
- Prompt Claude for `{ "events": [{ "date": "YYYY-MM-DD", "multiplier": number, "note": string }], "quote": string }`.
- Validate: dates inside `month`, multiplier > 0 and ≤ 10, note ≤ 120 chars. Any failure after one retry → `driversFromButtons`.
- Fallback: `volume` higher = 1.3x, much_higher = 2x, lower = 0.8x, same or missing = no event; each event starts at `today`. `launches: "yes"` with no volume adds no number on its own (note only, multiplier 1).
- Result: `replied: true`, `quote` = the lead's own words (never the model's paraphrase), `repliedAt`, `leadName`.
- Tests with a fake `LlmClient`: good JSON; bad JSON then good (retry); bad twice (fallback); out-of-month date rejected; each button mapping; no LLM.

### Task 3: draftMemo
- Prompt includes every number from `MemoInput` and tells Claude to use only those.
- Guard: extract every number from the draft (`$10,040`, `12.4%`, `10040`); each must match a number derivable from the input (estimate, actual, variance in dollars, variancePct, and dates in the month or quote). Any other number → placeholder.
- Placeholder: deterministic template with estimate, actual, variance ($ and %), basis, the lead's quote with timestamp if any, approver, sources, and a "next month" line.
- Tests: no LLM → placeholder; clean draft kept; draft with an invented number rejected; placeholder contains every input number and source.

### Task 4: Slack app
- `src/slack/checkin.ts`: pure `buildCheckInBlocks(team, month, actualToDate)` (header text from the spec, Yes/No buttons, Lower/Same/Higher/Much higher buttons, free-text prompt) and `sendCheckIn(client, team, month)` that opens a DM with the lead from `SLACK_LEAD_<TEAM>`.
- `src/slack/extractDrivers.ts`: map Bolt action ids/values to `CheckInButtons`; keep per-user pending answers in memory.
- `src/slack/app.ts`: Bolt in Socket Mode (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`). On a DM text reply: call `extractDrivers`, `POST /api/contexts`, fetch estimates before and after, reply with "Got it: … That moves your estimate from $X to $Y. Dana will review it." `npm run slack -- --checkin support` sends one check-in. Missing tokens → log and exit 0.
- Pure `buildConfirmation(context, before, after)` with tests; API calls behind a small `api.ts` so tests can fake them.

## API keys: who holds what

| Key | Who gets it | Who needs it in `.env` |
| --- | --- | --- |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET` | Nikhil (creates the Slack app) | Whoever runs `npm run slack` (Nikhil; the demo laptop) |
| `SLACK_LEAD_*` member ids | Nikhil | Same |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Nikhil (proposed; one team key) | Nikhil and the demo laptop; others optional |
| `ANTHROPIC_ADMIN_KEY` | Junghwan, only if the team has an Anthropic organization | Junghwan and the demo laptop |
| `OPENAI_ADMIN_KEY` | Nobody; fixture only | — |

Keys live only in each person's local `.env` (gitignored). Share them person to person through a password manager or a direct message, never in the repo, the plan doc or a public channel.
