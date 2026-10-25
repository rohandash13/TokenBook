# TrueUp: feature-to-demo plan

## Product promise and scope

For Dana, the controller: close AI API expenses before the bill arrives, using engineering context with evidence and a human approval step. The visible story is **engineering change → revised forecast → budget consequence → approved close → explained variance**.

Use one synthetic company, Northwind Labs, and October 2026 as of October 25. Slack/GitHub connectors are real integrations; the staged company content and usage/billing history are synthetic. The rehearsed offline path uses fixtures. The 3-minute script is in `docs/demo.md`.

Do not give every feature equal stage time. Every screen must answer what changed, why to trust it, or what Dana does next.

## Every feature and its presentation role

| Feature | Judge-visible proof | Placement | Preparation / limitation |
| --- | --- | --- | --- |
| Overview and close checklist | Four teams, close status, next action | Opening, 10–15 seconds | Start before refresh/approval; controller sign-offs are UI workflow, not enterprise authentication. |
| Usage/cost ingestion and team mapping | $6,120 used by Support as of Oct 25 | Opening accrual row | Demo usage and bills are fixtures. Admin API client exists; do not claim this run fetched a real company bill. |
| Three estimate methods | Run-rate beside contextual TrueUp estimate | Main story, explain one difference | Last-month comparison belongs in Accuracy or Q&A; do not explain all formulas live. |
| Slack signal collection | Real channel message saying Oct 27 / ~3x API traffic | Main story | Open one evidence permalink beforehand; live source access must be rehearsed. |
| GitHub signal collection | Supporting milestone and its due date | Main story | One milestone is enough; release/PR readers are additional coverage for Q&A. |
| Claude extraction and deterministic guard | Parsed date/size with source citations | Main story, one sentence | Claude proposes structured drivers; code validates them and calculates dollars. Do not claim the LLM never proposes a number. |
| Review flags / noise rejection | Unsized launch flagged or “2x faster” not used | Main story only if a verified example is ready; otherwise Q&A | Review flags do not supply booked multipliers. Do not add a new message during the timed demo without rehearsal. |
| Bounded spikes / zero-traffic windows | A driver with an inclusive end date | Recorded extension or Q&A | Extraction and accounting regression tests cover these; no need to walk through edge cases in the pitch. |
| Source badges, excerpts and confidence | $7,590.28 low → $10,040 medium; clickable evidence | Main story | Confidence is a rule-based category, not a calibrated probability. |
| Slack check-in / overview / lead override | DM summarizing what was found; lead confirms or corrects | Live extension or replace the noise segment after rehearsal | Requires one Slack bot process. No shell command on the projector. A lead reply overrides inferred context; do not claim stale replies are automatically overruled. |
| Manual driver fallback | Add driver form when an integration is unavailable | Backup / Q&A | Disclose manual entry; never present it as automatic inference. |
| Team budgets | Support projected $10,040 against $8,500; $1,540 over | Main story, ~15 seconds | View the already-seeded budget; do not edit limits live. |
| Company model caps | Opus projected ~$1,395 against a $1,300 cap | Same Budgets screen; optional sentence | Fixture-model identifiers and synthetic usage. Alerting does not stop API calls. |
| Editable spend policies | Change a team limit or model cap | Q&A | Existing UI supports edits; preserve rehearsed limits before recording. |
| Controller estimate edits | Visible override separate from calculated estimate | Q&A | Use only before approval; approval locks the booked entry. |
| Balanced journal and human approval | Debits equal credits; Approve entry | Main story | Verified fixture total: $23,960 on each side after refresh. |
| CSV export | Download/open a real exported journal | Main story | Say ERP-ready CSV. No live ERP/Hyphenate posting is implemented in this path. |
| Reversal and actual entry | Load actuals produces both entries | Main story, show outcome | Label simulated bill advance; do not suggest the bill arrived in real time. |
| Variance detection | Growth $898.78 over-accrued, 19.32%, memo required | Main story | Both 10% and $500 thresholds must be exceeded. |
| Audit memo with cited sources | Growth explanation and source links | Main story | Offline memo is deterministic fallback; Claude drafts with a valid key. Verify live draft before recording. |
| Memo edit and attach | Controller edits/attaches a memo | Optional closing click / Q&A | “Attach” is an internal workflow state, not external filing. |
| Historical method accuracy | Mean absolute error across fixture months | Q&A / recorded extension | This is financial forecast backtesting on synthetic data, separate from extraction precision/recall. |
| Team bias suggestions | Over/under-accrual trend | Q&A | Suggestions only; no model retraining or automatic adjustment. |
| Jira inbound (Forge) | Team-labelled issue with due date becomes a forecast driver | Atlassian-specific extension | Rehearse actual Forge delivery before claiming live integration. Current Jira path can use kind-label default multipliers; Slack/GitHub unknown-size controls are not universal across connectors. |
| Jira outbound follow-up | A material variance creates a linked investigation task | Atlassian-specific extension | Requires configured Forge trigger. A stored fixture row is not proof of live delivery. |
| Apify model price changes | Provider price evidence and team cost impact | Apify-specific extension | Live scrape latency/failure can exceed pitch budget. Prefer verified cached result with disclosure; do not promise live scrape success. |
| Apify market/news context | News with citations, explicitly context-only | Q&A | News does not independently change booked numbers. |
| Reset and offline fallback | Repeatable starting state; same close workflow | Backstage reliability | Reset leaves Support unscanned. Refresh with `{offline:true}` is required to reveal its fixture driver. Do not refresh before the opening take. |
| Tests and extraction evaluations | One compact proof statement | Closing / Q&A | Quote the latest committed report with dataset/run qualification. Development extraction scores are not forecast accuracy or a guarantee on new data. |

## Recommended presentation variants

**General / finance pitch:** use the 3-minute core script. Prioritize the Slack/GitHub-to-close transformation, budget consequence, and evidence. The product's value is completing a finance task, not listing connectors.

**Atlassian extension (60–90 seconds):** use a pre-rehearsed Jira issue update, show the forecast effect, then the variance investigation task if delivery is configured. Replace another segment; do not append this to an already full three minutes.

**Apify extension (45–60 seconds):** show a sourced provider price change, affected teams and deterministic cost impact. Distinguish pricing data from context-only news. Run the scrape before judging unless it is consistently fast.

**Technical Q&A:** guard rules, hostile inputs, isolated offline fallback, balancing tests, extraction evaluation, then historical forecast comparison. Have report/screenshots available without opening source code.

## Verified offline fixture anchors

Verified with the real default estimate dependencies in a separate `/tmp` store, without touching the running demo's store:

- Before refresh: Support **$7,590.28**, low confidence; after refresh: **$10,040**, medium; actual-to-date **$6,120**.
- Other post-refresh estimates: Search **$5,580**, Growth **$5,550**, Platform **$2,790**.
- Support budget **$8,500**, projected overrun **$1,540**. Opus projection **$1,394.98** against **$1,300** cap.
- Prepared, approved and exported accrual: **$23,960 debits = $23,960 credits**; CSV has header + five journal lines.
- October actuals: Support **$10,052.45**, Search **$5,592.32**, Growth **$4,651.22**, Platform **$2,788.59**.
- Growth over-accrual **$898.78 / 19.32%** produces the only required memo; offline memo has **8 source strings**. Reversal and actual journal entries are created.

These are offline anchors, not a claim that live Slack/GitHub/Jira/Apify or the browser layout has been rehearsed. Live changes can alter the numbers.

## Finish gates

1. Complete one browser walkthrough and fix visible blockers only.
2. Rehearse the core path three times from reset. One presenter, one driver; hidden terminal preflight.
3. Record a complete backup before extra polish; keep the app and recording available offline.
4. Prepare project image, public/accessibly shared video, repository link, real-vs-simulated explanation, and sponsor-specific descriptions. Verify links while signed out where appropriate.
5. Freeze the demo branch/state, rerun appropriate checks after changes, and submit with buffer before the event deadline.
