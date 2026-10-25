# TrueUp Part C (Close Engine, Server, Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Rohan's lane (C): the hour-zero repo skeleton and shared contract, the deterministic close engine (journal entries, variances, memo triggers, CSV), the REST API over a JSON-file store, and the four web screens that carry the October-close demo.

**Architecture:** Pure TypeScript functions in `src/close/` do all of C's booking math in integer cents and are unit-tested. A Hono app in `src/server/` gets A/B/D's modules through a `Deps` object, so the tests can swap in fakes and the server keeps working on stubs. A Vite + React app in `web/` talks only to `/api/*` through the Vite proxy and polls every 3 seconds.

**Tech Stack:** Node 22, TypeScript (ESM, `moduleResolution: Bundler`, run with `tsx`), npm, Hono + `@hono/node-server`, zod, Vitest, Vite + React 18+, concurrently.

## Global Constraints

- Node 22, TypeScript, ESM, npm. Scripts: `dev`, `gen`, `test`, `slack`, `demo:reset` (plus `typecheck`).
- `.gitignore` covers `data/store` and `.env`. `.env.example` lists variable names only.
- `src/shared/types.ts` is the contract. After hour zero, changes need all four people to agree and land as one commit.
- Accounts: 5010 = Support expense; 6130 = Search, Growth and Platform expense; 2100 = accrued liabilities; 2000 = accounts payable.
- A memo is needed when |variance| > 10% **and** |variance| > $500. Both comparisons are strict.
- Money math is deterministic TypeScript in A and C only. The LLM never produces a number that gets booked.
- The accrual books the `trueUp` method's estimate.
- CSV columns, in this exact order: `date,je_id,account,team,debit,credit,memo,evidence`.
- Export label, exact text: `ERP-ready export — this is where Hyphenate would post it.`
- Accrual review polls `/api/estimates` every 3 seconds.
- The demo must run offline after `npm run demo:reset`.
- Every module file for another owner starts with `// OWNER: X`.
- Feature freeze is 10 PM on Oct 24, 2026. Merge small commits to `main` at least every two hours.

## Assumptions to confirm with the team (raise these in hour zero)

1. **`types.ts` content.** The brief's `types.ts` isn't in the repo. Task 0 has a proposed version. If the brief differs, the brief wins: paste it in and rename fields in later tasks to match.
2. **`estimateAll` shape (A):** `estimateAll(month, asOf): Promise<EstimateResult>` where `EstimateResult = { estimates: Estimate[]; biasSuggestionPct: Record<Team, number> }`. It returns all 3 methods for each team.
3. **Contexts storage (A):** A's `estimateAll` reads stored contexts by calling `listContexts(month)` from `src/server/store.ts`. Contexts are upserted by (team, month), so the latest reply wins.
4. **B's loaders:** `loadUsage(month, asOf?)`, `loadActuals(month): Promise<Actual[]>`, and `loadContexts(): Promise<TeamContext[]>` (seed contexts for every month).
5. **D's memo:** `draftMemo(input: MemoInput): Promise<Memo>`. C also catches any throw and falls back to its own placeholder.
6. **D's Slack flow:** `POST /api/contexts` returns `{ context, before, after }`, where `before` and `after` are Support's trueUp `Estimate` (or `null`). D uses those for the "moves your estimate from $X to $Y" confirmation. `POST /api/demo/checkin` calls D's `sendCheckIn(team, month)` from `src/slack/checkin.ts`.
7. **Variance %** = (accrued − actual) / actual, as a fraction, where accrued is the approved accrual, not a freshly computed estimate. Positive means over-accrued. This is the same convention as History's error % and the spec's bias, via `accrualErrorPct` in `src/shared/config.ts`. *(Updated after build; the original draft used actual − accrued over accrued.)*
8. **Entry dates:** the accrual is dated the last day of the month. The reversal and the actual entry are both dated day 1 of the next month, so the next month's net expense equals the variance.
9. **Lead names** other than Priya (Support) are placeholders. D can change them in `config.ts`.

## Time budget (start ≈ 4:20 PM, freeze 10:00 PM)

| By | Done |
|---|---|
| 5:15 | Task 0 merged to `main` (everyone unblocked) |
| 5:45 | Task 1 merged (D can call `GET /api/estimates` and `POST /api/contexts`) |
| 7:00 | Tasks 2–6 merged (close engine green) |
| 7:45 | Tasks 7–8 merged (full API) |
| 9:15 | Tasks 9–12 merged (demo screens) |
| 9:45 | Task 13 (History; hand it to Nikhil if behind) |
| 10:00 | Task 14 dry run on `main` |

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example
src/shared/types.ts        contract (all four owners)
src/shared/config.ts       teams, accounts, thresholds, demo constants, period helpers
src/shared/format.ts       formatUsd / formatCents / formatPct (server + web)
src/shared/api.ts          REST request/response shapes (C-owned, not part of the contract)
src/close/money.ts         toCents / fromCents / sumCents
src/close/journal.ts       applyOverrides, assertBalanced, buildAccrual, buildReversal, buildActual
src/close/variance.ts      needsMemo, computeVariances
src/close/memoTrigger.ts   buildMemoInputs, placeholderMemo, draftMemos
src/close/csv.ts           toCsv
src/close/history.ts       computeHistory
src/server/store.ts        JSON-file store in data/store (TRUEUP_STORE_DIR overrides it)
src/server/http.ts         HttpError, monthParam, dateParam
src/server/deps.ts         Deps interface + defaultDeps wiring A/B/D
src/server/testDeps.ts     fakeDeps for route tests
src/server/app.ts          createApp(deps)
src/server/routes/estimates.ts  usage, estimates, contexts
src/server/routes/close.ts      journal list, prepare, approve, export.csv, actuals
src/server/routes/reports.ts    variances, memos (+edit/attach), history
src/server/routes/demo.ts       demo reset, demo checkin
src/server/demoReset.ts    demoReset() + CLI for npm run demo:reset
src/server/index.ts        listen on PORT (8787)
web/index.html, web/vite.config.ts, web/tsconfig.json
web/src/main.tsx, App.tsx, api.ts, usePoll.ts, styles.css
web/src/screens/AccrualReview.tsx, CheckinPreview.tsx, VarianceMemo.tsx, History.tsx
Stubs for other owners (Task 0): src/estimate/estimate.ts, src/ingest/{loadUsage,loadActuals,loadContexts}.ts,
  src/llm/draftMemo.ts, src/slack/{checkin,app}.ts, src/fixtures/generate.ts
```

Tests sit next to the code as `*.test.ts`. The web screens have no unit tests; they are checked by hand in Task 14.

---

### Task 0: Hour-zero skeleton and contracts (on `main`, others reviewing)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/shared/types.ts`, `src/shared/config.ts`, `src/shared/format.ts`, `src/shared/api.ts`
- Create: stubs `src/estimate/estimate.ts`, `src/ingest/loadUsage.ts`, `src/ingest/loadActuals.ts`, `src/ingest/loadContexts.ts`, `src/llm/draftMemo.ts`, `src/slack/checkin.ts`, `src/slack/app.ts`, `src/fixtures/generate.ts`
- Create: `data/fixtures/fake/{usage,contexts,actuals}.json` (temporary until Junghwan's land)
- Create: `src/server/index.ts` (health only), `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/main.tsx`
- Test: `src/shared/config.test.ts`

**Interfaces:**
- Produces: every type in `types.ts`; `TEAMS`, `TEAM_INFO`, `EXPENSE_ACCOUNT`, `ACCRUED_LIABILITIES`, `ACCOUNTS_PAYABLE`, `ACCOUNT_NAMES`, `MEMO_THRESHOLD`, `DEMO`, `lastDayOfMonth`, `firstDayOfNextMonth`, `nextMonth`, `prevMonth`, `monthsBetween`, `asOfFor`, `monthLabel`; `formatUsd`, `formatCents`, `formatPct`; the stub signatures listed in Assumptions.

- [ ] **Step 1: package.json, tsconfig, vitest, ignore files**

`package.json`:
```json
{
  "name": "trueup",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -k -n api,web -c blue,green \"tsx watch src/server/index.ts\" \"vite --config web/vite.config.ts\"",
    "gen": "tsx src/fixtures/generate.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json && tsc -p web/tsconfig.json",
    "slack": "tsx src/slack/app.ts",
    "demo:reset": "tsx src/server/demoReset.ts"
  }
}
```

Then install the dependencies:
```bash
npm i hono @hono/node-server zod react react-dom
npm i -D typescript tsx vitest vite @vitejs/plugin-react @types/node @types/react @types/react-dom concurrently
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

`.gitignore`:
```
node_modules
dist
data/store
.env
*.tmp
```

`.env.example`:
```
PORT=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
ANTHROPIC_ADMIN_KEY=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_ID_SUPPORT=
SLACK_ID_SEARCH=
SLACK_ID_GROWTH=
SLACK_ID_PLATFORM=
```

- [ ] **Step 2: `src/shared/types.ts` (the contract; replace it with the brief's version if they differ)**

```ts
// src/shared/types.ts — THE shared contract. Any change needs all four owners to agree.

export type Team = 'support' | 'search' | 'growth' | 'platform';
export type Month = string;   // 'YYYY-MM'
export type ISODate = string; // 'YYYY-MM-DD'

export type UsageSource = 'anthropic' | 'openai' | 'fixture';

export interface UsageDay {
  date: ISODate;
  team: Team;
  model: string;
  source: UsageSource;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface DriverEvent {
  kind: 'launch' | 'campaign' | 'price_change' | 'other';
  description: string;
  startDate: ISODate;
  multiplier: number; // applied to daily cost from startDate onward
}

export interface TeamContext {
  id: string;
  team: Team;
  month: Month;
  replied: boolean;
  leadName: string;
  quote: string | null;
  events: DriverEvent[];
  source: 'slack' | 'form' | 'fixture';
  receivedAt: string; // ISO timestamp
}

export type EstimateMethod = 'lastMonth' | 'runRate' | 'trueUp';
export type Confidence = 'high' | 'medium' | 'low';

export interface Estimate {
  team: Team;
  month: Month;
  asOf: ISODate;
  method: EstimateMethod;
  amountUsd: number;
  actualToDateUsd: number;
  basis: string;
  confidence: Confidence;
  sourceIds: string[];
}

export interface EstimateResult {
  estimates: Estimate[];
  biasSuggestionPct: Record<Team, number>; // suggestion only, never applied automatically
}

export interface Actual {
  team: Team;
  month: Month;
  amountUsd: number;
  sourceIds: string[];
}

export type EntryKind = 'accrual' | 'reversal' | 'actual';

export interface JournalLine {
  account: string;
  team: Team | null;
  debitCents: number;
  creditCents: number;
  memo: string;
  evidence: string;
}

export interface JournalEntry {
  id: string;          // JE-<month>-ACCRUAL | JE-<month>-REVERSAL | JE-<month>-ACTUAL
  month: Month;        // the close month this entry belongs to
  date: ISODate;
  kind: EntryKind;
  status: 'draft' | 'approved' | 'posted';
  lines: JournalLine[];
  approvedAt: string | null;
}

export interface Variance {
  team: Team;
  month: Month;
  estimateUsd: number;
  actualUsd: number;
  varianceUsd: number; // actual - estimate
  variancePct: number; // variance / estimate
  needsMemo: boolean;
}

export interface MemoInput {
  team: Team;
  month: Month;
  leadName: string;
  estimateUsd: number;
  actualUsd: number;
  varianceUsd: number;
  variancePct: number;
  basis: string;
  quote: string | null;
  events: DriverEvent[];
  sourceIds: string[];
}

export interface Memo {
  id: string; // MEMO-<month>-<team>
  team: Team;
  month: Month;
  text: string;
  sources: string[];
  generatedBy: 'llm' | 'placeholder';
  status: 'draft' | 'attached';
  editedAt: string | null;
}
```

- [ ] **Step 3: Write the failing config test**

`src/shared/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  DEMO, EXPENSE_ACCOUNT, asOfFor, firstDayOfNextMonth, lastDayOfMonth,
  monthLabel, monthsBetween, nextMonth, prevMonth,
} from './config';

describe('period helpers', () => {
  it('finds the last day of a month', () => {
    expect(lastDayOfMonth('2026-10')).toBe('2026-10-31');
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30');
  });
  it('rolls months over year boundaries', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(firstDayOfNextMonth('2026-10')).toBe('2026-11-01');
    expect(firstDayOfNextMonth('2026-12')).toBe('2027-01-01');
  });
  it('lists months inclusively', () => {
    expect(monthsBetween('2026-02', '2026-05')).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
  });
  it('uses the 25th as the as-of day, matching the demo', () => {
    expect(asOfFor('2026-10')).toBe(DEMO.asOf);
    expect(asOfFor('2026-03')).toBe('2026-03-25');
  });
  it('labels months', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
  });
  it('maps teams to accounts', () => {
    expect(EXPENSE_ACCOUNT).toEqual({ support: '5010', search: '6130', growth: '6130', platform: '6130' });
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run src/shared/config.test.ts`
Expected: FAIL, because `./config` can't be resolved.

- [ ] **Step 5: Write `src/shared/config.ts`**

```ts
import type { ISODate, Month, Team } from './types';

export const TEAMS: readonly Team[] = ['support', 'search', 'growth', 'platform'];

// Lead names other than Priya are placeholders; Nikhil may rename them.
// Slack ids come from the named env var (read only in src/slack — this file is also bundled into the web app).
export const TEAM_INFO: Record<Team, { label: string; leadName: string; slackIdEnv: string }> = {
  support:  { label: 'Support',  leadName: 'Priya', slackIdEnv: 'SLACK_ID_SUPPORT' },
  search:   { label: 'Search',   leadName: 'Marco', slackIdEnv: 'SLACK_ID_SEARCH' },
  growth:   { label: 'Growth',   leadName: 'Jess',  slackIdEnv: 'SLACK_ID_GROWTH' },
  platform: { label: 'Platform', leadName: 'Sam',   slackIdEnv: 'SLACK_ID_PLATFORM' },
};

export const EXPENSE_ACCOUNT: Record<Team, string> = {
  support: '5010',
  search: '6130',
  growth: '6130',
  platform: '6130',
};
export const ACCRUED_LIABILITIES = '2100';
export const ACCOUNTS_PAYABLE = '2000';
export const ACCOUNT_NAMES: Record<string, string> = {
  '5010': 'COGS – AI inference',
  '6130': 'R&D – AI usage',
  '2100': 'Accrued liabilities',
  '2000': 'Accounts payable',
};

// A memo is required when BOTH are strictly exceeded.
export const MEMO_THRESHOLD = { pct: 0.1, usd: 500 } as const;

export const DEMO = {
  company: 'Northwind Labs',
  month: '2026-10',
  asOf: '2026-10-25',
  asOfDay: 25,
  liveTeam: 'support' as Team, // its October context is cleared by demo reset; Priya replies live
  firstMonth: '2026-02',
} as const;

const pad = (n: number) => String(n).padStart(2, '0');
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseMonth(m: Month): { y: number; mo: number } {
  const [y, mo] = m.split('-').map(Number);
  return { y, mo };
}

export function daysInMonth(m: Month): number {
  const { y, mo } = parseMonth(m);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export const lastDayOfMonth = (m: Month): ISODate => `${m}-${pad(daysInMonth(m))}`;

export function nextMonth(m: Month): Month {
  const { y, mo } = parseMonth(m);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
}

export function prevMonth(m: Month): Month {
  const { y, mo } = parseMonth(m);
  return mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`;
}

export const firstDayOfNextMonth = (m: Month): ISODate => `${nextMonth(m)}-01`;

export function monthsBetween(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

export const asOfFor = (m: Month): ISODate => `${m}-${pad(DEMO.asOfDay)}`;

export function monthLabel(m: Month): string {
  const { y, mo } = parseMonth(m);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npx vitest run src/shared/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: `src/shared/format.ts` and `src/shared/api.ts`**

`src/shared/format.ts`:
```ts
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export const formatUsd = (usd: number, cents = false): string => (cents ? usd2 : usd0).format(usd);
export const formatCents = (c: number): string => usd2.format(c / 100);
export const formatPct = (p: number): string => `${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%`;
```

`src/shared/api.ts`:
```ts
// REST shapes owned by C. Not part of the types.ts contract, but D's Slack flow reads PostContextResult.
import type { DriverEvent, Estimate, EstimateMethod, JournalEntry, Memo, Month, Team, TeamContext, Variance } from './types';

export interface ContextInput {
  team: Team;
  month: Month;
  replied: boolean;
  leadName?: string;
  quote?: string | null;
  events?: DriverEvent[];
  source?: TeamContext['source'];
}
export interface PostContextResult { context: TeamContext; before: Estimate | null; after: Estimate | null }

export type Overrides = Partial<Record<Team, number>>;
export interface PrepareResult { entry: JournalEntry; estimates: Estimate[] }
export interface ActualsResult { reversal: JournalEntry; actual: JournalEntry; variances: Variance[]; memos: Memo[] }

export interface HistoryRow { month: Month; team: Team; method: EstimateMethod; estimateUsd: number; actualUsd: number }
export interface MethodError { method: EstimateMethod; maeUsd: number; maePct: number; n: number }
export interface HistoryReport { months: Month[]; byMethod: MethodError[]; biasByTeam: Record<Team, number> }
```

- [ ] **Step 8: Temporary fakes (skip any file Junghwan has already pushed)**

`data/fixtures/fake/actuals.json`:
```json
[
  { "team": "support",  "month": "2026-10", "amountUsd": 10210, "sourceIds": ["inv:anthropic:2026-10"] },
  { "team": "search",   "month": "2026-10", "amountUsd": 3150,  "sourceIds": ["inv:anthropic:2026-10"] },
  { "team": "growth",   "month": "2026-10", "amountUsd": 5600,  "sourceIds": ["inv:anthropic:2026-10", "inv:openai:2026-10"] },
  { "team": "platform", "month": "2026-10", "amountUsd": 2450,  "sourceIds": ["inv:anthropic:2026-10"] }
]
```

`data/fixtures/fake/contexts.json`:
```json
[
  { "id": "ctx-growth-2026-10", "team": "growth", "month": "2026-10", "replied": true, "leadName": "Jess",
    "quote": "Big campaign goes out mid-October, plan for double spend.",
    "events": [{ "kind": "campaign", "description": "October campaign", "startDate": "2026-10-15", "multiplier": 2 }],
    "source": "fixture", "receivedAt": "2026-10-24T17:00:00Z" },
  { "id": "ctx-search-2026-10", "team": "search", "month": "2026-10", "replied": true, "leadName": "Marco",
    "quote": "Steady, nothing new.", "events": [], "source": "fixture", "receivedAt": "2026-10-24T17:05:00Z" },
  { "id": "ctx-platform-2026-10", "team": "platform", "month": "2026-10", "replied": false, "leadName": "Sam",
    "quote": null, "events": [], "source": "fixture", "receivedAt": "2026-10-24T17:10:00Z" }
]
```

`data/fixtures/fake/usage.json`:
```json
[
  { "date": "2026-10-24", "team": "support",  "model": "claude-sonnet", "source": "fixture", "inputTokens": 4000000, "outputTokens": 900000, "costUsd": 245 },
  { "date": "2026-10-24", "team": "search",   "model": "claude-haiku",  "source": "fixture", "inputTokens": 9000000, "outputTokens": 500000, "costUsd": 104 },
  { "date": "2026-10-24", "team": "growth",   "model": "gpt-4.1",       "source": "openai",  "inputTokens": 3000000, "outputTokens": 700000, "costUsd": 290 },
  { "date": "2026-10-24", "team": "platform", "model": "claude-sonnet", "source": "fixture", "inputTokens": 1500000, "outputTokens": 300000, "costUsd": 79 }
]
```

- [ ] **Step 9: Stubs for the other owners**

`src/shared/readFixture.ts`:
```ts
import { readFile } from 'node:fs/promises';

export async function readFixture<T>(relPath: string): Promise<T> {
  return JSON.parse(await readFile(new URL(`../../data/fixtures/${relPath}`, import.meta.url), 'utf8')) as T;
}
```

`src/estimate/estimate.ts`:
```ts
// OWNER: A (Antoine) — stub returning fake numbers of the right shape.
import type { Estimate, EstimateMethod, EstimateResult, ISODate, Month, Team } from '../shared/types';
import { TEAMS } from '../shared/config';

const FAKE: Record<Team, Record<EstimateMethod, number>> = {
  support:  { lastMonth: 7000, runRate: 7590, trueUp: 7590 },
  search:   { lastMonth: 3100, runRate: 3200, trueUp: 3200 },
  growth:   { lastMonth: 4800, runRate: 6100, trueUp: 9000 },
  platform: { lastMonth: 2300, runRate: 2400, trueUp: 2400 },
};

export async function estimateAll(month: Month, asOf: ISODate): Promise<EstimateResult> {
  const estimates: Estimate[] = TEAMS.flatMap((team) =>
    (['lastMonth', 'runRate', 'trueUp'] as const).map((method) => ({
      team, month, asOf, method,
      amountUsd: FAKE[team][method],
      actualToDateUsd: Math.round(FAKE[team].runRate * 0.8),
      basis: `STUB ${method} for ${team}`,
      confidence: team === 'support' ? 'low' : 'high',
      sourceIds: [`usage:${team}:${month}`],
    })),
  );
  return { estimates, biasSuggestionPct: { support: 0, search: 0, growth: 0, platform: 0 } };
}
```

`src/ingest/loadUsage.ts`:
```ts
// OWNER: B (Junghwan) — stub reading the hand-written fakes.
import type { ISODate, Month, UsageDay } from '../shared/types';
import { readFixture } from '../shared/readFixture';

export async function loadUsage(month: Month, asOf?: ISODate): Promise<UsageDay[]> {
  const all = await readFixture<UsageDay[]>('fake/usage.json');
  return all.filter((d) => d.date.startsWith(month) && (!asOf || d.date <= asOf));
}
```

`src/ingest/loadActuals.ts`:
```ts
// OWNER: B (Junghwan) — stub reading the hand-written fakes.
import type { Actual, Month } from '../shared/types';
import { readFixture } from '../shared/readFixture';

export async function loadActuals(month: Month): Promise<Actual[]> {
  return (await readFixture<Actual[]>('fake/actuals.json')).filter((a) => a.month === month);
}
```

`src/ingest/loadContexts.ts`:
```ts
// OWNER: B (Junghwan) — seed contexts for every month (what leads said). Stub reads the fakes.
import type { TeamContext } from '../shared/types';
import { readFixture } from '../shared/readFixture';

export async function loadContexts(): Promise<TeamContext[]> {
  return readFixture<TeamContext[]>('fake/contexts.json');
}
```

`src/llm/draftMemo.ts`:
```ts
// OWNER: D (Nikhil) — stub; the real one calls the LLM and validates numbers.
import type { Memo, MemoInput } from '../shared/types';

export async function draftMemo(input: MemoInput): Promise<Memo> {
  return {
    id: `MEMO-${input.month}-${input.team}`,
    team: input.team,
    month: input.month,
    text: `STUB memo for ${input.team}.`,
    sources: input.sourceIds,
    generatedBy: 'placeholder',
    status: 'draft',
    editedAt: null,
  };
}
```

`src/slack/checkin.ts`:
```ts
// OWNER: D (Nikhil)
import type { Month, Team } from '../shared/types';

export async function sendCheckIn(team: Team, month: Month): Promise<void> {
  throw new Error(`Slack not configured yet (sendCheckIn ${team} ${month})`);
}
```

`src/slack/app.ts`:
```ts
// OWNER: D (Nikhil)
console.log('Slack app not implemented yet.');
```

`src/fixtures/generate.ts`:
```ts
// OWNER: B (Junghwan)
console.log('Fixture generator not implemented yet.');
```

- [ ] **Step 10: Minimal server and web, so `npm run dev` runs**

`src/server/index.ts`:
```ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

try { process.loadEnvFile(); } catch { /* no .env — fine offline */ }

const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true }));

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => console.log(`TrueUp API on http://localhost:${info.port}`));
```

`web/vite.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
    fs: { allow: ['..'] },
  },
});
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src", "../src/shared/types.ts", "../src/shared/api.ts", "../src/shared/config.ts", "../src/shared/format.ts"]
}
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TrueUp</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<h1>TrueUp</h1>);
```

- [ ] **Step 11: Check that everything is green**

Run: `npm test`. Expected: 6 passed.
Run: `npm run typecheck`. Expected: no output, exit 0.
Run: `npm run dev`, then open http://localhost:5173 (it shows "TrueUp") and http://localhost:5173/api/health (it returns `{"ok":true}`). Stop it with Ctrl+C.

- [ ] **Step 12: Commit after the team reviews it, then push to main**

```bash
git add -A
git commit -m "chore: hour-zero skeleton, shared contract, stubs for all lanes"
git push origin main
git checkout -b c/close-server-web
```

---

### Task 1: Store, app factory, and usage/estimates/contexts routes (unblocks Nikhil)

**Files:**
- Create: `src/server/store.ts`, `src/server/http.ts`, `src/server/deps.ts`, `src/server/testDeps.ts`, `src/server/app.ts`, `src/server/routes/estimates.ts`
- Modify: `src/server/index.ts` (replace the whole file)
- Test: `src/server/store.test.ts`, `src/server/app.test.ts`

**Interfaces:**
- Consumes: `estimateAll`, `loadUsage`, `loadActuals`, `loadContexts`, `draftMemo`, `sendCheckIn` (Task 0 stubs)
- Produces:
  - store: `listContexts(month?)`, `upsertContext(ctx)`, `listEntries(month?)`, `getEntry(id)`, `saveEntries(...entries)`, `listVariances(month)`, `replaceVariances(month, vs)`, `listMemos(month?)`, `getMemo(id)`, `saveMemo(m)`, `replaceMemos(month, ms)`, `resetStore(seed)`
  - `interface Deps`, `defaultDeps`, `fakeDeps(overrides?)`, `createApp(deps): Hono`
  - `HttpError(status, message)`, `monthParam(v)`, `dateParam(v)`
  - Routes: `GET /api/usage`, `GET /api/estimates`, `GET /api/contexts`, `POST /api/contexts → PostContextResult`

- [ ] **Step 1: Write the failing store test**

`src/server/store.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamContext } from '../shared/types';
import { listContexts, listEntries, resetStore, upsertContext } from './store';

const ctx = (team: TeamContext['team'], quote: string, month = '2026-10'): TeamContext => ({
  id: `ctx-${team}-${quote}`, team, month, replied: true, leadName: 'X', quote, events: [],
  source: 'form', receivedAt: '2026-10-25T00:00:00Z',
});

beforeEach(async () => {
  process.env.TRUEUP_STORE_DIR = await mkdtemp(join(tmpdir(), 'trueup-'));
});

describe('store', () => {
  it('returns empty lists before anything is written', async () => {
    expect(await listContexts()).toEqual([]);
    expect(await listEntries()).toEqual([]);
  });
  it('upserts contexts by team and month (latest wins)', async () => {
    await upsertContext(ctx('support', 'first'));
    await upsertContext(ctx('support', 'second'));
    await upsertContext(ctx('support', 'september', '2026-09'));
    const oct = await listContexts('2026-10');
    expect(oct).toHaveLength(1);
    expect(oct[0].quote).toBe('second');
    expect(await listContexts()).toHaveLength(2);
  });
  it('serialises concurrent writes', async () => {
    await Promise.all(['support', 'search', 'growth', 'platform'].map((t) => upsertContext(ctx(t as TeamContext['team'], t))));
    expect(await listContexts('2026-10')).toHaveLength(4);
  });
  it('reset wipes everything and seeds contexts', async () => {
    await upsertContext(ctx('support', 'old'));
    await resetStore([ctx('growth', 'seed')]);
    expect((await listContexts()).map((c) => c.quote)).toEqual(['seed']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/server/store.test.ts`
Expected: FAIL, because `./store` can't be resolved.

- [ ] **Step 3: Write `src/server/store.ts`**

```ts
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JournalEntry, Memo, Month, TeamContext, Variance } from '../shared/types';

type Collection = 'contexts' | 'journal' | 'variances' | 'memos';

export const storeDir = (): string => process.env.TRUEUP_STORE_DIR ?? path.resolve('data/store');
const file = (name: Collection) => path.join(storeDir(), `${name}.json`);

// One writer at a time so read-modify-write cycles never interleave.
let lock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function read<T>(name: Collection): Promise<T[]> {
  try {
    return JSON.parse(await readFile(file(name), 'utf8')) as T[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function write<T>(name: Collection, items: T[]): Promise<void> {
  await mkdir(storeDir(), { recursive: true });
  const tmp = `${file(name)}.tmp`;
  await writeFile(tmp, JSON.stringify(items, null, 2));
  await rename(tmp, file(name));
}

const update = <T>(name: Collection, fn: (items: T[]) => T[]) =>
  withLock(async () => write(name, fn(await read<T>(name))));

// Contexts — one per (team, month); the latest reply wins.
export const listContexts = async (month?: Month) =>
  (await read<TeamContext>('contexts')).filter((c) => !month || c.month === month);
export const upsertContext = (ctx: TeamContext) =>
  update<TeamContext>('contexts', (xs) => [...xs.filter((x) => !(x.team === ctx.team && x.month === ctx.month)), ctx]);

// Journal entries — upsert by id.
export const listEntries = async (month?: Month) =>
  (await read<JournalEntry>('journal')).filter((e) => !month || e.month === month);
export const getEntry = async (id: string) =>
  (await read<JournalEntry>('journal')).find((e) => e.id === id) ?? null;
export const saveEntries = (...entries: JournalEntry[]) =>
  update<JournalEntry>('journal', (xs) => [...xs.filter((x) => !entries.some((e) => e.id === x.id)), ...entries]);

// Variances — replaced wholesale per month.
export const listVariances = async (month: Month) =>
  (await read<Variance>('variances')).filter((v) => v.month === month);
export const replaceVariances = (month: Month, vs: Variance[]) =>
  update<Variance>('variances', (xs) => [...xs.filter((x) => x.month !== month), ...vs]);

// Memos — replaced per month on actuals load, edited one at a time.
export const listMemos = async (month?: Month) =>
  (await read<Memo>('memos')).filter((m) => !month || m.month === month);
export const getMemo = async (id: string) => (await read<Memo>('memos')).find((m) => m.id === id) ?? null;
export const saveMemo = (memo: Memo) =>
  update<Memo>('memos', (xs) => [...xs.filter((x) => x.id !== memo.id), memo]);
export const replaceMemos = (month: Month, ms: Memo[]) =>
  update<Memo>('memos', (xs) => [...xs.filter((x) => x.month !== month), ...ms]);

export const resetStore = (seedContexts: TeamContext[]) =>
  withLock(async () => {
    await rm(storeDir(), { recursive: true, force: true });
    await write('contexts', seedContexts);
  });
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/server/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: `http.ts`, `deps.ts`, `testDeps.ts`**

`src/server/http.ts`:
```ts
import type { ISODate, Month } from '../shared/types';
import { DEMO } from '../shared/config';

export class HttpError extends Error {
  constructor(public status: 400 | 404 | 409 | 502, message: string) {
    super(message);
  }
}

export function monthParam(v: string | undefined): Month {
  const m = v ?? DEMO.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, `Bad month "${m}", expected YYYY-MM`);
  return m;
}

export function dateParam(v: string | undefined): ISODate | undefined {
  if (v === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `Bad date "${v}", expected YYYY-MM-DD`);
  return v;
}
```

`src/server/deps.ts`:
```ts
import type { Actual, EstimateResult, ISODate, Memo, MemoInput, Month, Team, TeamContext, UsageDay } from '../shared/types';
import { estimateAll } from '../estimate/estimate';
import { loadActuals } from '../ingest/loadActuals';
import { loadContexts } from '../ingest/loadContexts';
import { loadUsage } from '../ingest/loadUsage';
import { draftMemo } from '../llm/draftMemo';

export interface Deps {
  estimateAll(month: Month, asOf: ISODate): Promise<EstimateResult>;
  loadUsage(month: Month, asOf?: ISODate): Promise<UsageDay[]>;
  loadActuals(month: Month): Promise<Actual[]>;
  loadContexts(): Promise<TeamContext[]>;
  draftMemo(input: MemoInput): Promise<Memo>;
  sendCheckIn(team: Team, month: Month): Promise<void>;
}

export const defaultDeps: Deps = {
  estimateAll,
  loadUsage,
  loadActuals,
  loadContexts,
  draftMemo,
  // Lazy so Bolt only loads if a check-in is actually sent.
  sendCheckIn: async (team, month) => (await import('../slack/checkin')).sendCheckIn(team, month),
};
```

`src/server/testDeps.ts`:
```ts
import type { Estimate, Team } from '../shared/types';
import { TEAMS } from '../shared/config';
import type { Deps } from './deps';
import { listContexts } from './store';

// Support jumps 7590 -> 10040 once a support context with events exists (the demo moment).
export function fakeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    async estimateAll(month, asOf) {
      const ctxs = await listContexts(month);
      const boosted = ctxs.some((c) => c.team === 'support' && c.events.length > 0);
      const amounts: Record<Team, number> = { support: boosted ? 10040 : 7590, search: 3200, growth: 9000, platform: 2400 };
      const estimates: Estimate[] = TEAMS.flatMap((team) =>
        (['lastMonth', 'runRate', 'trueUp'] as const).map((method) => ({
          team, month, asOf, method,
          amountUsd: method === 'trueUp' ? amounts[team] : amounts[team] * 0.9,
          actualToDateUsd: amounts[team] * 0.8,
          basis: `${team} ${method} basis`,
          confidence: team === 'support' && !boosted ? 'low' : 'high',
          sourceIds: [`usage:${team}:${month}`],
        })),
      );
      return { estimates, biasSuggestionPct: { support: 0.05, search: -0.02, growth: 0.3, platform: 0 } };
    },
    async loadUsage() {
      return [];
    },
    async loadActuals(month) {
      return [
        { team: 'support', month, amountUsd: 10210, sourceIds: [`inv:${month}`] },
        { team: 'search', month, amountUsd: 3150, sourceIds: [`inv:${month}`] },
        { team: 'growth', month, amountUsd: 5600, sourceIds: [`inv:${month}`] },
        { team: 'platform', month, amountUsd: 2450, sourceIds: [`inv:${month}`] },
      ];
    },
    async loadContexts() {
      return [
        { id: 'ctx-growth', team: 'growth', month: '2026-10', replied: true, leadName: 'Jess',
          quote: 'Big campaign mid-October', events: [{ kind: 'campaign', description: 'campaign', startDate: '2026-10-15', multiplier: 2 }],
          source: 'fixture', receivedAt: '2026-10-24T00:00:00Z' },
        { id: 'ctx-support', team: 'support', month: '2026-10', replied: true, leadName: 'Priya',
          quote: 'should be cleared by reset', events: [], source: 'fixture', receivedAt: '2026-10-24T00:00:00Z' },
      ];
    },
    async draftMemo(input) {
      return {
        id: `MEMO-${input.month}-${input.team}`, team: input.team, month: input.month,
        text: `LLM memo for ${input.team}`, sources: input.sourceIds,
        generatedBy: 'llm', status: 'draft', editedAt: null,
      };
    },
    async sendCheckIn() {},
    ...overrides,
  };
}
```

- [ ] **Step 6: Write the failing route test**

`src/server/app.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PostContextResult } from '../shared/api';
import type { EstimateResult } from '../shared/types';
import { createApp } from './app';
import type { Deps } from './deps';
import { fakeDeps } from './testDeps';

let app: ReturnType<typeof createApp>;
const setup = (overrides: Partial<Deps> = {}) => { app = createApp(fakeDeps(overrides)); };
const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const put = (path: string, body: unknown) =>
  app.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  process.env.TRUEUP_STORE_DIR = await mkdtemp(join(tmpdir(), 'trueup-'));
  setup();
});

describe('estimates and contexts', () => {
  it('GET /api/estimates defaults to the demo month and as-of', async () => {
    const res = await app.request('/api/estimates');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EstimateResult;
    expect(body.estimates).toHaveLength(12);
    expect(body.estimates[0].asOf).toBe('2026-10-25');
  });

  it('rejects a bad month', async () => {
    const res = await app.request('/api/estimates?month=2026-13');
    expect(res.status).toBe(400);
  });

  it('POST /api/contexts stores the reply and returns before/after estimates', async () => {
    const res = await post('/api/contexts', {
      team: 'support', month: '2026-10', replied: true, quote: 'launching Oct 27, expect about 3x', source: 'slack',
      events: [{ kind: 'launch', description: 'Support launch', startDate: '2026-10-27', multiplier: 3 }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PostContextResult;
    expect(body.before?.amountUsd).toBe(7590);
    expect(body.after?.amountUsd).toBe(10040);
    expect(body.context.leadName).toBe('Priya');

    const list = await (await app.request('/api/contexts?month=2026-10')).json();
    expect(list).toHaveLength(1);
  });

  it('POST /api/contexts validates the body', async () => {
    const res = await post('/api/contexts', { team: 'marketing', month: '2026-10' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/team/);
  });
});
```

(`put` is used by tests added in Task 8.)

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run src/server/app.test.ts`
Expected: FAIL, because `./app` can't be resolved.

- [ ] **Step 8: Write `routes/estimates.ts`, `app.ts`, and the new `index.ts`**

`src/server/routes/estimates.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { PostContextResult } from '../../shared/api';
import { asOfFor, TEAM_INFO } from '../../shared/config';
import type { TeamContext } from '../../shared/types';
import type { Deps } from '../deps';
import { dateParam, HttpError, monthParam } from '../http';
import { listContexts, upsertContext } from '../store';

const DriverEventSchema = z.object({
  kind: z.enum(['launch', 'campaign', 'price_change', 'other']),
  description: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  multiplier: z.number().positive(),
});

const ContextBody = z.object({
  team: z.enum(['support', 'search', 'growth', 'platform']),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  replied: z.boolean(),
  leadName: z.string().optional(),
  quote: z.string().nullable().default(null),
  events: z.array(DriverEventSchema).default([]),
  source: z.enum(['slack', 'form', 'fixture']).default('form'),
});

export function estimateRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/usage', async (c) => {
    const month = monthParam(c.req.query('month'));
    return c.json(await deps.loadUsage(month, dateParam(c.req.query('asOf')) ?? asOfFor(month)));
  });

  r.get('/estimates', async (c) => {
    const month = monthParam(c.req.query('month'));
    return c.json(await deps.estimateAll(month, dateParam(c.req.query('asOf')) ?? asOfFor(month)));
  });

  r.get('/contexts', async (c) => c.json(await listContexts(monthParam(c.req.query('month')))));

  r.post('/contexts', async (c) => {
    const parsed = ContextBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const b = parsed.data;
    const trueUpFor = async () =>
      (await deps.estimateAll(b.month, asOfFor(b.month))).estimates.find(
        (e) => e.team === b.team && e.method === 'trueUp',
      ) ?? null;

    const before = await trueUpFor();
    const context: TeamContext = {
      id: `ctx-${b.team}-${b.month}-${Date.now()}`,
      team: b.team,
      month: b.month,
      replied: b.replied,
      leadName: b.leadName ?? TEAM_INFO[b.team].leadName,
      quote: b.quote,
      events: b.events,
      source: b.source,
      receivedAt: new Date().toISOString(),
    };
    await upsertContext(context);
    const after = await trueUpFor();
    const result: PostContextResult = { context, before, after };
    return c.json(result, 201);
  });

  return r;
}
```

`src/server/app.ts`:
```ts
import { Hono } from 'hono';
import type { Deps } from './deps';
import { HttpError } from './http';
import { estimateRoutes } from './routes/estimates';

export function createApp(deps: Deps) {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api', estimateRoutes(deps));
  return app;
}
```

`src/server/index.ts` (the whole file):
```ts
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { defaultDeps } from './deps';

try { process.loadEnvFile(); } catch { /* no .env — fine offline */ }

const port = Number(process.env.PORT || 8787);
serve({ fetch: createApp(defaultDeps).fetch, port }, (info) =>
  console.log(`TrueUp API on http://localhost:${info.port}`),
);
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `npm test`
Expected: all pass (config 6, store 4, app 4).

- [ ] **Step 10: Commit, merge, and tell Nikhil**

```bash
git add -A
git commit -m "feat(server): JSON store, app factory, usage/estimates/contexts routes"
git checkout main && git pull && git merge --no-ff c/close-server-web && npm test && git push origin main && git checkout c/close-server-web
```
Post in chat: "`GET /api/estimates` and `POST /api/contexts` are live on main. POST returns `{context, before, after}`. A: read contexts via `listContexts(month)` from `src/server/store.ts`."

---

### Task 2: Journal entries (accrual, reversal, actual, overrides)

**Files:**
- Create: `src/close/money.ts`, `src/close/journal.ts`
- Test: `src/close/journal.test.ts`

**Interfaces:**
- Consumes: `Estimate`, `Actual`, `JournalEntry`, `JournalLine`, `Month`, `Team` (types); `EXPENSE_ACCOUNT`, `ACCRUED_LIABILITIES`, `ACCOUNTS_PAYABLE`, `lastDayOfMonth`, `firstDayOfNextMonth`, `monthLabel`, `TEAM_INFO` (config); `Overrides` (api.ts); `formatUsd` (format.ts)
- Produces:
  - `toCents(usd: number): number`, `fromCents(c: number): number`, `sumCents(xs: number[]): number`
  - `applyOverrides(estimates: Estimate[], overrides: Overrides): Estimate[]`
  - `assertBalanced(entry: JournalEntry): JournalEntry` (throws `Unbalanced entry ...`)
  - `buildAccrual(month: Month, estimates: Estimate[]): JournalEntry`, which has id `JE-<month>-ACCRUAL`, is dated the last day of the month, and has status `draft`
  - `buildReversal(accrual: JournalEntry): JournalEntry`, which has id `JE-<month>-REVERSAL`, is dated day 1 of the next month, and has status `posted`
  - `buildActual(month: Month, actuals: Actual[]): JournalEntry`, which has id `JE-<month>-ACTUAL`, is dated day 1 of the next month, and has status `posted`

- [ ] **Step 1: Write the failing test**

`src/close/journal.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Actual, Estimate, EstimateMethod, JournalEntry, Team } from '../shared/types';
import { applyOverrides, assertBalanced, buildAccrual, buildActual, buildReversal } from './journal';
import { sumCents, toCents } from './money';

const est = (team: Team, amountUsd: number, method: EstimateMethod = 'trueUp'): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method, amountUsd, actualToDateUsd: amountUsd * 0.8,
  basis: `${team} basis`, confidence: 'high', sourceIds: [`usage:${team}:2026-10`],
});
const estimates = [
  est('support', 10040), est('search', 3200.1), est('growth', 9000.555), est('platform', 2400),
  est('support', 7590, 'runRate'), est('support', 7000, 'lastMonth'),
];
const debits = (e: JournalEntry) => sumCents(e.lines.map((l) => l.debitCents));
const credits = (e: JournalEntry) => sumCents(e.lines.map((l) => l.creditCents));

describe('buildAccrual', () => {
  const accrual = buildAccrual('2026-10', estimates);

  it('books only trueUp estimates, one debit per team plus one 2100 credit', () => {
    expect(accrual.lines).toHaveLength(5);
    const support = accrual.lines.find((l) => l.team === 'support')!;
    expect(support).toMatchObject({ account: '5010', debitCents: 1004000, creditCents: 0 });
    expect(accrual.lines.filter((l) => l.account === '6130')).toHaveLength(3);
    const credit = accrual.lines.find((l) => l.account === '2100')!;
    expect(credit.team).toBeNull();
    expect(credit.creditCents).toBe(1004000 + 320010 + toCents(9000.555) + 240000);
  });

  it('balances and carries id, date, status', () => {
    expect(debits(accrual)).toBe(credits(accrual));
    expect(accrual).toMatchObject({ id: 'JE-2026-10-ACCRUAL', date: '2026-10-31', kind: 'accrual', status: 'draft', approvedAt: null });
  });

  it('puts basis and source ids in the evidence', () => {
    const support = accrual.lines.find((l) => l.team === 'support')!;
    expect(support.evidence).toContain('support basis');
    expect(support.evidence).toContain('usage:support:2026-10');
  });

  it('throws when there are no trueUp estimates for the month', () => {
    expect(() => buildAccrual('2026-10', [est('support', 1, 'runRate')])).toThrow(/No trueUp estimates/);
  });
});

describe('assertBalanced', () => {
  it('throws on an unbalanced entry', () => {
    const bad = buildAccrual('2026-10', estimates);
    bad.lines[0] = { ...bad.lines[0], debitCents: bad.lines[0].debitCents + 1 };
    expect(() => assertBalanced(bad)).toThrow(/Unbalanced entry JE-2026-10-ACCRUAL/);
  });
  it('throws on non-integer or negative cents', () => {
    const bad = buildAccrual('2026-10', estimates);
    bad.lines[0] = { ...bad.lines[0], debitCents: 10.5 };
    expect(() => assertBalanced(bad)).toThrow(/integer/);
  });
});

describe('buildReversal', () => {
  const accrual = buildAccrual('2026-10', estimates);
  const reversal = buildReversal(accrual);

  it('mirrors every accrual line', () => {
    expect(reversal.lines).toHaveLength(accrual.lines.length);
    reversal.lines.forEach((l, i) => {
      expect(l.account).toBe(accrual.lines[i].account);
      expect(l.team).toBe(accrual.lines[i].team);
      expect(l.debitCents).toBe(accrual.lines[i].creditCents);
      expect(l.creditCents).toBe(accrual.lines[i].debitCents);
    });
    expect(debits(reversal)).toBe(credits(reversal));
  });

  it('is dated day 1 of next month and posted', () => {
    expect(reversal).toMatchObject({ id: 'JE-2026-10-REVERSAL', date: '2026-11-01', kind: 'reversal', status: 'posted' });
  });

  it('refuses to reverse something that is not an accrual', () => {
    expect(() => buildReversal(reversal)).toThrow(/only reverse an accrual/);
  });
});

describe('buildActual', () => {
  const actuals: Actual[] = [
    { team: 'support', month: '2026-10', amountUsd: 10210, sourceIds: ['inv:1'] },
    { team: 'growth', month: '2026-10', amountUsd: 5600.25, sourceIds: ['inv:2'] },
  ];
  const actual = buildActual('2026-10', actuals);

  it('debits expense by team and credits 2000 for the total', () => {
    expect(actual.lines.find((l) => l.team === 'support')).toMatchObject({ account: '5010', debitCents: 1021000 });
    expect(actual.lines.find((l) => l.team === 'growth')).toMatchObject({ account: '6130', debitCents: 560025 });
    expect(actual.lines.find((l) => l.account === '2000')!.creditCents).toBe(1581025);
    expect(debits(actual)).toBe(credits(actual));
    expect(actual).toMatchObject({ id: 'JE-2026-10-ACTUAL', date: '2026-11-01', kind: 'actual', status: 'posted' });
  });
});

describe('applyOverrides', () => {
  it('replaces only the trueUp amount for overridden teams and records why', () => {
    const out = applyOverrides(estimates, { support: 9500 });
    const support = out.find((e) => e.team === 'support' && e.method === 'trueUp')!;
    expect(support.amountUsd).toBe(9500);
    expect(support.basis).toMatch(/Manual override to \$9,500 \(model: \$10,040/);
    expect(support.sourceIds).toContain('override:controller');
    expect(out.find((e) => e.team === 'support' && e.method === 'runRate')!.amountUsd).toBe(7590);
    expect(out.find((e) => e.team === 'search')!.amountUsd).toBe(3200.1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/close/journal.test.ts`
Expected: FAIL, because `./journal` can't be resolved.

- [ ] **Step 3: Write `money.ts` and `journal.ts`**

`src/close/money.ts`:
```ts
export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (c: number): number => c / 100;
export const sumCents = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
```

`src/close/journal.ts`:
```ts
import type { Overrides } from '../shared/api';
import {
  ACCOUNTS_PAYABLE, ACCRUED_LIABILITIES, EXPENSE_ACCOUNT, TEAM_INFO,
  firstDayOfNextMonth, lastDayOfMonth, monthLabel,
} from '../shared/config';
import { formatUsd } from '../shared/format';
import type { Actual, Estimate, JournalEntry, JournalLine, Month } from '../shared/types';
import { sumCents, toCents } from './money';

export function applyOverrides(estimates: Estimate[], overrides: Overrides): Estimate[] {
  return estimates.map((e) => {
    const amount = overrides[e.team];
    if (e.method !== 'trueUp' || amount === undefined) return e;
    return {
      ...e,
      amountUsd: amount,
      basis: `Manual override to ${formatUsd(amount)} (model: ${formatUsd(e.amountUsd)}; ${e.basis})`,
      sourceIds: [...e.sourceIds, 'override:controller'],
    };
  });
}

export function assertBalanced(entry: JournalEntry): JournalEntry {
  for (const l of entry.lines) {
    for (const v of [l.debitCents, l.creditCents]) {
      if (!Number.isInteger(v) || v < 0) throw new Error(`Entry ${entry.id}: amounts must be non-negative integer cents, got ${v}`);
    }
  }
  const dr = sumCents(entry.lines.map((l) => l.debitCents));
  const cr = sumCents(entry.lines.map((l) => l.creditCents));
  if (dr !== cr) throw new Error(`Unbalanced entry ${entry.id}: debits ${dr} != credits ${cr}`);
  return entry;
}

const evidenceFor = (basis: string, sourceIds: string[]) =>
  sourceIds.length ? `${basis} [sources: ${sourceIds.join(', ')}]` : basis;

function withCreditLine(debitLines: JournalLine[], account: string, memo: string, evidence: string): JournalLine[] {
  const total = sumCents(debitLines.map((l) => l.debitCents));
  return [...debitLines, { account, team: null, debitCents: 0, creditCents: total, memo, evidence }];
}

export function buildAccrual(month: Month, estimates: Estimate[]): JournalEntry {
  const trueUps = estimates.filter((e) => e.month === month && e.method === 'trueUp');
  if (trueUps.length === 0) throw new Error(`No trueUp estimates for ${month}`);
  const label = monthLabel(month);
  const debitLines: JournalLine[] = trueUps.map((e) => ({
    account: EXPENSE_ACCOUNT[e.team],
    team: e.team,
    debitCents: toCents(e.amountUsd),
    creditCents: 0,
    memo: `Accrued AI usage — ${TEAM_INFO[e.team].label} — ${label}`,
    evidence: evidenceFor(e.basis, e.sourceIds),
  }));
  return assertBalanced({
    id: `JE-${month}-ACCRUAL`,
    month,
    date: lastDayOfMonth(month),
    kind: 'accrual',
    status: 'draft',
    lines: withCreditLine(debitLines, ACCRUED_LIABILITIES, `Accrued AI usage — ${label}`, `Sum of ${trueUps.length} team estimates`),
    approvedAt: null,
  });
}

export function buildReversal(accrual: JournalEntry): JournalEntry {
  if (accrual.kind !== 'accrual') throw new Error(`Can only reverse an accrual, got ${accrual.kind} ${accrual.id}`);
  return assertBalanced({
    id: `JE-${accrual.month}-REVERSAL`,
    month: accrual.month,
    date: firstDayOfNextMonth(accrual.month),
    kind: 'reversal',
    status: 'posted',
    lines: accrual.lines.map((l) => ({
      ...l,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      memo: `Reverse: ${l.memo}`,
      evidence: `Reversal of ${accrual.id}`,
    })),
    approvedAt: null,
  });
}

export function buildActual(month: Month, actuals: Actual[]): JournalEntry {
  const label = monthLabel(month);
  const debitLines: JournalLine[] = actuals
    .filter((a) => a.month === month)
    .map((a) => ({
      account: EXPENSE_ACCOUNT[a.team],
      team: a.team,
      debitCents: toCents(a.amountUsd),
      creditCents: 0,
      memo: `AI usage invoiced — ${TEAM_INFO[a.team].label} — ${label}`,
      evidence: evidenceFor('Provider invoice / usage report', a.sourceIds),
    }));
  if (debitLines.length === 0) throw new Error(`No actuals for ${month}`);
  return assertBalanced({
    id: `JE-${month}-ACTUAL`,
    month,
    date: firstDayOfNextMonth(month),
    kind: 'actual',
    status: 'posted',
    lines: withCreditLine(debitLines, ACCOUNTS_PAYABLE, `AI usage invoices — ${label}`, `Sum of ${debitLines.length} team actuals`),
    approvedAt: null,
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/close/journal.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/close/money.ts src/close/journal.ts src/close/journal.test.ts
git commit -m "feat(close): balanced accrual, reversal, actual entries in integer cents"
```

---

### Task 3: Variances and the memo threshold

**Files:**
- Create: `src/close/variance.ts`
- Test: `src/close/variance.test.ts`

**Interfaces:**
- Consumes: `buildAccrual` (Task 2), `toCents`, `fromCents`, `MEMO_THRESHOLD`, `TEAMS`
- Produces: `needsMemo(varianceUsd: number, variancePct: number): boolean`, and `computeVariances(accrual: JournalEntry, actuals: Actual[]): Variance[]`, which returns rows in `TEAMS` order and includes every team that appears in either the accrual or the actuals

- [ ] **Step 1: Write the failing test**

`src/close/variance.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Actual, Estimate, Team } from '../shared/types';
import { buildAccrual } from './journal';
import { computeVariances, needsMemo } from './variance';

describe('needsMemo (both >10% and >$500, strictly)', () => {
  it.each([
    [500, 0.1, false],       // exactly on both edges
    [501, 0.1002, true],     // just over both
    [450, 0.1125, false],    // % over, $ under
    [900, 0.09, false],      // $ over, % under
    [-2000, -0.2, true],     // negative variances count by magnitude
    [-500, -0.5, false],
  ])('variance $%d at %d -> %s', (usd, pct, expected) => {
    expect(needsMemo(usd, pct)).toBe(expected);
  });
});

const est = (team: Team, amountUsd: number): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method: 'trueUp', amountUsd, actualToDateUsd: 0,
  basis: 'b', confidence: 'high', sourceIds: [],
});
const act = (team: Team, amountUsd: number): Actual => ({ team, month: '2026-10', amountUsd, sourceIds: [] });

describe('computeVariances', () => {
  const accrual = buildAccrual('2026-10', [est('support', 10040), est('growth', 9000), est('search', 5000)]);

  it('compares actuals with the booked accrual, team by team, in team order', () => {
    const vs = computeVariances(accrual, [act('growth', 5600), act('support', 10210), act('search', 5500), act('platform', 300)]);
    expect(vs.map((v) => v.team)).toEqual(['support', 'search', 'growth', 'platform']);

    const growth = vs.find((v) => v.team === 'growth')!;
    expect(growth).toMatchObject({ estimateUsd: 9000, actualUsd: 5600, varianceUsd: -3400, needsMemo: true });
    expect(growth.variancePct).toBeCloseTo(-0.3778, 4);

    expect(vs.find((v) => v.team === 'support')!.needsMemo).toBe(false); // +$170
    expect(vs.find((v) => v.team === 'search')!).toMatchObject({ varianceUsd: 500, variancePct: 0.1, needsMemo: false });
  });

  it('treats an unaccrued team as a 100% variance', () => {
    const platform = computeVariances(accrual, [act('platform', 800)]).find((v) => v.team === 'platform')!;
    expect(platform).toMatchObject({ estimateUsd: 0, actualUsd: 800, variancePct: 1, needsMemo: true });
  });

  it('treats a missing actual as zero', () => {
    const support = computeVariances(accrual, []).find((v) => v.team === 'support')!;
    expect(support).toMatchObject({ actualUsd: 0, varianceUsd: -10040, variancePct: -1, needsMemo: true });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/close/variance.test.ts`
Expected: FAIL, because `./variance` can't be resolved.

- [ ] **Step 3: Write `variance.ts`**

```ts
import { MEMO_THRESHOLD, TEAMS } from '../shared/config';
import type { Actual, JournalEntry, Variance } from '../shared/types';
import { fromCents, sumCents, toCents } from './money';

export function needsMemo(varianceUsd: number, variancePct: number): boolean {
  return Math.abs(variancePct) > MEMO_THRESHOLD.pct && Math.abs(varianceUsd) > MEMO_THRESHOLD.usd;
}

export function computeVariances(accrual: JournalEntry, actuals: Actual[]): Variance[] {
  const teams = TEAMS.filter(
    (t) => accrual.lines.some((l) => l.team === t) || actuals.some((a) => a.team === t && a.month === accrual.month),
  );
  return teams.map((team) => {
    const estimateCents = sumCents(accrual.lines.filter((l) => l.team === team).map((l) => l.debitCents));
    const actualCents = sumCents(actuals.filter((a) => a.team === team && a.month === accrual.month).map((a) => toCents(a.amountUsd)));
    const varianceCents = actualCents - estimateCents;
    const pct = estimateCents === 0 ? (actualCents === 0 ? 0 : 1) : varianceCents / estimateCents;
    return {
      team,
      month: accrual.month,
      estimateUsd: fromCents(estimateCents),
      actualUsd: fromCents(actualCents),
      varianceUsd: fromCents(varianceCents),
      variancePct: Math.round(pct * 10000) / 10000,
      needsMemo: needsMemo(fromCents(varianceCents), pct),
    };
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/close/variance.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/close/variance.ts src/close/variance.test.ts
git commit -m "feat(close): variances vs booked accrual with strict memo thresholds"
```

---

### Task 4: Memo trigger, with a placeholder fallback

**Files:**
- Create: `src/close/memoTrigger.ts`
- Test: `src/close/memoTrigger.test.ts`

**Interfaces:**
- Consumes: `Variance`, `JournalEntry`, `TeamContext`, `MemoInput`, `Memo`; `TEAM_INFO`, `monthLabel`; `formatUsd`, `formatPct`; `buildAccrual`, `computeVariances`
- Produces:
  - `buildMemoInputs(variances: Variance[], accrual: JournalEntry, contexts: TeamContext[]): MemoInput[]` (flagged teams only)
  - `placeholderMemo(input: MemoInput): Memo`
  - `draftMemos(inputs: MemoInput[], draft: (i: MemoInput) => Promise<Memo>): Promise<Memo[]>`, which never throws, forces `status: 'draft'`, and fixes the memo id to `MEMO-<month>-<team>`

- [ ] **Step 1: Write the failing test**

`src/close/memoTrigger.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Actual, Estimate, Memo, MemoInput, Team, TeamContext } from '../shared/types';
import { buildAccrual } from './journal';
import { buildMemoInputs, draftMemos, placeholderMemo } from './memoTrigger';
import { computeVariances } from './variance';

const est = (team: Team, amountUsd: number): Estimate => ({
  team, month: '2026-10', asOf: '2026-10-25', method: 'trueUp', amountUsd, actualToDateUsd: 0,
  basis: `${team}: campaign 2x from Oct 15 (Jess, Slack)`, confidence: 'medium', sourceIds: ['usage:growth:2026-10'],
});
const act = (team: Team, amountUsd: number): Actual => ({ team, month: '2026-10', amountUsd, sourceIds: [] });

const accrual = buildAccrual('2026-10', [est('support', 10040), est('growth', 9000)]);
const variances = computeVariances(accrual, [act('support', 10210), act('growth', 5600)]);
const growthCtx: TeamContext = {
  id: 'ctx-growth-1', team: 'growth', month: '2026-10', replied: true, leadName: 'Jess',
  quote: 'Big campaign goes out mid-October', source: 'slack', receivedAt: '2026-10-24T00:00:00Z',
  events: [{ kind: 'campaign', description: 'October campaign', startDate: '2026-10-15', multiplier: 2 }],
};

describe('buildMemoInputs', () => {
  it('creates inputs only for flagged variances, with the context and evidence attached', () => {
    const inputs = buildMemoInputs(variances, accrual, [growthCtx]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      team: 'growth', leadName: 'Jess', estimateUsd: 9000, actualUsd: 5600, varianceUsd: -3400,
      quote: 'Big campaign goes out mid-October',
    });
    expect(inputs[0].basis).toContain('campaign 2x from Oct 15');
    expect(inputs[0].events).toHaveLength(1);
    expect(inputs[0].sourceIds).toEqual(['JE-2026-10-ACCRUAL', 'JE-2026-10-ACTUAL', 'context:ctx-growth-1']);
  });

  it('falls back to the configured lead and no quote when there is no context', () => {
    const [input] = buildMemoInputs(variances, accrual, []);
    expect(input).toMatchObject({ leadName: 'Jess', quote: null, events: [] });
  });
});

describe('draftMemos', () => {
  const [input] = buildMemoInputs(variances, accrual, [growthCtx]);

  it('passes LLM memos through as drafts with a stable id', async () => {
    const llm = async (i: MemoInput): Promise<Memo> => ({
      ...placeholderMemo(i), id: 'whatever', text: 'LLM text', generatedBy: 'llm', status: 'attached',
    });
    const [memo] = await draftMemos([input], llm);
    expect(memo).toMatchObject({ id: 'MEMO-2026-10-growth', text: 'LLM text', generatedBy: 'llm', status: 'draft' });
  });

  it('falls back to a deterministic placeholder when the LLM throws', async () => {
    const [memo] = await draftMemos([input], async () => { throw new Error('rate limited'); });
    expect(memo.generatedBy).toBe('placeholder');
    expect(memo.text).toContain('$5,600');
    expect(memo.text).toContain('$9,000');
    expect(memo.text).toContain('-$3,400');
    expect(memo.text).toContain('-37.8%');
    expect(memo.text).toContain('Jess said: "Big campaign goes out mid-October"');
    expect(memo.sources).toEqual(input.sourceIds);
  });

  it('says so when the lead did not reply', () => {
    const memo = placeholderMemo({ ...input, quote: null });
    expect(memo.text).toContain('Jess did not reply to the month-end check-in');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/close/memoTrigger.test.ts`
Expected: FAIL, because `./memoTrigger` can't be resolved.

- [ ] **Step 3: Write `memoTrigger.ts`**

```ts
import { TEAM_INFO, monthLabel } from '../shared/config';
import { formatPct, formatUsd } from '../shared/format';
import type { JournalEntry, Memo, MemoInput, TeamContext, Variance } from '../shared/types';

export function buildMemoInputs(variances: Variance[], accrual: JournalEntry, contexts: TeamContext[]): MemoInput[] {
  return variances
    .filter((v) => v.needsMemo)
    .map((v) => {
      const line = accrual.lines.find((l) => l.team === v.team);
      const ctx = contexts.find((c) => c.team === v.team && c.month === v.month);
      return {
        team: v.team,
        month: v.month,
        leadName: ctx?.leadName ?? TEAM_INFO[v.team].leadName,
        estimateUsd: v.estimateUsd,
        actualUsd: v.actualUsd,
        varianceUsd: v.varianceUsd,
        variancePct: v.variancePct,
        basis: line?.evidence ?? 'No accrual line for this team',
        quote: ctx?.quote ?? null,
        events: ctx?.events ?? [],
        sourceIds: [accrual.id, `JE-${v.month}-ACTUAL`, ...(ctx ? [`context:${ctx.id}`] : [])],
      };
    });
}

const memoId = (i: MemoInput) => `MEMO-${i.month}-${i.team}`;

export function placeholderMemo(i: MemoInput): Memo {
  const said = i.quote
    ? `${i.leadName} said: "${i.quote}".`
    : `${i.leadName} did not reply to the month-end check-in.`;
  return {
    id: memoId(i),
    team: i.team,
    month: i.month,
    text:
      `${TEAM_INFO[i.team].label} AI usage for ${monthLabel(i.month)} was ${formatUsd(i.actualUsd)} ` +
      `against an accrual of ${formatUsd(i.estimateUsd)}, a variance of ${formatUsd(i.varianceUsd)} ` +
      `(${formatPct(i.variancePct)}). The accrual basis was: ${i.basis}. ${said} ` +
      `[Placeholder — LLM draft unavailable; controller to complete.]`,
    sources: i.sourceIds,
    generatedBy: 'placeholder',
    status: 'draft',
    editedAt: null,
  };
}

export async function draftMemos(inputs: MemoInput[], draft: (i: MemoInput) => Promise<Memo>): Promise<Memo[]> {
  return Promise.all(
    inputs.map(async (i) => {
      try {
        const memo = await draft(i);
        return { ...memo, id: memoId(i), team: i.team, month: i.month, status: 'draft' as const, editedAt: null };
      } catch (err) {
        console.warn(`draftMemo failed for ${i.team}, using placeholder:`, (err as Error).message);
        return placeholderMemo(i);
      }
    }),
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/close/memoTrigger.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/close/memoTrigger.ts src/close/memoTrigger.test.ts
git commit -m "feat(close): memo inputs for flagged variances with placeholder fallback"
```

---

### Task 5: CSV export

**Files:**
- Create: `src/close/csv.ts`
- Test: `src/close/csv.test.ts`

**Interfaces:**
- Consumes: `JournalEntry`
- Produces: `CSV_HEADER` (`'date,je_id,account,team,debit,credit,memo,evidence'`), and `toCsv(entries: JournalEntry[]): string`, which emits LF line endings with a trailing newline and amounts as `1234.56`

- [ ] **Step 1: Write the failing test**

`src/close/csv.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '../shared/types';
import { CSV_HEADER, toCsv } from './csv';

const entry: JournalEntry = {
  id: 'JE-2026-10-ACCRUAL', month: '2026-10', date: '2026-10-31', kind: 'accrual', status: 'approved', approvedAt: null,
  lines: [
    { account: '5010', team: 'support', debitCents: 1004000, creditCents: 0,
      memo: 'Accrued AI usage — Support — Oct 2026', evidence: '$6,120 through Oct 25; "3x" from Oct 27 (Priya, Slack)' },
    { account: '2100', team: null, debitCents: 0, creditCents: 1004000, memo: '=HYPERLINK("x")', evidence: 'Sum' },
  ],
};

describe('toCsv', () => {
  const lines = toCsv([entry]).split('\n');

  it('starts with the exact header', () => {
    expect(CSV_HEADER).toBe('date,je_id,account,team,debit,credit,memo,evidence');
    expect(lines[0]).toBe(CSV_HEADER);
  });

  it('writes one row per line with two-decimal amounts and a trailing newline', () => {
    expect(lines).toHaveLength(4); // header, 2 rows, '' after trailing newline
    expect(lines[3]).toBe('');
    expect(lines[1].startsWith('2026-10-31,JE-2026-10-ACCRUAL,5010,support,10040.00,0.00,')).toBe(true);
    expect(lines[2].startsWith('2026-10-31,JE-2026-10-ACCRUAL,2100,,0.00,10040.00,')).toBe(true);
  });

  it('quotes commas and doubles embedded quotes', () => {
    expect(lines[1]).toContain('"$6,120 through Oct 25; ""3x"" from Oct 27 (Priya, Slack)"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/close/csv.test.ts`
Expected: FAIL, because `./csv` can't be resolved.

- [ ] **Step 3: Write `csv.ts`**

```ts
import type { JournalEntry } from '../shared/types';

export const CSV_HEADER = 'date,je_id,account,team,debit,credit,memo,evidence';

const amount = (cents: number) => (cents / 100).toFixed(2);

function cell(raw: string): string {
  const s = /^[=+@\-]/.test(raw) && !/^-?\d/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) || s !== raw ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(entries: JournalEntry[]): string {
  const rows = entries.flatMap((e) =>
    e.lines.map((l) =>
      [e.date, e.id, l.account, l.team ?? '', amount(l.debitCents), amount(l.creditCents), l.memo, l.evidence]
        .map(cell)
        .join(','),
    ),
  );
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/close/csv.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/close/csv.ts src/close/csv.test.ts
git commit -m "feat(close): ERP-ready CSV export with quoting and formula guard"
```

---

### Task 6: History metrics

**Files:**
- Create: `src/close/history.ts`
- Test: `src/close/history.test.ts`

**Interfaces:**
- Consumes: `HistoryRow`, `HistoryReport`, `MethodError` (api.ts); `Team`
- Produces: `computeHistory(rows: HistoryRow[], biasByTeam: Record<Team, number>): HistoryReport`. `byMethod` is always in the order lastMonth, runRate, trueUp. `maeUsd` is rounded to cents and `maePct` to 4 decimal places. Rows with `actualUsd === 0` are left out of `maePct` only.

- [ ] **Step 1: Write the failing test**

`src/close/history.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HistoryRow } from '../shared/api';
import { computeHistory } from './history';

const row = (month: string, method: HistoryRow['method'], estimateUsd: number, actualUsd = 200): HistoryRow =>
  ({ month, team: 'support', method, estimateUsd, actualUsd });

describe('computeHistory', () => {
  const bias = { support: 0.05, search: 0, growth: 0.3, platform: -0.02 };
  const report = computeHistory(
    [
      row('2026-09', 'lastMonth', 100), row('2026-09', 'runRate', 180), row('2026-09', 'trueUp', 210),
      row('2026-08', 'lastMonth', 300), row('2026-08', 'runRate', 220), row('2026-08', 'trueUp', 190),
    ],
    bias,
  );

  it('computes mean absolute error per method in fixed order', () => {
    expect(report.byMethod.map((m) => m.method)).toEqual(['lastMonth', 'runRate', 'trueUp']);
    expect(report.byMethod[0]).toEqual({ method: 'lastMonth', maeUsd: 100, maePct: 0.5, n: 2 });
    expect(report.byMethod[1]).toEqual({ method: 'runRate', maeUsd: 20, maePct: 0.1, n: 2 });
    expect(report.byMethod[2]).toEqual({ method: 'trueUp', maeUsd: 10, maePct: 0.05, n: 2 });
  });

  it('lists months sorted and passes bias through untouched', () => {
    expect(report.months).toEqual(['2026-08', '2026-09']);
    expect(report.biasByTeam).toEqual(bias);
  });

  it('handles empty input', () => {
    const empty = computeHistory([], bias);
    expect(empty.byMethod[0]).toEqual({ method: 'lastMonth', maeUsd: 0, maePct: 0, n: 0 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/close/history.test.ts`
Expected: FAIL, because `./history` can't be resolved.

- [ ] **Step 3: Write `history.ts`**

```ts
import type { HistoryReport, HistoryRow, MethodError } from '../shared/api';
import type { EstimateMethod, Team } from '../shared/types';

const METHODS: EstimateMethod[] = ['lastMonth', 'runRate', 'trueUp'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeHistory(rows: HistoryRow[], biasByTeam: Record<Team, number>): HistoryReport {
  const byMethod: MethodError[] = METHODS.map((method) => {
    const rs = rows.filter((r) => r.method === method);
    const maeUsd = mean(rs.map((r) => Math.abs(r.estimateUsd - r.actualUsd)));
    const maePct = mean(rs.filter((r) => r.actualUsd !== 0).map((r) => Math.abs(r.estimateUsd - r.actualUsd) / r.actualUsd));
    return { method, maeUsd: Math.round(maeUsd * 100) / 100, maePct: Math.round(maePct * 10000) / 10000, n: rs.length };
  });
  return { months: [...new Set(rows.map((r) => r.month))].sort(), byMethod, biasByTeam };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/close/history.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit and merge**

```bash
git add src/close/history.ts src/close/history.test.ts
git commit -m "feat(close): mean absolute error by method and bias passthrough"
git checkout main && git pull && git merge --no-ff c/close-server-web && npm test && git push origin main && git checkout c/close-server-web
```

---

### Task 7: Close routes (journal list, prepare, approve, export)

**Files:**
- Create: `src/server/routes/close.ts`
- Modify: `src/server/app.ts` (mount `closeRoutes`)
- Test: `src/server/app.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `buildAccrual`, `applyOverrides`, `assertBalanced`, `toCsv`; store `getEntry`, `saveEntries`, `listEntries`; `Deps`
- Produces:
  - `GET /api/journal?month` returns `JournalEntry[]`
  - `POST /api/close/:month/prepare` with body `{ overrides?: Overrides }` returns `PrepareResult`. It answers 409 if the accrual is already approved.
  - `POST /api/journal/:id/approve` returns `JournalEntry`. It answers 404 if the entry is unknown and 400 if it isn't an accrual.
  - `GET /api/journal/:id/export.csv` returns `text/csv` as an attachment. It answers 409 while the entry is still a draft.
  - `closeRoutes(deps)`. Task 8 adds the actuals handler to this function.

- [ ] **Step 1: Append the failing tests to `src/server/app.test.ts`**

```ts
describe('accrual close', () => {
  it('prepares a balanced draft accrual from trueUp estimates', async () => {
    const res = await post('/api/close/2026-10/prepare');
    expect(res.status).toBe(200);
    const { entry } = await res.json();
    expect(entry).toMatchObject({ id: 'JE-2026-10-ACCRUAL', status: 'draft', date: '2026-10-31' });
    expect(entry.lines.find((l: { team: string }) => l.team === 'support').debitCents).toBe(759000);
  });

  it('applies controller overrides', async () => {
    const { entry } = await (await post('/api/close/2026-10/prepare', { overrides: { growth: 7000 } })).json();
    expect(entry.lines.find((l: { team: string }) => l.team === 'growth').debitCents).toBe(700000);
  });

  it('rejects negative overrides', async () => {
    expect((await post('/api/close/2026-10/prepare', { overrides: { growth: -1 } })).status).toBe(400);
  });

  it('blocks export until approved, then exports CSV', async () => {
    await post('/api/close/2026-10/prepare');
    expect((await app.request('/api/journal/JE-2026-10-ACCRUAL/export.csv')).status).toBe(409);

    const approved = await (await post('/api/journal/JE-2026-10-ACCRUAL/approve')).json();
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeTruthy();

    const csv = await app.request('/api/journal/JE-2026-10-ACCRUAL/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('JE-2026-10-ACCRUAL.csv');
    expect((await csv.text()).split('\n')[0]).toBe('date,je_id,account,team,debit,credit,memo,evidence');
  });

  it('refuses to re-prepare an approved accrual', async () => {
    await post('/api/close/2026-10/prepare');
    await post('/api/journal/JE-2026-10-ACCRUAL/approve');
    expect((await post('/api/close/2026-10/prepare')).status).toBe(409);
  });

  it('404s on unknown entries and lists the month journal', async () => {
    expect((await post('/api/journal/JE-nope/approve')).status).toBe(404);
    await post('/api/close/2026-10/prepare');
    const list = await (await app.request('/api/journal?month=2026-10')).json();
    expect(list.map((e: { id: string }) => e.id)).toEqual(['JE-2026-10-ACCRUAL']);
  });
});
```

- [ ] **Step 2: Run it and confirm the new tests fail**

Run: `npx vitest run src/server/app.test.ts`
Expected: the new "accrual close" tests FAIL with 404s, because the routes aren't mounted yet.

- [ ] **Step 3: Write `routes/close.ts` and mount it**

`src/server/routes/close.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { PrepareResult } from '../../shared/api';
import { asOfFor } from '../../shared/config';
import { toCsv } from '../../close/csv';
import { applyOverrides, assertBalanced, buildAccrual } from '../../close/journal';
import type { Deps } from '../deps';
import { HttpError, monthParam } from '../http';
import { getEntry, listEntries, saveEntries } from '../store';

const amount = z.number().nonnegative().optional();
const PrepareBody = z.object({
  overrides: z.object({ support: amount, search: amount, growth: amount, platform: amount }).partial().default({}),
});

export const accrualId = (month: string) => `JE-${month}-ACCRUAL`;

async function requireEntry(id: string) {
  const entry = await getEntry(id);
  if (!entry) throw new HttpError(404, `No journal entry ${id}`);
  return entry;
}

export function closeRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/journal', async (c) => c.json(await listEntries(monthParam(c.req.query('month')))));

  r.post('/close/:month/prepare', async (c) => {
    const month = monthParam(c.req.param('month'));
    const parsed = PrepareBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));

    const existing = await getEntry(accrualId(month));
    if (existing?.status === 'approved') throw new HttpError(409, `${existing.id} is already approved`);

    const { estimates } = await deps.estimateAll(month, asOfFor(month));
    const adjusted = applyOverrides(estimates, parsed.data.overrides);
    const entry = buildAccrual(month, adjusted);
    await saveEntries(entry);
    const result: PrepareResult = { entry, estimates: adjusted.filter((e) => e.method === 'trueUp') };
    return c.json(result);
  });

  r.post('/journal/:id/approve', async (c) => {
    const entry = await requireEntry(c.req.param('id'));
    if (entry.kind !== 'accrual') throw new HttpError(400, `Only accruals need approval; ${entry.id} is ${entry.kind}`);
    const approved = assertBalanced({ ...entry, status: 'approved', approvedAt: new Date().toISOString() });
    await saveEntries(approved);
    return c.json(approved);
  });

  r.get('/journal/:id/export.csv', async (c) => {
    const entry = await requireEntry(c.req.param('id'));
    if (entry.status === 'draft') throw new HttpError(409, `Approve ${entry.id} before exporting`);
    return c.body(toCsv([entry]), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${entry.id}.csv"`,
    });
  });

  return r;
}
```

In `src/server/app.ts`, add the import and the mount:
```ts
import { closeRoutes } from './routes/close';
```
```ts
  app.route('/api', estimateRoutes(deps));
  app.route('/api', closeRoutes(deps));
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run src/server/app.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server
git commit -m "feat(server): prepare, approve, list and CSV-export the accrual"
```

---

### Task 8: Actuals, reports, and demo routes

**Files:**
- Create: `src/server/routes/reports.ts`, `src/server/routes/demo.ts`, `src/server/demoReset.ts`
- Modify: `src/server/routes/close.ts` (add the actuals handler), `src/server/app.ts` (mount 2 routers)
- Test: `src/server/app.test.ts` (append), `src/server/demoReset.test.ts`

**Interfaces:**
- Consumes: `buildReversal`, `buildActual`, `computeVariances`, `buildMemoInputs`, `draftMemos`, `computeHistory`; the store; `Deps`
- Produces:
  - `POST /api/close/:month/actuals` returns `ActualsResult`. It answers 409 unless the accrual is approved, 404 if there are no actuals, and is idempotent.
  - `GET /api/variances?month` returns `Variance[]`
  - `GET /api/memos?month` returns `Memo[]`
  - `PUT /api/memos/:id` with body `{ text }` returns `Memo` with `editedAt` set
  - `POST /api/memos/:id/attach` returns `Memo` with status `attached`
  - `GET /api/history` returns `HistoryReport`
  - `POST /api/demo/reset` returns `{ ok: true, contexts: number }`
  - `POST /api/demo/checkin` with body `{ team }` returns `{ ok: true }`, or 502 with `{ error }`
  - `demoReset(load?: () => Promise<TeamContext[]>): Promise<{ contexts: number }>`

- [ ] **Step 1: Append the failing tests to `src/server/app.test.ts`**

```ts
async function approveAccrual() {
  await post('/api/close/2026-10/prepare');
  await post('/api/journal/JE-2026-10-ACCRUAL/approve');
}

describe('actuals and reports', () => {
  it('requires an approved accrual', async () => {
    expect((await post('/api/close/2026-10/actuals')).status).toBe(409);
  });

  it('posts reversal and actual, computes variances and drafts memos for flagged teams', async () => {
    await approveAccrual();
    const res = await post('/api/close/2026-10/actuals');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reversal).toMatchObject({ id: 'JE-2026-10-REVERSAL', date: '2026-11-01' });
    expect(body.actual).toMatchObject({ id: 'JE-2026-10-ACTUAL', date: '2026-11-01' });
    expect(body.variances).toHaveLength(4);
    expect(body.variances.filter((v: { needsMemo: boolean }) => v.needsMemo).map((v: { team: string }) => v.team)).toEqual(['growth']);
    expect(body.memos).toHaveLength(1);
    expect(body.memos[0]).toMatchObject({ id: 'MEMO-2026-10-growth', generatedBy: 'llm' });

    const journal = await (await app.request('/api/journal?month=2026-10')).json();
    expect(journal).toHaveLength(3);
    expect(await (await app.request('/api/variances?month=2026-10')).json()).toHaveLength(4);
  });

  it('is idempotent', async () => {
    await approveAccrual();
    await post('/api/close/2026-10/actuals');
    await post('/api/close/2026-10/actuals');
    expect(await (await app.request('/api/journal?month=2026-10')).json()).toHaveLength(3);
    expect(await (await app.request('/api/memos?month=2026-10')).json()).toHaveLength(1);
  });

  it('falls back to a placeholder memo when draftMemo throws', async () => {
    setup({ draftMemo: async () => { throw new Error('LLM down'); } });
    await approveAccrual();
    const { memos } = await (await post('/api/close/2026-10/actuals')).json();
    expect(memos[0].generatedBy).toBe('placeholder');
  });

  it('edits and attaches memos', async () => {
    await approveAccrual();
    await post('/api/close/2026-10/actuals');
    const edited = await (await put('/api/memos/MEMO-2026-10-growth', { text: 'Campaign slipped to November.' })).json();
    expect(edited).toMatchObject({ text: 'Campaign slipped to November.', status: 'draft' });
    expect(edited.editedAt).toBeTruthy();
    const attached = await (await post('/api/memos/MEMO-2026-10-growth/attach')).json();
    expect(attached.status).toBe('attached');
    expect((await put('/api/memos/MEMO-2026-10-growth', { text: '' })).status).toBe(400);
    expect((await post('/api/memos/nope/attach')).status).toBe(404);
  });

  it('reports history by method and bias by team', async () => {
    const report = await (await app.request('/api/history')).json();
    expect(report.byMethod.map((m: { method: string }) => m.method)).toEqual(['lastMonth', 'runRate', 'trueUp']);
    expect(report.months[0]).toBe('2026-03');
    expect(report.months.at(-1)).toBe('2026-09');
    expect(report.biasByTeam.growth).toBe(0.3);
  });
});

describe('demo routes', () => {
  it('reset clears the store and seeds contexts except the live team for the demo month', async () => {
    await approveAccrual();
    const res = await (await post('/api/demo/reset')).json();
    expect(res).toEqual({ ok: true, contexts: 1 });
    expect(await (await app.request('/api/journal?month=2026-10')).json()).toEqual([]);
    const ctxs = await (await app.request('/api/contexts?month=2026-10')).json();
    expect(ctxs.map((c: { team: string }) => c.team)).toEqual(['growth']);
  });

  it('checkin calls sendCheckIn and reports Slack failures as 502', async () => {
    const calls: string[] = [];
    setup({ sendCheckIn: async (team, month) => { calls.push(`${team}:${month}`); } });
    expect((await post('/api/demo/checkin', { team: 'support' })).status).toBe(200);
    expect(calls).toEqual(['support:2026-10']);

    setup({ sendCheckIn: async () => { throw new Error('no token'); } });
    const res = await post('/api/demo/checkin', { team: 'support' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('no token');
  });
});
```

- [ ] **Step 2: Run it and confirm the new tests fail**

Run: `npx vitest run src/server/app.test.ts`
Expected: the new tests FAIL (404s or 409 mismatches).

- [ ] **Step 3: Add the actuals handler to `routes/close.ts`**

Add these imports at the top of `src/server/routes/close.ts`:
```ts
import type { ActualsResult } from '../../shared/api';
import { buildActual, buildReversal } from '../../close/journal';
import { buildMemoInputs, draftMemos } from '../../close/memoTrigger';
import { computeVariances } from '../../close/variance';
import { listContexts, replaceMemos, replaceVariances } from '../store';
```
(Merge them into the existing import lines from `../../close/journal` and `../store`. Don't import the same module twice.)

Add this handler just before `return r;`:
```ts
  r.post('/close/:month/actuals', async (c) => {
    const month = monthParam(c.req.param('month'));
    const accrual = await getEntry(accrualId(month));
    if (!accrual || accrual.status !== 'approved') throw new HttpError(409, `Approve the ${month} accrual before loading actuals`);

    const actuals = await deps.loadActuals(month);
    if (actuals.length === 0) throw new HttpError(404, `No actuals for ${month}`);

    const reversal = buildReversal(accrual);
    const actual = buildActual(month, actuals);
    const variances = computeVariances(accrual, actuals);
    const memos = await draftMemos(buildMemoInputs(variances, accrual, await listContexts(month)), deps.draftMemo);

    await saveEntries(reversal, actual);
    await replaceVariances(month, variances);
    await replaceMemos(month, memos);
    const result: ActualsResult = { reversal, actual, variances, memos };
    return c.json(result);
  });
```

- [ ] **Step 4: Write `routes/reports.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import type { HistoryRow } from '../../shared/api';
import { DEMO, asOfFor, monthsBetween, nextMonth, prevMonth } from '../../shared/config';
import { computeHistory } from '../../close/history';
import type { Deps } from '../deps';
import { HttpError, monthParam } from '../http';
import { getMemo, listMemos, listVariances, saveMemo } from '../store';

const EditMemoBody = z.object({ text: z.string().trim().min(1) });

async function requireMemo(id: string) {
  const memo = await getMemo(id);
  if (!memo) throw new HttpError(404, `No memo ${id}`);
  return memo;
}

export function reportRoutes(deps: Deps) {
  const r = new Hono();

  r.get('/variances', async (c) => c.json(await listVariances(monthParam(c.req.query('month')))));
  r.get('/memos', async (c) => c.json(await listMemos(monthParam(c.req.query('month')))));

  r.put('/memos/:id', async (c) => {
    const memo = await requireMemo(c.req.param('id'));
    const parsed = EditMemoBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'Memo text is required');
    const edited = { ...memo, text: parsed.data.text, editedAt: new Date().toISOString() };
    await saveMemo(edited);
    return c.json(edited);
  });

  r.post('/memos/:id/attach', async (c) => {
    const attached = { ...(await requireMemo(c.req.param('id'))), status: 'attached' as const };
    await saveMemo(attached);
    return c.json(attached);
  });

  r.get('/history', async (c) => {
    // Skip the first fixture month: lastMonth has no prior actual to use.
    const months = monthsBetween(nextMonth(DEMO.firstMonth), prevMonth(DEMO.month));
    const rows: HistoryRow[] = [];
    for (const month of months) {
      const [{ estimates }, actuals] = await Promise.all([deps.estimateAll(month, asOfFor(month)), deps.loadActuals(month)]);
      for (const e of estimates) {
        const a = actuals.find((x) => x.team === e.team);
        if (a) rows.push({ month, team: e.team, method: e.method, estimateUsd: e.amountUsd, actualUsd: a.amountUsd });
      }
    }
    const { biasSuggestionPct } = await deps.estimateAll(DEMO.month, DEMO.asOf);
    return c.json(computeHistory(rows, biasSuggestionPct));
  });

  return r;
}
```

- [ ] **Step 5: Write `demoReset.ts` and `routes/demo.ts`, then mount both routers**

`src/server/demoReset.ts`:
```ts
import { pathToFileURL } from 'node:url';
import { DEMO } from '../shared/config';
import type { TeamContext } from '../shared/types';
import { loadContexts } from '../ingest/loadContexts';
import { resetStore } from './store';

// Wipes data/store and seeds every fixture context except the live team's demo-month reply (Priya answers live).
export async function demoReset(load: () => Promise<TeamContext[]> = loadContexts): Promise<{ contexts: number }> {
  const seed = (await load()).filter((c) => !(c.month === DEMO.month && c.team === DEMO.liveTeam));
  await resetStore(seed);
  return { contexts: seed.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demoReset().then(
    ({ contexts }) => console.log(`Demo reset: store cleared, ${contexts} contexts seeded.`),
    (err) => { console.error(err); process.exit(1); },
  );
}
```

`src/server/routes/demo.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { DEMO } from '../../shared/config';
import type { Deps } from '../deps';
import { demoReset } from '../demoReset';
import { HttpError } from '../http';

const CheckinBody = z.object({ team: z.enum(['support', 'search', 'growth', 'platform']) });

export function demoRoutes(deps: Deps) {
  const r = new Hono();

  r.post('/demo/reset', async (c) => c.json({ ok: true, ...(await demoReset(deps.loadContexts)) }));

  r.post('/demo/checkin', async (c) => {
    const parsed = CheckinBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'team is required');
    try {
      await deps.sendCheckIn(parsed.data.team, DEMO.month);
    } catch (err) {
      throw new HttpError(502, `Slack check-in failed: ${(err as Error).message}`);
    }
    return c.json({ ok: true });
  });

  return r;
}
```

In `src/server/app.ts`, add the imports and mounts:
```ts
import { demoRoutes } from './routes/demo';
import { reportRoutes } from './routes/reports';
```
```ts
  app.route('/api', closeRoutes(deps));
  app.route('/api', reportRoutes(deps));
  app.route('/api', demoRoutes(deps));
```

- [ ] **Step 6: Run everything and confirm it passes**

Run: `npm test`
Expected: all pass (app.test now has 18 tests). Then run `npm run typecheck`. Expected: exit 0.

- [ ] **Step 7: Smoke-test against the real stubs**

```bash
npm run demo:reset
npx tsx src/server/index.ts &
curl -s localhost:8787/api/estimates | head -c 300; echo
curl -s -XPOST localhost:8787/api/close/2026-10/prepare -H 'content-type: application/json' -d '{}' | head -c 200; echo
curl -s -XPOST localhost:8787/api/journal/JE-2026-10-ACCRUAL/approve | head -c 120; echo
curl -s localhost:8787/api/journal/JE-2026-10-ACCRUAL/export.csv
curl -s -XPOST localhost:8787/api/close/2026-10/actuals | head -c 300; echo
kill %1
```
Expected: JSON estimates, then a draft entry, then `"status":"approved"`, then a CSV whose first line is the header, then an actuals result in which Growth has `needsMemo: true`.

- [ ] **Step 8: Commit and merge**

```bash
git add -A
git commit -m "feat(server): actuals close, variances, memos, history, demo reset and checkin"
git checkout main && git pull && git merge --no-ff c/close-server-web && npm test && git push origin main && git checkout c/close-server-web
```

---

### Task 9: Web shell (API client, polling hook, styles, tabs)

**Files:**
- Create: `web/src/api.ts`, `web/src/usePoll.ts`, `web/src/styles.css`, `web/src/App.tsx`
- Create (placeholders, filled in by Tasks 10–13): `web/src/screens/{AccrualReview,CheckinPreview,VarianceMemo,History}.tsx`
- Modify: `web/src/main.tsx` (replace the whole file)

**Interfaces:**
- Consumes: every REST route from Tasks 1, 7 and 8; the types in `src/shared/api.ts` and `types.ts`
- Produces: the `api` object (methods listed below), `usePoll<T>(fn, ms, deps?) → { data, error, reload }`, and the CSS classes `num`, `low`, `flash`, `danger`, `badge`, `panel`, `actions`, `muted`, `error`

- [ ] **Step 1: `web/src/api.ts`**

```ts
import type { ActualsResult, ContextInput, HistoryReport, Overrides, PostContextResult, PrepareResult } from '../../src/shared/api';
import type { EstimateResult, JournalEntry, Memo, Month, Team, TeamContext, Variance } from '../../src/shared/types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
const post = <T>(path: string, body: unknown = {}) => req<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  estimates: (month: Month) => req<EstimateResult>(`/api/estimates?month=${month}`),
  contexts: (month: Month) => req<TeamContext[]>(`/api/contexts?month=${month}`),
  postContext: (body: ContextInput) => post<PostContextResult>('/api/contexts', body),
  journal: (month: Month) => req<JournalEntry[]>(`/api/journal?month=${month}`),
  prepare: (month: Month, overrides: Overrides) => post<PrepareResult>(`/api/close/${month}/prepare`, { overrides }),
  approve: (id: string) => post<JournalEntry>(`/api/journal/${id}/approve`),
  exportUrl: (id: string) => `/api/journal/${id}/export.csv`,
  loadActuals: (month: Month) => post<ActualsResult>(`/api/close/${month}/actuals`),
  variances: (month: Month) => req<Variance[]>(`/api/variances?month=${month}`),
  memos: (month: Month) => req<Memo[]>(`/api/memos?month=${month}`),
  editMemo: (id: string, text: string) => req<Memo>(`/api/memos/${id}`, { method: 'PUT', body: JSON.stringify({ text }) }),
  attachMemo: (id: string) => post<Memo>(`/api/memos/${id}/attach`),
  history: () => req<HistoryReport>('/api/history'),
  checkin: (team: Team) => post<{ ok: true }>('/api/demo/checkin', { team }),
  reset: () => post<{ ok: true; contexts: number }>('/api/demo/reset'),
};
```

- [ ] **Step 2: `web/src/usePoll.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';

export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await fn());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
    if (!ms) return;
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms]);

  return { data, error, reload };
}
```

- [ ] **Step 3: `web/src/styles.css`**

```css
:root {
  --ink: #1d2433; --muted: #6b7385; --line: #dfe3ea; --bg: #f6f7f9; --panel: #fff;
  --accent: #1f4fd1; --danger: #b42318; --danger-bg: #fdecea; --warn-bg: #fff6db; --ok: #18794e;
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg);
}
body { margin: 0; }
header { display: flex; align-items: baseline; gap: 16px; padding: 14px 24px; background: #111827; color: #fff; }
header h1 { font-size: 18px; margin: 0; }
header .sub { color: #9ca3af; font-size: 13px; }
header .spacer { flex: 1; }
nav { display: flex; gap: 4px; padding: 0 24px; background: #fff; border-bottom: 1px solid var(--line); }
nav button { border: 0; background: none; padding: 12px 14px; font-size: 14px; color: var(--muted); border-bottom: 2px solid transparent; cursor: pointer; }
nav button.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
main { padding: 20px 24px; max-width: 1200px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 16px; margin-bottom: 16px; }
.panel h2 { font-size: 15px; margin: 0 0 12px; display: flex; gap: 8px; align-items: center; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--line); padding: 6px 8px; }
td { border-bottom: 1px solid var(--line); padding: 8px; vertical-align: top; }
tfoot td { font-weight: 600; border-top: 2px solid var(--ink); border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.basis { color: var(--muted); max-width: 420px; }
tr.low td { background: var(--warn-bg); }
tr.danger td { background: var(--danger-bg); }
tr.flash td { animation: flash 2.5s ease-out; }
@keyframes flash { from { background: #c7f0d8; } to { background: transparent; } }
.badge { font-size: 11px; padding: 2px 6px; border-radius: 10px; background: #eef1f6; color: var(--muted); font-weight: 500; }
.badge.low, .badge.draft { background: var(--warn-bg); color: #8a5a00; }
.badge.approved, .badge.attached, .badge.posted, .badge.replied { background: #e3f5ec; color: var(--ok); }
.badge.danger { background: var(--danger-bg); color: var(--danger); }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
button.primary, a.button, button.secondary { font-size: 13px; padding: 7px 12px; border-radius: 4px; cursor: pointer; text-decoration: none; }
button.primary { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
button.secondary, a.button { background: #fff; color: var(--ink); border: 1px solid var(--line); }
button:disabled, a.button[aria-disabled="true"] { opacity: .45; pointer-events: none; }
.muted { color: var(--muted); font-size: 12px; }
.error { color: var(--danger); font-size: 13px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.memo-text { white-space: pre-wrap; line-height: 1.5; font-size: 14px; }
textarea, input, select { font: inherit; font-size: 13px; padding: 6px; border: 1px solid var(--line); border-radius: 4px; }
textarea { width: 100%; min-height: 120px; box-sizing: border-box; }
input.amount { width: 110px; text-align: right; }
```

- [ ] **Step 4: Placeholder screens (Tasks 10–13 replace each one)**

Write each of the four files with its own export name. For example, `web/src/screens/AccrualReview.tsx`:
```tsx
export function AccrualReview() {
  return <div className="panel">Accrual review — coming up</div>;
}
```
Do the same for `CheckinPreview.tsx` (`export function CheckinPreview`), `VarianceMemo.tsx` (`export function VarianceMemo`), and `History.tsx` (`export function History`).

- [ ] **Step 5: `web/src/App.tsx` and `web/src/main.tsx`**

`web/src/App.tsx`:
```tsx
import { useState } from 'react';
import { DEMO, monthLabel } from '../../src/shared/config';
import { api } from './api';
import { AccrualReview } from './screens/AccrualReview';
import { CheckinPreview } from './screens/CheckinPreview';
import { History } from './screens/History';
import { VarianceMemo } from './screens/VarianceMemo';

const TABS = [
  { key: 'accrual', label: 'Accrual review', el: <AccrualReview /> },
  { key: 'checkin', label: 'Slack check-ins', el: <CheckinPreview /> },
  { key: 'variance', label: 'Variance & memo', el: <VarianceMemo /> },
  { key: 'history', label: 'History', el: <History /> },
] as const;

export function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('accrual');

  async function reset() {
    if (!confirm('Reset demo data?')) return;
    await api.reset();
    location.reload();
  }

  return (
    <>
      <header>
        <h1>TrueUp</h1>
        <span className="sub">{DEMO.company} · {monthLabel(DEMO.month)} close · as of {DEMO.asOf}</span>
        <span className="spacer" />
        <button className="secondary" onClick={reset}>Reset demo</button>
      </header>
      <nav>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>
      <main>{TABS.find((t) => t.key === tab)!.el}</main>
    </>
  );
}
```

`web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`. Expected: exit 0.
Run: `npm run dev` and open http://localhost:5173. Expected: a dark header showing "Northwind Labs · Oct 2026 close", four tabs, and a placeholder panel on each tab.

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat(web): app shell, typed API client, polling hook, finance styles"
```

---

### Task 10: Accrual review screen

**Files:**
- Modify: `web/src/screens/AccrualReview.tsx` (replace the whole file)

**Interfaces:**
- Consumes: `api.estimates`, `api.journal`, `api.prepare`, `api.approve`, `api.exportUrl`, `usePoll`, `TEAMS`, `TEAM_INFO`, `ACCOUNT_NAMES`, `DEMO`, `formatUsd`, `formatCents`
- Produces: the screen. It polls every 3 seconds, keeps the draft entry in sync with the latest estimates and overrides, flashes rows whose estimate changed, and shows the exact export label.

- [ ] **Step 1: Write the screen**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Overrides } from '../../../src/shared/api';
import { ACCOUNT_NAMES, DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatCents, formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Team } from '../../../src/shared/types';
import { api } from '../api';
import { usePoll } from '../usePoll';

const EXPORT_LABEL = 'ERP-ready export — this is where Hyphenate would post it.';

export function AccrualReview() {
  const month = DEMO.month;
  const { data, error } = usePoll(() => api.estimates(month), 3000);
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [draft, setDraft] = useState<Record<string, string> | null>(null); // edit-mode inputs
  const [msg, setMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<Team>>(new Set());
  const prev = useRef<Partial<Record<Team, number>>>({});

  const trueUps = (data?.estimates ?? []).filter((e) => e.method === 'trueUp');
  const sig = trueUps.map((e) => `${e.team}:${e.amountUsd}`).join('|') + JSON.stringify(overrides);

  useEffect(() => {
    api.journal(month)
      .then((es) => setEntry(es.find((e) => e.kind === 'accrual') ?? null))
      .catch((e) => setMsg(e.message))
      .finally(() => setLoaded(true));
  }, [month]);

  // Keep the draft entry in step with the latest estimates (A's numbers, C's booking).
  useEffect(() => {
    if (!loaded || trueUps.length === 0 || entry?.status === 'approved') return;
    api.prepare(month, overrides).then((r) => setEntry(r.entry)).catch((e) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, loaded]);

  // Flash rows whose estimate moved since the last poll.
  useEffect(() => {
    const moved = trueUps.filter((e) => prev.current[e.team] !== undefined && prev.current[e.team] !== e.amountUsd).map((e) => e.team);
    trueUps.forEach((e) => { prev.current[e.team] = e.amountUsd; });
    if (moved.length === 0) return;
    setFlash(new Set(moved));
    const t = setTimeout(() => setFlash(new Set()), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  async function approve() {
    if (!entry) return;
    try { setEntry(await api.approve(entry.id)); setMsg(null); } catch (e) { setMsg((e as Error).message); }
  }

  function saveEdits() {
    const next: Overrides = {};
    for (const [team, v] of Object.entries(draft ?? {})) {
      const n = Number(v.replace(/[$,]/g, ''));
      if (v.trim() !== '' && Number.isFinite(n) && n >= 0) next[team as Team] = n;
    }
    setOverrides(next);
    setDraft(null);
  }

  const approved = entry?.status === 'approved';
  const dr = entry?.lines.reduce((s, l) => s + l.debitCents, 0) ?? 0;
  const cr = entry?.lines.reduce((s, l) => s + l.creditCents, 0) ?? 0;

  return (
    <>
      <section className="panel">
        <h2>AI usage accrual — estimates by team <span className="muted">refreshes every 3s</span></h2>
        {error && <p className="error">{error}</p>}
        <table>
          <thead>
            <tr><th>Team</th><th className="num">Actual to date</th><th className="num">Estimate</th><th>Basis</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            {TEAMS.map((team) => {
              const e = trueUps.find((x) => x.team === team);
              if (!e) return null;
              const cls = [e.confidence === 'low' ? 'low' : '', flash.has(team) ? 'flash' : ''].join(' ');
              return (
                <tr key={team} className={cls}>
                  <td>{TEAM_INFO[team].label}</td>
                  <td className="num">{formatUsd(e.actualToDateUsd)}</td>
                  <td className="num">
                    {draft ? (
                      <input className="amount" placeholder={String(Math.round(e.amountUsd))} value={draft[team] ?? ''}
                        onChange={(ev) => setDraft({ ...draft, [team]: ev.target.value })} />
                    ) : (
                      <>
                        {formatUsd(overrides[team] ?? e.amountUsd)}
                        {overrides[team] !== undefined && <div className="muted">override (model {formatUsd(e.amountUsd)})</div>}
                      </>
                    )}
                  </td>
                  <td className="basis">{e.basis}</td>
                  <td><span className={`badge ${e.confidence}`}>{e.confidence}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {entry && (
        <section className="panel">
          <h2>
            Journal entry {entry.id} <span className={`badge ${entry.status}`}>{entry.status}</span>
            <span className="muted">dated {entry.date}</span>
          </h2>
          <table>
            <thead><tr><th>Account</th><th>Team</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {entry.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.account} · {ACCOUNT_NAMES[l.account]}</td>
                  <td>{l.team ? TEAM_INFO[l.team].label : '—'}</td>
                  <td className="num">{l.debitCents ? formatCents(l.debitCents) : ''}</td>
                  <td className="num">{l.creditCents ? formatCents(l.creditCents) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{dr === cr ? '✓ Balanced' : '✗ Unbalanced'}</td>
                <td className="num">{formatCents(dr)}</td>
                <td className="num">{formatCents(cr)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="actions">
            <button className="primary" disabled={approved} onClick={approve}>{approved ? 'Approved' : 'Approve'}</button>
            {draft ? (
              <>
                <button className="secondary" onClick={saveEdits}>Save edits</button>
                <button className="secondary" onClick={() => setDraft(null)}>Cancel</button>
              </>
            ) : (
              <button className="secondary" disabled={approved}
                onClick={() => setDraft(Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, String(v)])))}>Edit</button>
            )}
            <a className="button" aria-disabled={!approved} href={approved ? api.exportUrl(entry.id) : undefined}>Export CSV</a>
            <span className="muted">{EXPORT_LABEL}</span>
          </div>
          {msg && <p className="error">{msg}</p>}
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify by hand**

Run `npm run demo:reset`, then `npm run dev`, and open the Accrual review tab. Expected: four rows with Support highlighted as low confidence; a draft entry `JE-2026-10-ACCRUAL` showing ✓ Balanced; and Export disabled.
In a second terminal:
```bash
curl -s -XPOST localhost:8787/api/contexts -H 'content-type: application/json' -d '{"team":"support","month":"2026-10","replied":true,"quote":"launching Oct 27, expect about 3x","source":"form","events":[{"kind":"launch","description":"Support launch","startDate":"2026-10-27","multiplier":3}]}'
```
Expected with A's real engine: within 3 seconds the Support row flashes and moves to about $10,040, and the draft entry follows. (With A's stub the number won't move; that's fine for now.)
Click Edit, enter 7000 for Growth, then Save edits. Expected: Growth shows "override", and the entry debits $7,000.00 to Growth.
Click Approve, then Export CSV. Expected: the browser downloads `JE-2026-10-ACCRUAL.csv`.

- [ ] **Step 3: Run the typecheck and commit**

```bash
npm run typecheck
git add web/src/screens/AccrualReview.tsx
git commit -m "feat(web): accrual review with live estimates, balanced entry, approve/edit/export"
```

---

### Task 11: Slack check-in preview screen (with the fallback form)

**Files:**
- Modify: `web/src/screens/CheckinPreview.tsx` (replace the whole file)

**Interfaces:**
- Consumes: `api.contexts`, `api.checkin`, `api.postContext`, `usePoll`, `TEAMS`, `TEAM_INFO`, `DEMO`, `formatUsd`
- Produces: one card per team (lead, status, quote, events, a "Send check-in" button), plus the fallback form that posts a context with `source: 'form'` (this covers the risk-table fallback if Slack isn't ready)

- [ ] **Step 1: Write the screen**

```tsx
import { useState } from 'react';
import type { PostContextResult } from '../../../src/shared/api';
import { DEMO, TEAM_INFO, TEAMS } from '../../../src/shared/config';
import { formatUsd } from '../../../src/shared/format';
import type { Team } from '../../../src/shared/types';
import { api } from '../api';
import { usePoll } from '../usePoll';

export function CheckinPreview() {
  const month = DEMO.month;
  const { data: contexts, error, reload } = usePoll(() => api.contexts(month), 3000);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ team: 'support' as Team, quote: '', startDate: '2026-10-27', multiplier: '3' });
  const [result, setResult] = useState<PostContextResult | null>(null);

  async function send(team: Team) {
    try { await api.checkin(team); setMsg(`Check-in sent to ${TEAM_INFO[team].leadName}.`); }
    catch (e) { setMsg(`${(e as Error).message} — use the form below instead.`); }
  }

  async function submit() {
    const multiplier = Number(form.multiplier);
    const events = form.startDate && multiplier > 0 && multiplier !== 1
      ? [{ kind: 'launch' as const, description: form.quote || 'Reported change', startDate: form.startDate, multiplier }]
      : [];
    try {
      setResult(await api.postContext({ team: form.team, month, replied: true, quote: form.quote || null, events, source: 'form' }));
      setMsg(null);
      void reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <section className="panel">
        <h2>Month-end check-ins — {month}</h2>
        {error && <p className="error">{error}</p>}
        <div className="cards">
          {TEAMS.map((team) => {
            const ctx = contexts?.find((c) => c.team === team);
            const status = !ctx ? 'awaiting' : ctx.replied ? 'replied' : 'no reply';
            return (
              <div key={team} className="panel">
                <h2>
                  {TEAM_INFO[team].label} <span className="muted">{ctx?.leadName ?? TEAM_INFO[team].leadName}</span>
                  <span className={`badge ${status === 'replied' ? 'replied' : status === 'no reply' ? 'danger' : 'draft'}`}>{status}</span>
                </h2>
                {ctx?.quote ? <p>“{ctx.quote}”</p> : <p className="muted">No quote yet.</p>}
                {ctx?.events.map((ev, i) => (
                  <p key={i} className="muted">{ev.kind}: {ev.multiplier}× from {ev.startDate} — {ev.description}</p>
                ))}
                {ctx && <p className="muted">via {ctx.source} · {new Date(ctx.receivedAt).toLocaleString()}</p>}
                <div className="actions"><button className="secondary" onClick={() => send(team)}>Send Slack check-in</button></div>
              </div>
            );
          })}
        </div>
        {msg && <p className="error">{msg}</p>}
      </section>

      <section className="panel">
        <h2>Record a reply manually <span className="muted">fallback if Slack is unavailable</span></h2>
        <div className="actions">
          <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value as Team })}>
            {TEAMS.map((t) => <option key={t} value={t}>{TEAM_INFO[t].label}</option>)}
          </select>
          <input style={{ flex: 1 }} placeholder="launching Oct 27, expect about 3x" value={form.quote}
            onChange={(e) => setForm({ ...form, quote: e.target.value })} />
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <input className="amount" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} title="multiplier" />
          <button className="primary" onClick={submit}>Save reply</button>
        </div>
        {result && (
          <p>
            That moves {TEAM_INFO[result.context.team].label}'s estimate from{' '}
            <b>{result.before ? formatUsd(result.before.amountUsd) : '—'}</b> to <b>{result.after ? formatUsd(result.after.amountUsd) : '—'}</b>.
          </p>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify by hand**

Run `npm run demo:reset`, then `npm run dev`, and open the Slack check-ins tab. Expected: Support shows "awaiting", and the others reflect the seeded contexts.
Click "Send Slack check-in" on Support. Expected while D's stub is in place: an error ending "— use the form below instead."
Fill in the form (Support, "launching Oct 27, expect about 3x", 2026-10-27, 3) and click Save reply. Expected: "That moves Support's estimate from $X to $Y.", and within 3 seconds Support's card shows "replied" with the quote.

- [ ] **Step 3: Run the typecheck and commit**

```bash
npm run typecheck
git add web/src/screens/CheckinPreview.tsx
git commit -m "feat(web): Slack check-in preview with manual reply fallback"
```

---

### Task 12: Variance and audit memo screen

**Files:**
- Modify: `web/src/screens/VarianceMemo.tsx` (replace the whole file)

**Interfaces:**
- Consumes: `api.loadActuals`, `api.variances`, `api.memos`, `api.journal`, `api.editMemo`, `api.attachMemo`, `api.exportUrl`, `TEAM_INFO`, `DEMO`, `monthLabel`, `formatUsd`, `formatPct`
- Produces: a "Load actuals" action; posted reversal and actual entries with CSV links; a variance table with red rows where a memo is needed; and a memo card with its sources, Edit, and Attach to close

- [ ] **Step 1: Write the screen**

```tsx
import { useEffect, useState } from 'react';
import { DEMO, TEAM_INFO, monthLabel } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import type { JournalEntry, Memo, Variance } from '../../../src/shared/types';
import { api } from '../api';

export function VarianceMemo() {
  const month = DEMO.month;
  const [variances, setVariances] = useState<Variance[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [v, m, j] = await Promise.all([api.variances(month), api.memos(month), api.journal(month)]);
    setVariances(v); setMemos(m); setEntries(j);
  }
  useEffect(() => { refresh().catch((e) => setMsg(e.message)); }, []);

  async function loadActuals() {
    setBusy(true);
    try { await api.loadActuals(month); await refresh(); setMsg(null); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  const posted = entries.filter((e) => e.kind !== 'accrual');
  const replaceMemo = (m: Memo) => setMemos((ms) => ms.map((x) => (x.id === m.id ? m : x)));

  return (
    <>
      <section className="panel">
        <h2>{monthLabel(month)} actuals</h2>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={loadActuals}>
            {posted.length ? 'Reload actuals' : `Load ${monthLabel(month)} actuals`}
          </button>
          {posted.map((e) => (
            <span key={e.id} className="muted">
              <span className="badge posted">posted</span> {e.id} ({e.date}) · <a href={api.exportUrl(e.id)}>CSV</a>
            </span>
          ))}
        </div>
        {msg && <p className="error">{msg}</p>}
      </section>

      {variances.length > 0 && (
        <section className="panel">
          <h2>Variance by team <span className="muted">memo required when over 10% and over $500</span></h2>
          <table>
            <thead>
              <tr><th>Team</th><th className="num">Accrued</th><th className="num">Actual</th><th className="num">Variance</th><th className="num">%</th><th /></tr>
            </thead>
            <tbody>
              {variances.map((v) => (
                <tr key={v.team} className={v.needsMemo ? 'danger' : ''}>
                  <td>{TEAM_INFO[v.team].label}</td>
                  <td className="num">{formatUsd(v.estimateUsd, true)}</td>
                  <td className="num">{formatUsd(v.actualUsd, true)}</td>
                  <td className="num">{formatUsd(v.varianceUsd, true)}</td>
                  <td className="num">{formatPct(v.variancePct)}</td>
                  <td>{v.needsMemo && <span className="badge danger">memo required</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {memos.map((m) => <MemoCard key={m.id} memo={m} onChange={replaceMemo} />)}
    </>
  );
}

function MemoCard({ memo, onChange }: { memo: Memo; onChange: (m: Memo) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memo.text);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<Memo>) {
    try { onChange(await fn()); setEditing(false); setErr(null); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="panel">
      <h2>
        Audit memo — {TEAM_INFO[memo.team].label}
        <span className={`badge ${memo.status}`}>{memo.status}</span>
        <span className="badge">{memo.generatedBy === 'llm' ? 'drafted by LLM' : 'placeholder'}</span>
        {memo.editedAt && <span className="muted">edited</span>}
      </h2>
      {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} /> : <p className="memo-text">{memo.text}</p>}
      <p className="muted">Sources: {memo.sources.join(' · ')}</p>
      <div className="actions">
        {editing ? (
          <>
            <button className="primary" onClick={() => run(() => api.editMemo(memo.id, text))}>Save</button>
            <button className="secondary" onClick={() => { setText(memo.text); setEditing(false); }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="primary" disabled={memo.status === 'attached'} onClick={() => run(() => api.attachMemo(memo.id))}>
              {memo.status === 'attached' ? 'Attached to close ✓' : 'Attach to close'}
            </button>
            <button className="secondary" disabled={memo.status === 'attached'} onClick={() => setEditing(true)}>Edit memo</button>
          </>
        )}
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Verify by hand**

Open the Variance & memo tab without an approved accrual and click Load. Expected: "Approve the 2026-10 accrual before loading actuals".
Approve on the Accrual tab, come back, and click Load. Expected: two posted entries with CSV links, four variance rows with Growth shown in red as "memo required", and one Growth memo card.
Click "Edit memo", change the text, and Save. Expected: the new text shows with "edited". Then click "Attach to close". Expected: "Attached to close ✓" and the buttons disable.

- [ ] **Step 3: Run the typecheck and commit, then merge**

```bash
npm run typecheck
git add web/src/screens/VarianceMemo.tsx
git commit -m "feat(web): variance table and audit memo with edit and attach"
git checkout main && git pull && git merge --no-ff c/close-server-web && npm test && git push origin main && git checkout c/close-server-web
```

---

### Task 13: History screen (first to cut; hand to Nikhil if behind at 9:15)

**Files:**
- Modify: `web/src/screens/History.tsx` (replace the whole file)

**Interfaces:**
- Consumes: `api.history`, `usePoll` (with `ms = 0`, so it loads once), `TEAMS`, `TEAM_INFO`, `formatUsd`, `formatPct`, `monthLabel`
- Produces: a table of MAE by method with the best method highlighted, and per-team bias marked as a suggestion only

- [ ] **Step 1: Write the screen**

```tsx
import { TEAM_INFO, TEAMS, monthLabel } from '../../../src/shared/config';
import { formatPct, formatUsd } from '../../../src/shared/format';
import { api } from '../api';
import { usePoll } from '../usePoll';

const METHOD_LABEL = { lastMonth: 'Last month', runRate: 'Run-rate', trueUp: 'TrueUp' } as const;

export function History() {
  const { data, error } = usePoll(() => api.history(), 0);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading history…</p>;

  const scored = data.byMethod.filter((m) => m.n > 0);
  const best = scored.length ? scored.reduce((a, b) => (b.maePct < a.maePct ? b : a)).method : null;
  const range = data.months.length ? `${monthLabel(data.months[0])} – ${monthLabel(data.months[data.months.length - 1])}` : 'no months';

  return (
    <>
      <section className="panel">
        <h2>Estimate accuracy by method <span className="muted">{range}, as of day 25 each month</span></h2>
        <table>
          <thead><tr><th>Method</th><th className="num">Mean abs. error</th><th className="num">Mean abs. error %</th><th className="num">Team-months</th></tr></thead>
          <tbody>
            {data.byMethod.map((m) => (
              <tr key={m.method} style={m.method === best ? { fontWeight: 600 } : undefined}>
                <td>{METHOD_LABEL[m.method]} {m.method === best && <span className="badge approved">most accurate</span>}</td>
                <td className="num">{formatUsd(m.maeUsd)}</td>
                <td className="num">{(m.maePct * 100).toFixed(1)}%</td>
                <td className="num">{m.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Bias by team <span className="muted">suggestion only — never applied automatically</span></h2>
        <table>
          <thead><tr><th>Team</th><th className="num">Avg (estimate − actual) / actual</th><th>Reading</th></tr></thead>
          <tbody>
            {TEAMS.map((t) => {
              const b = data.biasByTeam[t] ?? 0;
              return (
                <tr key={t}>
                  <td>{TEAM_INFO[t].label}</td>
                  <td className="num">{formatPct(b)}</td>
                  <td className="muted">{Math.abs(b) < 0.02 ? 'well calibrated' : b > 0 ? 'tends to over-accrue' : 'tends to under-accrue'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify by hand**

Open the History tab. Expected: three method rows with Mar–Sep 2026 in the subtitle (once B's fixtures cover those months; with the stubs, n may be 0 and the values $0), plus four bias rows.

- [ ] **Step 3: Run the typecheck and commit**

```bash
npm run typecheck
git add web/src/screens/History.tsx
git commit -m "feat(web): history of error by method and per-team bias"
```

---

### Task 14: End-to-end dry run on `main` (10 PM gate)

**Files:**
- No new code. Any fixes go through superpowers:systematic-debugging and get their own commits.

- [ ] **Step 1: Merge and run the checks**

```bash
git checkout main && git pull && git merge --no-ff c/close-server-web
npm test
npm run typecheck
```
Expected: every suite passes (A's, B's and D's tests included) and typecheck exits 0.

- [ ] **Step 2: Run the demo script offline (Wi-Fi off, no `.env`)**

```bash
npm run demo:reset
npm run dev
```
Walk through it and tick off each line:
1. Accrual review shows four teams, each with a basis; Support is marked low confidence.
2. Priya's reply arrives through Slack (`npm run slack -- --checkin support`) or the fallback form on the Check-ins tab: "launching Oct 27, expect about 3x".
3. Within 3 seconds, Support moves from about $7,590 to about $10,040, the basis cites Priya, and the draft entry follows.
4. Approve. The entry is balanced. Export CSV downloads, and the label reads "ERP-ready export — this is where Hyphenate would post it."
5. On Variance & memo, load October actuals. The reversal and actual entries post, dated Nov 1, and variances appear by team.
6. Growth is red. Its memo cites the numbers and Jess's quote. Edit and Attach both work.
7. History shows TrueUp with the lowest error, plus per-team bias.
8. Run `npm run demo:reset` again and reload the page. You're back at step 1.

- [ ] **Step 3: Record what failed**

For each step that fails, write down the step number, what you saw, and which lane owns it. Fix C's issues. Post the others in team chat. Don't change `types.ts` without all four agreeing.

- [ ] **Step 4: Commit any fixes and push**

```bash
git push origin main
```
