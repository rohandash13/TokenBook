# Hand-written fakes (OWNER: B)

One month (2026-10), four teams, usage through **Oct 25** (the demo `asOf`). Use these until `npm run gen` produces the 9-month set. October totals and actuals here match the generator exactly.

| Team | To date (Oct 1–25) | Oct 19–25 daily | Run-rate (6 days left) | Context | TrueUp estimate | Oct actual |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| support | 6,120 | 245 | 7,590 | no reply yet (Priya) | 7,590 → 10,040 after Priya's 3x from Oct 27 | 10,052 |
| search | 4,500 | 180 | 5,580 | "Steady month" | 5,580 | 5,592 |
| growth | 3,750 | 150 | 4,650 | 2x from Oct 26 (campaign) | 5,550 | 4,651 (campaign slipped) |
| platform | 2,250 | 90 | 2,790 | "No big runs" | 2,790 | 2,789 |

- Oct 19–25 is flat on purpose, so the 7-day recent rate is exactly the daily number whatever weights are used. Oct 1–18 has a weekday/weekend shape.
- Growth variance: (5,550 − 4,651) / 4,651 = 19.3%, $899 → trips the memo threshold. The others stay under it.
- Support starts with `replied: false` so it shows low confidence. Note: the spec's no-reply fallback uses the trailing 3-month average, which these one-month fakes don't have. The generator makes Support's Jul–Sep average $245/day, so the fallback also gives $7,590.
- `search` and `platform` include an OpenAI model (`source: "openai"`). Token counts are rough (cost ÷ $6/M, 80/20 in/out).
- Lead names other than Priya (Leo, Maya, Sam) are placeholders; change them in `config.ts` if the team picks others.
