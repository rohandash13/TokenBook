# TrueUp: team plan

Who builds what, and when. The full brief is [`docs/SPEC.md`](SPEC.md). The live version of this plan, with checklists to tick off, is the team doc: https://claude.ai/artifact/CBJnM6o8sAcUm4iyWQ8Fxi

Deadlines (Cal Hacks 13.0): feature freeze **Sat Oct 24, 10:00 PM PT**; Devpost closes **Sun Oct 25, 9:00 AM PT** (aim for 8:30).

## Owners

| Owner | Area | Folders | Hands to others |
| --- | --- | --- | --- |
| A · Antoine | Estimate engine | `src/estimate/` | `estimateAll(month, asOf): Estimate[]`, `biasSuggestionPct` |
| B · Junghwan | Fixtures and ingest | `src/fixtures/`, `src/ingest/`, `data/fixtures/` | `loadUsage(month, asOf?)`, 9-month fixtures, `events.json` ground truth |
| C · Rohan | Close engine, server, web | `src/close/`, `src/server/`, `web/` | REST API, journal entries, variances, CSV export, screens |
| D · Nikhil | Slack, LLM, story | `src/slack/`, `src/llm/`, README, demo | `extractDrivers`, `draftMemo`, Slack check-in, pitch, video |

The only thing modules share is `src/shared/types.ts` (plus `config.ts`). Changing it needs all four people to agree, in one commit, and everyone rebases.

## Hour zero (before anyone builds modules)

Rohan drives; Junghwan writes the fakes in parallel. About 45 minutes.

- [ ] Repo skeleton: Node 22, TypeScript, ESM, npm; scripts `dev`, `gen`, `test`, `slack`, `demo:reset`; `tsconfig`; `.gitignore` (`data/store`, `.env`); `.env.example` (names only)
- [ ] `src/shared/types.ts` exactly as in the spec; `src/shared/config.ts`
- [ ] Hand-written fakes in `data/fixtures/fake/` (2026-10, four teams)
- [ ] Every module file exists with `// OWNER: X` and a stub returning fake data of the right type
- [ ] `npm test` and `npm run dev` green on the stubs

Then each owner works on a branch and merges small commits into `main` at least every two hours.

## Schedule and gates (Saturday, proposed; shift to the real start)

| Phase | Hours | Gate at the end |
| --- | --- | --- |
| Hour zero | 12:30 to 1:15 | Types locked |
| Build on fakes | 1:15 to 3:00 | Fake data flows end to end |
| Make it real | 3:00 to 6:00 | A Slack reply moves an estimate row |
| Integrate | 6:00 to 8:00 | Full demo dry run |
| Polish | 8:00 to 10:00 | Feature freeze |
| Sunday | 6:00 to 8:30 AM | README numbers, video, submit |

A lane that misses a gate switches to its fallback below instead of holding up the others.

## Hardest parts, in order

1. **C (Rohan)**: most surface area and the integration hub; everyone plugs into its API.
2. **D (Nikhil)**: Slack app setup, LLM validation, no invented numbers in memos, plus the pitch.
3. **A (Antoine)**: small but exact math; tests pinned to $7,590 and $10,040. Takes the History page off C when done.
4. **B (Junghwan)**: easiest, but the fakes are needed in hour one. Helps C or D after 3 PM.

## Demo flow (about 3 minutes, offline from `npm run demo:reset`)

1. Dana opens accrual review: four teams, estimates with basis, Support low confidence.
2. Priya gets the Slack check-in and replies "launching Oct 27, expect about 3x".
3. Within 3 seconds Support moves from about $7,590 to about $10,040, citing Priya's reply.
4. Dana approves the balanced entry and exports the CSV ("this is where Hyphenate would post it").
5. October actuals load: reversal and actual entries post, variances appear.
6. Growth's slipped campaign trips the memo threshold; the memo cites data and the lead's quote.
7. History shows TrueUp's error vs last-month and run-rate, plus each team's bias.

## Risks and fallbacks

| Risk | Fallback | Owner |
| --- | --- | --- |
| Slack app or tokens not ready by the 6 PM gate | `POST /api/contexts` from a small form on the check-in preview screen | Nikhil |
| No Anthropic org Admin key | Fixtures only, labelled simulated in the README | Junghwan |
| LLM returns bad JSON or invented numbers | Retry once, then button-only drivers or placeholder memo | Nikhil |
| Contract change needed mid-build | All four agree, one commit to `types.ts`, everyone rebases | Rohan |
| C overloaded | D or A builds History; Edit buttons stay disabled | Rohan, Nikhil |
| Live demo fails on stage | Backup video recorded Saturday night | Nikhil |

Cut order if time runs short: Admin API client → History page → Edit memo → OpenAI fixture.

## Open questions

- Whose Slack workspace hosts the bot, and who creates the app and tokens?
- Does the team have an Anthropic organization with an Admin key? Without one, usage stays fixture-only.
