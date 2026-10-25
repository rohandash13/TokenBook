# TrueUp demo script (3 minutes)

**One line:** TrueUp closes the books on a company's AI API spend. It reads what teams are already saying in Slack and GitHub, books an accrual an auditor can defend, and only asks a human when it has to.

## Before you go on stage (5 minutes)

```bash
cd ~/Desktop/TrueUp
npm run dev          # API on :8787, web on :5173
npm run slack        # Slack app (Socket Mode); trigger on :8788
npm run demo:reset   # clean October state (offline, deterministic)
npm run signals      # optional: refresh from the live Slack + GitHub
```

Open http://localhost:5173, Slack (`#support-eng`, `#launches`, `#growth`), and https://github.com/nikhilrajgopal/northwind-demo/milestones in tabs.

**If Wi-Fi, Slack or GitHub fails:** skip `npm run signals`. `demo:reset` already loads the same world from fixtures, so every screen shows the same numbers.

## The click path

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | — | — | "Every month finance has to guess AI API spend before the bill arrives. Today that means chasing team leads in Slack, and half of them never reply." |
| 0:15 | **Accrual review** | Point at Support: **$10,040, medium, Slack/GitHub badge** | "Priya never replied. TrueUp read #support-eng and the GitHub milestone, found a launch on Oct 27 at about 3x, and moved Support from $7,590 to $10,040." |
| 0:40 | **Slack check-ins** | Click the Slack evidence link, then the GitHub one | "Every number cites its evidence. Here's the exact message, here's the milestone." |
| 1:00 | **Slack check-ins** | Point at Search and Platform: "Checked Slack and GitHub: no upcoming changes" | "Those channels are full of traps: a reranker that's '2x faster', a reindex in November, a cancelled widget launch, a Black Friday 4x. None of it is booked, because none of it is October API volume." |
| 1:20 | **Slack** | `curl -s -X POST localhost:8788/overview -H 'Content-Type: application/json' -d '{"team":"support"}'` (don't start a second `npm run slack`), show the DM | "Instead of asking leads to fill in a form, TrueUp tells them what it found and asks them to reply only if it's wrong." Reply "looks right" → "Keeping support agent v2 launch Oct 27, about 3x." |
| 1:45 | **Accrual review** | Approve entry → Export CSV | "One balanced journal entry: debit AI expense by team, credit accrued liabilities. ERP-ready; this is where Hyphenate would post it." |
| 2:05 | **Variance & memo** | Load October actuals | "Growth's lead said the campaign goes live Oct 26. Slack and GitHub said it slipped to Nov 4. The bill agrees with Slack. TrueUp drafts the audit memo with the data and her quote, using only numbers it was given." |
| 2:30 | **History** | Error by method, per-team bias | "And it learns which teams over- or under-estimate." |
| 2:45 | — | — | "We tested this honestly: a blind test set written without seeing our code, and a red team trying to make it book the wrong number. The controls hold: every number needs evidence, and a human approves the entry." |

## Questions judges will ask

- **"What stops someone gaming it by posting in Slack?"** Every booked number must appear in cited evidence about API volume; instructions inside messages are ignored; unsized launches are flagged, not booked; a lead's reply overrides; the controller approves the entry. We red-teamed it (see `data/eval/redteam/`).
- **"How accurate is it?"** Quote the blind test numbers from `npm run eval:history` as they are, including the baseline. Don't round up.
- **"Does the LLM ever produce a booked number?"** No. It proposes; deterministic code checks every date and multiplier against the evidence, and the money math is plain TypeScript.
- **"What's real vs simulated?"** Slack and GitHub are real APIs on a synthetic company (Northwind Labs). Usage and billing data are fixtures; the Anthropic Admin API client exists but the demo uses fixtures.
