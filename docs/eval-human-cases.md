# Write 10 test cases for TrueUp (about 15 minutes)

TrueUp reads a team's Slack and GitHub and decides whether something will change that team's AI API spend later this month. We need cases written by humans, because the code has only been tested against data written by Claude.

**Rules:** don't look at `src/llm/inferDrivers.ts` or the other test sets first. Write messages the way your team actually talks.

**The setup for every case:** it's **Oct 25, 2026**. A "driver" is a change in API call volume that starts **on a specific day between Oct 26 and Oct 31**, with a multiplier vs. a normal day (3x, 0.5x, 1.5x…). Anything else (wrong month, already happened, hypothetical, cancelled, about speed not volume, another company's traffic, a joke) must book **nothing**.

**Make about half real drivers and half traps you think would fool it.** For each case, fill in:

```
Team: support | search | growth | platform
Messages (1–5, in order; Slack or GitHub):
  - [Slack, Oct 22, Priya] "..."
  - [GitHub milestone, due Oct 28] "..."
Should book: Oct 28, 2x        (or: nothing)
Why: one line
```

Ideas: "+50% calls from the 29th", "triple the tokens once the batch job lands", a thread where someone says "scrap that" two replies later, "next Tuesday" (work out the date), a release note that implies load, "2–3x" (what would you book?), typos, emoji, numbers in words.

Paste your cases in the team chat or send them to Nikhil. They're converted into `data/eval/human/` and scored as the gold-standard set.
