# Countersign Milestones 0–1 (Gateway Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Countersign repo (M0 repo work) and a gateway skeleton (M1) where a worker agent can only read pages and request payments through `declare_plan` / `fetch_url` / `pay_and_fetch`, with spec invariants 1 and 2 enforced by tests.

**Architecture:** pnpm TypeScript monorepo run directly with `tsx` (no build step). The gateway is an Express HTTP server that owns the store, the payment executor and the only Anthropic key. The worker is a separate Node process started with an allowlisted environment and a `fetch` guard that only permits the gateway origin; it reaches Claude through the gateway's `/llm/messages` proxy. Payments go through an `Executor` interface; M1 ships a labelled `SimulatedExecutor`, and every payment verdict is HOLD until the decision core lands in M2 (fail closed).

**Tech Stack:** Node ≥20.12 (local: 24.11), pnpm 9.15.0, TypeScript, tsx, vitest, Express 5, zod 3.

**Spec:** `C:\Users\rohid\Downloads\Countersign_SPEC.md` (sections 3, 5, 6, 13, 15, 16, 17). Not in the repo; copy it to `docs/SPEC.md` in Task 1.

## Global Constraints

- Testnet only: `X402_NETWORK=base-sepolia`. No real money, no real third-party services.
- `fetch_url` and `pay_and_fetch` may only reach hosts we host (arena), listed in `config/allowlist.json`.
- Never commit secrets. `.env*` is gitignored except `.env.example`, which holds names only.
- Model IDs come from env vars (`JUDGE_MODEL`, `ATTACKER_MODEL`, `WORKER_MODEL`), never hardcoded.
- Invariant 1: the worker process has no wallet key, no outbound network except through the gateway.
- Invariant 2: `fetch_url` before `declare_plan` for a task is refused.
- Invariant 3: a payment with any field of origin `PAGE` or `UNKNOWN` can never be auto-approved (M1 satisfies this trivially: every payment is HOLD).
- Never weaken an invariant to make a demo pass.
- Anything simulated is labelled `simulated` in API responses, logs and README.
- No invented numbers anywhere user-facing; placeholders carry `TODO`.
- All code is written fresh in this repo; nothing copied from WalletOS.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Shell: Git Bash on Windows. Run all commands from the repo root `C:\Users\rohid\Countersign`.

## Out of scope for this plan (teammates, M0)

| Item | Owner | Report back |
|---|---|---|
| Droid-as-only-door test: with built-in web/shell off, our tools are its only way to read pages and pay | D | pass/fail + how tools were registered |
| One real x402 payment on Base Sepolia returning 200 | B | SDK package names + versions, facilitator URL, tx hash |
| Convex confirmed, `npx convex dev` deployment created | C | `CONVEX_URL` in their `.env` |

The real x402 executor plugs into the `Executor` interface from Task 4. If B's findings contradict the spec, stop and surface them.

## File Structure

```
package.json                 root scripts, dev deps, workspace deps for root tests
pnpm-workspace.yaml
tsconfig.json                one typecheck config for the whole repo
vitest.config.ts
.gitignore  .env.example
DECISIONS.md  README.md  docs/SPEC.md
config/allowlist.json        { fetchHosts: [...] } arena hosts only

packages/shared/src/
  types.ts                   spec §5 types (Task, Plan, Page, Quote, Decision, PayResult…)
  schemas.ts                 zod schemas for tool inputs
  store.ts                   Store interface (async, Convex-ready)
  memory-store.ts            MemoryStore: in-memory Store with strictly increasing clock
  simpay.ts                  HMAC-signed simulated payment header (sign/verify)
  index.ts
packages/shared/test/        memory-store.test.ts, simpay.test.ts

packages/arena/src/
  legit-vendor.ts            /docs page + /api/weather 402 endpoint
  main.ts                    dev entry (port 4101)
  index.ts
packages/arena/test/legit-vendor.test.ts

packages/gateway/src/
  executor.ts                Executor interface, parseQuote, SimulatedExecutor
  llm-proxy.ts               /llm/messages forwarder; forces WORKER_MODEL
  tools.ts                   createTask/declarePlan/fetchUrl/payAndFetch + ToolError
  server.ts                  Express routes, error → HTTP status mapping
  main.ts                    dev entry (port 4000)
  index.ts
packages/gateway/test/       executor.test.ts, llm-proxy.test.ts

packages/worker/src/         code that runs INSIDE the worker process (no deps at all)
  net-guard.ts               replaces global fetch; only gateway origin allowed
  gateway-client.ts          tool + llm calls over HTTP
  loop.ts                    Claude tool-use loop
  main.ts                    worker process entry
  index.ts
packages/worker/launch/      operator-side code (spawns the worker)
  launcher.ts                buildWorkerEnv (allowlist) + spawnWorker
  run.ts                     CLI: create task, spawn worker
packages/worker/test/
  loop.test.ts
  fixtures/probe.ts          child-process probe for INV1

tests/helpers/               listen.ts, stack.ts, child.ts
tests/invariants/            inv1-worker-isolation.test.ts, inv2-plan-first.test.ts, inv3-5.todo.test.ts
tests/m1-acceptance.test.ts
tests/m1-live.test.ts        real Claude worker; skipped without ANTHROPIC_API_KEY + WORKER_MODEL
```

---

### Task 1: Workspace scaffold, config and docs (M0 repo)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `config/allowlist.json`, `DECISIONS.md`, `README.md`, `docs/SPEC.md`
- Create: `packages/{shared,gateway,arena,worker}/package.json`, `packages/{shared,gateway,arena,worker}/src/index.ts`

**Interfaces:**
- Produces: package names `@countersign/shared`, `@countersign/gateway`, `@countersign/arena`, `@countersign/worker`; each exports `./src/index.ts` as `.`; worker also exports `./launch`.

- [ ] **Step 1: Create directories and copy the spec**

```bash
mkdir -p packages/{shared,gateway,arena,worker}/{src,test} packages/worker/launch packages/worker/test/fixtures tests/helpers tests/invariants config docs && cp "/c/Users/rohid/Downloads/Countersign_SPEC.md" docs/SPEC.md
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "countersign",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=20.12" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json",
    "dev:arena": "tsx packages/arena/src/main.ts",
    "dev:gateway": "tsx packages/gateway/src/main.ts",
    "worker": "tsx packages/worker/launch/run.ts"
  },
  "devDependencies": {
    "@countersign/arena": "workspace:*",
    "@countersign/gateway": "workspace:*",
    "@countersign/shared": "workspace:*",
    "@countersign/worker": "workspace:*"
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 4: Write the four package manifests and index stubs**

`packages/shared/package.json`:
```json
{ "name": "@countersign/shared", "version": "0.0.0", "private": true, "type": "module", "exports": { ".": "./src/index.ts" } }
```
`packages/gateway/package.json`:
```json
{ "name": "@countersign/gateway", "version": "0.0.0", "private": true, "type": "module", "exports": { ".": "./src/index.ts" }, "dependencies": { "@countersign/shared": "workspace:*" } }
```
`packages/arena/package.json`:
```json
{ "name": "@countersign/arena", "version": "0.0.0", "private": true, "type": "module", "exports": { ".": "./src/index.ts" }, "dependencies": { "@countersign/shared": "workspace:*" } }
```
`packages/worker/package.json` (no dependencies, ever; INV1 test checks this):
```json
{ "name": "@countersign/worker", "version": "0.0.0", "private": true, "type": "module", "exports": { ".": "./src/index.ts", "./launch": "./launch/launcher.ts" } }
```
Each `packages/*/src/index.ts`:
```ts
export {};
```

- [ ] **Step 5: Install dependencies**

```bash
pnpm add -Dw typescript tsx vitest @types/node @types/express
```
```bash
pnpm add --filter @countersign/shared zod@^3.23.8
```
```bash
pnpm add --filter @countersign/gateway express zod@^3.23.8
```
```bash
pnpm add --filter @countersign/arena express
```
Expected: each ends with `Done in …`. If Express resolves to 4.x instead of 5.x, keep it; the code below works on both.

- [ ] **Step 6: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["packages/*/src/**/*.ts", "packages/*/launch/**/*.ts", "packages/*/test/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 7: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 20_000,
    passWithNoTests: true,
  },
});
```

- [ ] **Step 8: Write `.gitignore`**

```
node_modules/
.env
.env.*
!.env.example
*.log
coverage/
.convex/
.next/
```

- [ ] **Step 9: Write `.env.example`**

```
# Names only. Copy to .env and fill in locally. Never commit .env.
ANTHROPIC_API_KEY=
JUDGE_MODEL=
ATTACKER_MODEL=
WORKER_MODEL=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
X402_NETWORK=base-sepolia
CRS_USERNAME=
CRS_PASSWORD=
CONVEX_URL=
# Simulated executor <-> arena shared secret. Any random string. Gateway and arena only, never the worker.
SIM_PAYER_SECRET=
EXECUTOR=simulated
GATEWAY_PORT=4000
ARENA_PORT=4101
GATEWAY_URL=http://localhost:4000
```

- [ ] **Step 10: Write `config/allowlist.json`**

```json
{ "fetchHosts": ["localhost:4101", "127.0.0.1:4101"] }
```

- [ ] **Step 11: Write `DECISIONS.md`**

```markdown
# Decisions

Running log. Newest at the bottom. Format: ID, date, decision, why.

- **D1 (2026-10-24) QUOTE is an origin for amount only.** Payee, tier, quantity and category are the agent's choices and must trace to TASK or PLAN, else PAGE/UNKNOWN. Why: a vendor quote echoes whatever tier the agent asked for, so trusting it for tier lets the premium-upsell attack through.
- **D2 (2026-10-24) `plan.expected[].tiers?: string[]`.** Why: without it a legitimate "basic" purchase traces to UNKNOWN and is held.
- **D3 (2026-10-24) Category comes from `config/catalog.json` keyed by endpoint URL**, compared to `plan.category`. Unknown URL = UNKNOWN. The agent's `purpose` text is UI only. Lands in M2.
- **D4 (2026-10-24) Checks set floors; final verdict = max severity.** Tainted field → hold; amount ≠ quote → block; quantity > maxQuantity → hold; payee not in plan/allowlist → hold; duplicate → block or reuse. Nothing can lower a verdict.
- **D5 (2026-10-24) `Store` interface with `MemoryStore` for M1 and tests.** Convex adapter behind the same interface in M2/M3.
- **D6 (2026-10-24) M1 fails closed.** Until the decision core exists, every `pay_and_fetch` is HOLD and the executor's `pay` is never called.
- **D7 (2026-10-24) The worker reaches Claude only via the gateway's `/llm/messages`.** The gateway holds `ANTHROPIC_API_KEY` and forces `WORKER_MODEL` (new env var, not in spec §16). Why: invariant 1 says no outbound network except the gateway.
- **D8 (2026-10-24) Worker isolation is process-level, not OS-level:** allowlisted env, a global `fetch` guard, and a static check that worker code imports no network/wallet modules. README states this limit.
- **D9 (2026-10-24) `fetch_url` and `pay_and_fetch` only reach hosts in `config/allowlist.json`** (our arena). Enforces the "only target what we host" rule and blocks SSRF.
- **D10 (2026-10-24) `SimulatedExecutor` pays with an HMAC-signed `x-sim-payment` header**, not the x402 wire format. The arena's 402 body mimics x402's `accepts` shape so the real executor is a drop-in. Labelled `simulated` everywhere.
- **D11 (2026-10-24) Added `packages/worker`** (not in spec §15): `src/` runs inside the worker process and has zero dependencies; `launch/` is operator-side.
- **D12 (2026-10-24) Tooling:** pnpm 9.15.0 installed with `npm i -g` because `corepack enable` needs admin on this machine. Express 5, zod 3.
- **D13 (2026-10-24) `/admin/tasks` is unauthenticated.** Production auth is a spec non-goal.
```

- [ ] **Step 12: Write `README.md`**

```markdown
# Countersign

Spending authority that grows as AI agents earn it.

> Fraud tools decide what to stop. Countersign decides how much freedom to give, and grows it as agents earn it.

Countersign is the only door between a worker AI agent and its money. The agent's only tools are `declare_plan`, `fetch_url` and `pay_and_fetch`, all served by the Countersign gateway, which also holds the wallet key.

## Status

| Milestone | State |
|---|---|
| M0 repo + decisions | in progress |
| M1 gateway skeleton | in progress |
| M2–M7 | not started |

## Run it

```bash
pnpm install
cp .env.example .env   # fill SIM_PAYER_SECRET; ANTHROPIC_API_KEY + WORKER_MODEL for the live worker
pnpm test
pnpm dev:arena         # terminal 1
pnpm dev:gateway       # terminal 2
pnpm worker            # terminal 3, needs ANTHROPIC_API_KEY + WORKER_MODEL in .env
```

## Real vs simulated

**Real today:** gateway, plan-first enforcement, page and quote storage, worker isolation checks, Claude worker loop (when a key is set).

**Simulated today:**
- Payments: `SimulatedExecutor` (HMAC-signed header, no chain). Every response says `simulated: true`. Real x402 on Base Sepolia: TODO (B, M0).
- Vendors and pages: the arena, which we host.
- Every payment is currently HOLD: the decision core is M2.

**Limits:** worker isolation is enforced at the process level (env allowlist, `fetch` guard, import check), not by an OS sandbox.

## Benchmark

TODO: filled only from real runs (M6). No numbers until then.

## Decisions

See [DECISIONS.md](DECISIONS.md).
```

- [ ] **Step 13: Verify the scaffold**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0 with no output; vitest prints `No test files found, exiting with code 0`.

- [ ] **Step 14: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: scaffold pnpm workspace, config, decisions and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
Before committing, run `git status --short` and confirm no `.env` file is staged.

---

### Task 2: Shared types, schemas, store and simulated-payment signing

**Files:**
- Create: `packages/shared/src/types.ts`, `schemas.ts`, `store.ts`, `memory-store.ts`, `simpay.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/memory-store.test.ts`, `packages/shared/test/simpay.test.ts`

**Interfaces:**
- Produces:
  - Types: `Origin`, `Verdict`, `PaymentField`, `Task`, `PlanItem`, `Plan`, `Page`, `Quote`, `PaymentRequest`, `PayResult`, `Decision`
  - Schemas: `CreateTaskSchema`, `PlanInputSchema`, `DeclarePlanSchema`, `FetchUrlSchema`, `PaymentRequestSchema`, `PayAndFetchSchema`
  - `interface Store { now(): number; putTask(t: Task): Promise<void>; getTask(id: string): Promise<Task | undefined>; insertPlan(p: Plan): Promise<boolean>; getPlan(taskId: string): Promise<Plan | undefined>; putPage(p: Page): Promise<void>; listPages(taskId: string): Promise<Page[]>; putQuote(q: Quote): Promise<void>; listQuotes(taskId: string): Promise<Quote[]>; putDecision(d: Decision): Promise<void>; getDecision(id: string): Promise<Decision | undefined> }`
  - `class MemoryStore implements Store`
  - `SIM_PAYMENT_HEADER = "x-sim-payment"`, `interface SimPayment { idempotencyKey: string; resource: string; amountAtomic: string; sig: string }`, `signSimPayment(secret: string, p: Omit<SimPayment, "sig">): string`, `verifySimPayment(secret: string, header: string | undefined): SimPayment | null`, `usdToAtomic(usd: number): string`

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/memory-store.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MemoryStore, type Plan } from "@countersign/shared";

const plan = (taskId: string, goal = "g"): Plan => ({
  taskId,
  goal,
  expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 2, vendorDomains: ["v"], tiers: ["basic"] }],
  declaredAt: 1,
});

describe("MemoryStore", () => {
  it("clock is strictly increasing even within one millisecond", () => {
    const s = new MemoryStore();
    const ts = Array.from({ length: 50 }, () => s.now());
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
  });

  it("insertPlan succeeds once per task and never overwrites", async () => {
    const s = new MemoryStore();
    expect(await s.insertPlan(plan("t1", "first"))).toBe(true);
    expect(await s.insertPlan(plan("t1", "second"))).toBe(false);
    expect((await s.getPlan("t1"))!.goal).toBe("first");
  });

  it("returns copies, so callers cannot mutate stored records", async () => {
    const s = new MemoryStore();
    await s.insertPlan(plan("t1"));
    (await s.getPlan("t1"))!.goal = "mutated";
    expect((await s.getPlan("t1"))!.goal).toBe("g");
  });

  it("lists pages and quotes per task", async () => {
    const s = new MemoryStore();
    await s.putPage({ pageId: "p1", taskId: "a", url: "u", lines: ["x"], fetchedAt: 1 });
    await s.putPage({ pageId: "p2", taskId: "b", url: "u", lines: ["y"], fetchedAt: 2 });
    expect((await s.listPages("a")).map((p) => p.pageId)).toEqual(["p1"]);
    expect(await s.listQuotes("a")).toEqual([]);
  });
});
```

`packages/shared/test/simpay.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { signSimPayment, usdToAtomic, verifySimPayment } from "@countersign/shared";

const p = { idempotencyKey: "k1", resource: "/api/weather?tier=basic", amountAtomic: "100000" };

describe("simulated payment header", () => {
  it("round-trips with the right secret", () => {
    expect(verifySimPayment("s", signSimPayment("s", p))).toMatchObject(p);
  });

  it("rejects the wrong secret", () => {
    expect(verifySimPayment("other", signSimPayment("s", p))).toBeNull();
  });

  it("rejects a tampered amount", () => {
    const decoded = JSON.parse(Buffer.from(signSimPayment("s", p), "base64").toString("utf8"));
    decoded.amountAtomic = "15000000";
    expect(verifySimPayment("s", Buffer.from(JSON.stringify(decoded)).toString("base64"))).toBeNull();
  });

  it("rejects missing or garbage headers", () => {
    expect(verifySimPayment("s", undefined)).toBeNull();
    expect(verifySimPayment("s", "not-base64-json")).toBeNull();
  });

  it("converts USD to 6-decimal USDC atomic units", () => {
    expect(usdToAtomic(0.1)).toBe("100000");
    expect(usdToAtomic(15)).toBe("15000000");
    expect(usdToAtomic(0.4)).toBe("400000");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/shared`
Expected: FAIL, `MemoryStore is not a constructor` / `signSimPayment is not a function` (index.ts is still `export {}`).

- [ ] **Step 3: Write `packages/shared/src/types.ts`**

```ts
export type Origin = "TASK" | "PLAN" | "QUOTE" | "PAGE" | "UNKNOWN";
export type Verdict = "approve" | "hold" | "block";
export type PaymentField = "payee" | "amount" | "tier" | "quantity" | "category";

export interface Task {
  taskId: string;
  text: string;
  budgetUsd: number;
  taskType: string;
  createdAt: number;
}

export interface PlanItem {
  category: string;
  maxUnitUsd: number;
  maxQuantity: number;
  vendorDomains: string[];
  tiers?: string[]; // DECISIONS D2
}

/** Immutable once inserted. declaredAt precedes every page fetch for the task. */
export interface Plan {
  taskId: string;
  goal: string;
  expected: PlanItem[];
  declaredAt: number;
}

/** Line-indexed so the trace view can point at "page line N". */
export interface Page {
  pageId: string;
  taskId: string;
  url: string;
  lines: string[];
  fetchedAt: number;
}

/** Built from the vendor's 402 payment-required response. */
export interface Quote {
  quoteId: string;
  taskId: string;
  payeeDomain: string;
  amountUsd: number;
  tier: string | null;
  unit: string;
  rawRequirements: unknown;
  receivedAt: number;
}

export interface PaymentRequest {
  url: string;
  payeeDomain: string;
  amountUsd: number;
  tier?: string;
  quantity?: number;
  purpose: string; // agent free text: UI only, never evidence
}

export interface PayResult {
  status: "approved" | "held" | "blocked";
  reason: string;
  data?: unknown;
  decisionId: string;
}

export interface Decision {
  decisionId: string;
  paymentRequestId: string;
  taskId: string;
  tier: 1 | 2 | null; // null = no tier ran (M1 fail-closed)
  verdict: Verdict;
  ruleId?: string;
  fieldOrigins: Partial<Record<PaymentField, Origin>>;
  reasons: string[];
  latencyMs: number;
  costUsd: number;
  createdAt: number;
}
```

- [ ] **Step 4: Write `packages/shared/src/schemas.ts`**

```ts
import { z } from "zod";

export const PlanItemSchema = z.object({
  category: z.string().min(1),
  maxUnitUsd: z.number().positive(),
  maxQuantity: z.number().int().positive(),
  vendorDomains: z.array(z.string().min(1)).min(1),
  tiers: z.array(z.string().min(1)).optional(),
});

export const PlanInputSchema = z.object({
  goal: z.string().min(1),
  expected: z.array(PlanItemSchema).min(1),
});

export const CreateTaskSchema = z.object({
  text: z.string().min(1),
  budgetUsd: z.number().positive(),
  taskType: z.string().min(1),
});

export const DeclarePlanSchema = z.object({ taskId: z.string().min(1), plan: PlanInputSchema });

export const FetchUrlSchema = z.object({ taskId: z.string().min(1), url: z.string().url() });

export const PaymentRequestSchema = z.object({
  url: z.string().url(),
  payeeDomain: z.string().min(1),
  amountUsd: z.number().nonnegative(),
  tier: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  purpose: z.string(),
});

export const PayAndFetchSchema = z.object({ taskId: z.string().min(1), req: PaymentRequestSchema });

export type PlanInput = z.infer<typeof PlanInputSchema>;
```

- [ ] **Step 5: Write `packages/shared/src/store.ts`**

```ts
import type { Decision, Page, Plan, Quote, Task } from "./types";

/** Persistence boundary. MemoryStore now; a Convex adapter implements the same interface later (D5). */
export interface Store {
  /** Strictly increasing timestamp source, so ordering checks (plan before page) are reliable. */
  now(): number;
  putTask(task: Task): Promise<void>;
  getTask(taskId: string): Promise<Task | undefined>;
  /** Atomic insert-if-absent. Returns false if the task already has a plan. */
  insertPlan(plan: Plan): Promise<boolean>;
  getPlan(taskId: string): Promise<Plan | undefined>;
  putPage(page: Page): Promise<void>;
  listPages(taskId: string): Promise<Page[]>;
  putQuote(quote: Quote): Promise<void>;
  listQuotes(taskId: string): Promise<Quote[]>;
  putDecision(decision: Decision): Promise<void>;
  getDecision(decisionId: string): Promise<Decision | undefined>;
}
```

- [ ] **Step 6: Write `packages/shared/src/memory-store.ts`**

```ts
import type { Store } from "./store";
import type { Decision, Page, Plan, Quote, Task } from "./types";

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  private last = 0;
  private tasks = new Map<string, Task>();
  private plans = new Map<string, Plan>();
  private pages: Page[] = [];
  private quotes: Quote[] = [];
  private decisions = new Map<string, Decision>();

  now(): number {
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  async putTask(task: Task) { this.tasks.set(task.taskId, copy(task)); }
  async getTask(taskId: string) { const t = this.tasks.get(taskId); return t && copy(t); }

  async insertPlan(plan: Plan) {
    if (this.plans.has(plan.taskId)) return false;
    this.plans.set(plan.taskId, copy(plan));
    return true;
  }
  async getPlan(taskId: string) { const p = this.plans.get(taskId); return p && copy(p); }

  async putPage(page: Page) { this.pages.push(copy(page)); }
  async listPages(taskId: string) { return this.pages.filter((p) => p.taskId === taskId).map(copy); }

  async putQuote(quote: Quote) { this.quotes.push(copy(quote)); }
  async listQuotes(taskId: string) { return this.quotes.filter((q) => q.taskId === taskId).map(copy); }

  async putDecision(decision: Decision) { this.decisions.set(decision.decisionId, copy(decision)); }
  async getDecision(decisionId: string) { const d = this.decisions.get(decisionId); return d && copy(d); }
}
```

- [ ] **Step 7: Write `packages/shared/src/simpay.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** SIMULATED payment proof (D10). Not x402. Only the gateway and the arena know the secret. */
export const SIM_PAYMENT_HEADER = "x-sim-payment";

export interface SimPayment {
  idempotencyKey: string;
  resource: string;
  amountAtomic: string;
  sig: string;
}

export function usdToAtomic(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}

function mac(secret: string, p: Omit<SimPayment, "sig">): string {
  return createHmac("sha256", secret).update(`${p.idempotencyKey}|${p.resource}|${p.amountAtomic}`).digest("hex");
}

export function signSimPayment(secret: string, p: Omit<SimPayment, "sig">): string {
  const body: SimPayment = { ...p, sig: mac(secret, p) };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

export function verifySimPayment(secret: string, header: string | undefined): SimPayment | null {
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as SimPayment;
    if (![p.idempotencyKey, p.resource, p.amountAtomic, p.sig].every((v) => typeof v === "string")) return null;
    const expected = Buffer.from(mac(secret, p), "hex");
    const got = Buffer.from(p.sig, "hex");
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
    return p;
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Write `packages/shared/src/index.ts`**

```ts
export * from "./types";
export * from "./schemas";
export * from "./store";
export * from "./memory-store";
export * from "./simpay";
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run packages/shared && pnpm typecheck`
Expected: 9 tests pass; typecheck exits 0.

- [ ] **Step 10: Commit**

```bash
git add packages/shared && git commit -m "$(cat <<'EOF'
feat(shared): spec types, tool schemas, Store interface, MemoryStore, simulated payment signing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Arena legit vendor

**Files:**
- Create: `packages/arena/src/legit-vendor.ts`, `packages/arena/src/main.ts`, `tests/helpers/listen.ts`
- Modify: `packages/arena/src/index.ts`
- Test: `packages/arena/test/legit-vendor.test.ts`

**Interfaces:**
- Consumes: `SIM_PAYMENT_HEADER`, `signSimPayment`, `verifySimPayment`, `usdToAtomic` from Task 2.
- Produces: `createLegitVendor(opts: { simPayerSecret: string; payTo?: string }): Express`, `LEGIT_VENDOR_PRICES_USD: Record<string, number>`, `LEGIT_VENDOR_DOCS: string`. Routes: `GET /docs` (text), `GET /api/weather?tier=&city=` (402 with `{ x402Version, simulated, accepts: [{ maxAmountRequired, resource, extra: { tier, unit } … }] }` or 200 `{ simulated: true, city, tier, tempC, conditions }`).
- Produces: `listen(app: Express): Promise<{ url: string; host: string; close(): Promise<void> }>` in `tests/helpers/listen.ts`.

- [ ] **Step 1: Write `tests/helpers/listen.ts`**

```ts
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

export interface Listening {
  url: string;
  host: string;
  close(): Promise<void>;
}

/** Listen on an ephemeral port on 127.0.0.1. */
export function listen(app: Express): Promise<Listening> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
    server.on("error", reject);
  });
}
```

- [ ] **Step 2: Write the failing test**

`packages/arena/test/legit-vendor.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";
import { listen, type Listening } from "../../../tests/helpers/listen";

const SECRET = "arena-test-secret";
let arena: Listening;
beforeAll(async () => { arena = await listen(createLegitVendor({ simPayerSecret: SECRET })); });
afterAll(() => arena.close());

describe("legit vendor", () => {
  it("serves a docs page that advertises the basic tier", async () => {
    const text = await (await fetch(`${arena.url}/docs`)).text();
    expect(text.split("\n")[1]).toContain("Basic tier: $0.10");
  });

  it("answers an unpaid call with a 402 quote in x402 accepts shape", async () => {
    const res = await fetch(`${arena.url}/api/weather?tier=basic&city=Berkeley`);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.simulated).toBe(true);
    expect(body.accepts[0]).toMatchObject({
      network: "base-sepolia",
      maxAmountRequired: "100000",
      resource: "/api/weather?tier=basic&city=Berkeley",
      extra: { tier: "basic", unit: "call" },
    });
  });

  it("quotes premium at $15", async () => {
    const body = await (await fetch(`${arena.url}/api/weather?tier=premium`)).json();
    expect(body.accepts[0].maxAmountRequired).toBe("15000000");
  });

  it("returns data for a correctly signed payment", async () => {
    const resource = "/api/weather?tier=basic&city=Berkeley";
    const header = signSimPayment(SECRET, { idempotencyKey: "k", resource, amountAtomic: "100000" });
    const res = await fetch(`${arena.url}${resource}`, { headers: { [SIM_PAYMENT_HEADER]: header } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ simulated: true, tier: "basic", city: "Berkeley" });
  });

  it("rejects a valid signature for the wrong amount", async () => {
    const resource = "/api/weather?tier=premium";
    const header = signSimPayment(SECRET, { idempotencyKey: "k", resource, amountAtomic: "100000" });
    const res = await fetch(`${arena.url}${resource}`, { headers: { [SIM_PAYMENT_HEADER]: header } });
    expect(res.status).toBe(402);
  });

  it("404s an unknown tier", async () => {
    expect((await fetch(`${arena.url}/api/weather?tier=gold`)).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/arena`
Expected: FAIL, `createLegitVendor is not a function`.

- [ ] **Step 4: Write `packages/arena/src/legit-vendor.ts`**

```ts
import express, { type Express } from "express";
import { SIM_PAYMENT_HEADER, usdToAtomic, verifySimPayment } from "@countersign/shared";

export const LEGIT_VENDOR_PRICES_USD: Record<string, number> = { basic: 0.1, premium: 15 };

export const LEGIT_VENDOR_DOCS = [
  "WeatherCo Data API",
  "Basic tier: $0.10 per call. Current conditions for one city.",
  "Endpoint: GET /api/weather?tier=basic&city=<name>",
  "Payment: HTTP 402, pay per call.",
].join("\n");

/** SIMULATED vendor we host (arena). Never a real service. */
export function createLegitVendor(opts: { simPayerSecret: string; payTo?: string }): Express {
  const app = express();

  app.get("/docs", (_req, res) => {
    res.type("text/plain").send(LEGIT_VENDOR_DOCS);
  });

  app.get("/api/weather", (req, res) => {
    const tier = typeof req.query.tier === "string" ? req.query.tier : "basic";
    const price = LEGIT_VENDOR_PRICES_USD[tier];
    if (price === undefined) {
      res.status(404).json({ error: "unknown tier" });
      return;
    }
    const resource = req.originalUrl;
    const amountAtomic = usdToAtomic(price);
    const payment = verifySimPayment(opts.simPayerSecret, req.header(SIM_PAYMENT_HEADER));
    if (!payment || payment.resource !== resource || payment.amountAtomic !== amountAtomic) {
      res.status(402).json({
        x402Version: 1,
        simulated: true,
        error: payment ? "payment does not match quote" : "payment required",
        accepts: [
          {
            scheme: "exact",
            network: "base-sepolia",
            maxAmountRequired: amountAtomic,
            resource,
            payTo: opts.payTo ?? "0x000000000000000000000000000000000000dEaD",
            asset: "USDC",
            description: `WeatherCo ${tier} call`,
            extra: { tier, unit: "call" },
          },
        ],
      });
      return;
    }
    const city = typeof req.query.city === "string" ? req.query.city : "Berkeley";
    res.json({ simulated: true, city, tier, tempC: 18, conditions: "fog" });
  });

  return app;
}
```

- [ ] **Step 5: Write `packages/arena/src/index.ts` and `main.ts`**

`packages/arena/src/index.ts`:
```ts
export * from "./legit-vendor";
```
`packages/arena/src/main.ts`:
```ts
import { createLegitVendor } from "./legit-vendor";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }

const secret = process.env.SIM_PAYER_SECRET;
if (!secret) throw new Error("SIM_PAYER_SECRET is required (see .env.example)");
const port = Number(process.env.ARENA_PORT ?? 4101);

createLegitVendor({ simPayerSecret: secret }).listen(port, () => {
  console.log(`[arena] legit-vendor (SIMULATED) on http://localhost:${port}`);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run packages/arena && pnpm typecheck`
Expected: 6 tests pass; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/arena tests/helpers/listen.ts && git commit -m "$(cat <<'EOF'
feat(arena): simulated legit vendor with docs page and 402 weather endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Executor interface and SimulatedExecutor

**Files:**
- Create: `packages/gateway/src/executor.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/executor.test.ts`

**Interfaces:**
- Consumes: `signSimPayment`, `SIM_PAYMENT_HEADER` (Task 2); `createLegitVendor` (Task 3); `listen` (Task 3).
- Produces:
  - `interface QuoteInfo { payeeDomain: string; amountUsd: number; amountAtomic: string; tier: string | null; unit: string; resource: string; raw: unknown }`
  - `interface PayOutcome { status: "settled" | "failed"; httpStatus: number; data?: unknown; txRef: string | null; simulated: boolean }`
  - `interface Executor { readonly kind: "simulated" | "x402"; getQuote(url: string): Promise<QuoteInfo>; pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome> }`
  - `class QuoteError extends Error`, `parseQuote(url: string, status: number, body: unknown): QuoteInfo`
  - `class SimulatedExecutor implements Executor` with `constructor(secret: string, fetchImpl?: typeof fetch)`

- [ ] **Step 1: Write the failing test**

`packages/gateway/test/executor.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import { QuoteError, SimulatedExecutor, parseQuote } from "@countersign/gateway";
import { listen, type Listening } from "../../../tests/helpers/listen";

describe("parseQuote", () => {
  it("throws when the response is not a 402", () => {
    expect(() => parseQuote("http://v.test/x", 200, {})).toThrow(QuoteError);
  });

  it("throws when the 402 has no payment requirements", () => {
    expect(() => parseQuote("http://v.test/x", 402, { accepts: [] })).toThrow(QuoteError);
  });

  it("extracts payee host, USD amount, tier and resource", () => {
    const q = parseQuote("http://Vendor.test:4101/api/weather?tier=basic", 402, {
      accepts: [{ maxAmountRequired: "100000", resource: "/api/weather?tier=basic", extra: { tier: "basic", unit: "call" } }],
    });
    expect(q).toMatchObject({ payeeDomain: "vendor.test:4101", amountUsd: 0.1, amountAtomic: "100000", tier: "basic", unit: "call", resource: "/api/weather?tier=basic" });
  });
});

describe("SimulatedExecutor against the arena", () => {
  const SECRET = "exec-test-secret";
  let arena: Listening;
  beforeAll(async () => { arena = await listen(createLegitVendor({ simPayerSecret: SECRET })); });
  afterAll(() => arena.close());

  it("quotes then pays, and labels the result simulated", async () => {
    const url = `${arena.url}/api/weather?tier=basic&city=Oakland`;
    const exec = new SimulatedExecutor(SECRET);
    const quote = await exec.getQuote(url);
    expect(quote.amountUsd).toBe(0.1);
    const out = await exec.pay(url, quote, "idem-0001-abcdef-xyz");
    expect(out).toMatchObject({ status: "settled", httpStatus: 200, simulated: true, txRef: "sim-idem-0001-abcdef" });
    expect(out.data).toMatchObject({ city: "Oakland", tier: "basic", simulated: true });
  });

  it("fails when the executor's secret is wrong", async () => {
    const url = `${arena.url}/api/weather?tier=basic`;
    const exec = new SimulatedExecutor("wrong-secret");
    const out = await exec.pay(url, await exec.getQuote(url), "idem-2");
    expect(out).toMatchObject({ status: "failed", httpStatus: 402, txRef: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/gateway/test/executor.test.ts`
Expected: FAIL, `parseQuote is not a function` / `QuoteError` undefined.

- [ ] **Step 3: Write `packages/gateway/src/executor.ts`**

```ts
import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";

export interface QuoteInfo {
  payeeDomain: string;
  amountUsd: number;
  amountAtomic: string;
  tier: string | null;
  unit: string;
  resource: string;
  raw: unknown;
}

export interface PayOutcome {
  status: "settled" | "failed";
  httpStatus: number;
  data?: unknown;
  txRef: string | null;
  simulated: boolean;
}

/** The only component that can move money. Lives in the gateway process. */
export interface Executor {
  readonly kind: "simulated" | "x402";
  getQuote(url: string): Promise<QuoteInfo>;
  pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome>;
}

export class QuoteError extends Error {}

/** Reads an x402-shaped 402 body: { accepts: [{ maxAmountRequired, resource, extra: { tier, unit } }] }. */
export function parseQuote(url: string, status: number, body: unknown): QuoteInfo {
  if (status !== 402) throw new QuoteError(`expected 402 from ${url}, got ${status}`);
  const req = (body as { accepts?: Array<Record<string, any>> } | null)?.accepts?.[0];
  if (!req || typeof req.maxAmountRequired !== "string") {
    throw new QuoteError(`no payment requirements in 402 from ${url}`);
  }
  return {
    payeeDomain: new URL(url).host.toLowerCase(),
    amountUsd: Number(req.maxAmountRequired) / 1_000_000,
    amountAtomic: req.maxAmountRequired,
    tier: typeof req.extra?.tier === "string" ? req.extra.tier : null,
    unit: typeof req.extra?.unit === "string" ? req.extra.unit : "call",
    resource: typeof req.resource === "string" ? req.resource : new URL(url).pathname + new URL(url).search,
    raw: body,
  };
}

/** SIMULATED (D10): signs an HMAC header the arena verifies. No chain, no x402 wire format. */
export class SimulatedExecutor implements Executor {
  readonly kind = "simulated" as const;

  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async getQuote(url: string): Promise<QuoteInfo> {
    const res = await this.fetchImpl(url);
    const body = await res.json().catch(() => null);
    return parseQuote(url, res.status, body);
  }

  async pay(url: string, quote: QuoteInfo, idempotencyKey: string): Promise<PayOutcome> {
    const header = signSimPayment(this.secret, {
      idempotencyKey,
      resource: quote.resource,
      amountAtomic: quote.amountAtomic,
    });
    const res = await this.fetchImpl(url, { headers: { [SIM_PAYMENT_HEADER]: header } });
    const data = await res.json().catch(() => null);
    return {
      status: res.ok ? "settled" : "failed",
      httpStatus: res.status,
      data,
      txRef: res.ok ? `sim-${idempotencyKey.slice(0, 16)}` : null,
      simulated: true,
    };
  }
}
```

- [ ] **Step 4: Write `packages/gateway/src/index.ts`**

```ts
export * from "./executor";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/gateway/test/executor.test.ts && pnpm typecheck`
Expected: 5 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway && git commit -m "$(cat <<'EOF'
feat(gateway): Executor interface and labelled SimulatedExecutor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: LLM proxy (worker reaches Claude only through the gateway)

**Files:**
- Create: `packages/gateway/src/llm-proxy.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/test/llm-proxy.test.ts`

**Interfaces:**
- Produces: `type LlmProxy = (body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>`, `createLlmProxy(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): LlmProxy`, `ANTHROPIC_MESSAGES_URL`.

- [ ] **Step 1: Write the failing test**

`packages/gateway/test/llm-proxy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ANTHROPIC_MESSAGES_URL, createLlmProxy } from "@countersign/gateway";

function fakeFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ content: [], stop_reason: "end_turn" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("LLM proxy", () => {
  it("forwards to Anthropic with the gateway's key", async () => {
    const f = fakeFetch();
    const proxy = createLlmProxy({ apiKey: "sk-test", model: "model-from-env", fetchImpl: f.impl });
    const out = await proxy({ max_tokens: 10, messages: [] });
    expect(out.status).toBe(200);
    expect(f.calls[0].url).toBe(ANTHROPIC_MESSAGES_URL);
    expect((f.calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
  });

  it("forces the env model, ignoring any model the worker asks for", async () => {
    const f = fakeFetch();
    const proxy = createLlmProxy({ apiKey: "k", model: "model-from-env", fetchImpl: f.impl });
    await proxy({ model: "worker-chosen", max_tokens: 10, messages: [] });
    expect(JSON.parse(f.calls[0].init.body as string).model).toBe("model-from-env");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/gateway/test/llm-proxy.test.ts`
Expected: FAIL, `createLlmProxy is not a function`.

- [ ] **Step 3: Write `packages/gateway/src/llm-proxy.ts`**

```ts
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type LlmProxy = (body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;

/** D7: the worker has no API key and no network; it calls this through the gateway. Model comes from env only. */
export function createLlmProxy(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): LlmProxy {
  const doFetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  return async (body) => {
    const res = await doFetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...body, model: opts.model }),
    });
    return { status: res.status, json: await res.json() };
  };
}
```

- [ ] **Step 4: Export it**

`packages/gateway/src/index.ts`:
```ts
export * from "./executor";
export * from "./llm-proxy";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/gateway && pnpm typecheck`
Expected: 7 tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway && git commit -m "$(cat <<'EOF'
feat(gateway): LLM proxy so the worker holds no API key; model forced from env

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Gateway tools + HTTP server, driven by INV2 tests

**Files:**
- Create: `packages/gateway/src/tools.ts`, `packages/gateway/src/server.ts`, `packages/gateway/src/main.ts`, `tests/helpers/stack.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `tests/invariants/inv2-plan-first.test.ts`

**Interfaces:**
- Consumes: `Store`, `MemoryStore`, schemas, `Decision`, `PayResult`, `Task` (Task 2); `Executor`, `SimulatedExecutor` (Task 4); `LlmProxy`, `createLlmProxy` (Task 5); `createLegitVendor` (Task 3); `listen` (Task 3).
- Produces:
  - `type ToolErrorCode = "BAD_INPUT" | "TASK_NOT_FOUND" | "PLAN_REQUIRED" | "PLAN_EXISTS" | "HOST_NOT_ALLOWED" | "UPSTREAM_FAILED"`, `class ToolError extends Error { code: ToolErrorCode }`
  - `interface GatewayDeps { store: Store; executor: Executor; fetchHosts: string[]; fetchPage?: (url: string) => Promise<string> }`
  - `createTools(deps: GatewayDeps): { createTask(input: unknown): Promise<Task>; declarePlan(input: unknown): Promise<{ ok: true }>; fetchUrl(input: unknown): Promise<{ pageId: string; text: string }>; payAndFetch(input: unknown): Promise<PayResult> }`, `type Tools = ReturnType<typeof createTools>`, `M1_HOLD_REASON: string`
  - `createGatewayApp(tools: Tools, llm?: LlmProxy): Express`. Routes: `GET /health`, `POST /admin/tasks`, `POST /tools/declare_plan`, `POST /tools/fetch_url`, `POST /tools/pay_and_fetch`, `POST /llm/messages`. Errors: `{ error: { code, message } }` with status BAD_INPUT 400, HOST_NOT_ALLOWED 403, TASK_NOT_FOUND 404, PLAN_REQUIRED 409, PLAN_EXISTS 409, UPSTREAM_FAILED 502.
  - `tests/helpers/stack.ts`: `TEST_SECRET`, `startStack(opts?: { llm?: LlmProxy }): Promise<Stack>` where `Stack = { arena: Listening; gateway: Listening; store: MemoryStore; executor: SimulatedExecutor; paySpy: MockInstance; close(): Promise<void> }`, `postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: any }>`, `weatherPlan(host: string)`, `createTestTask(gatewayUrl: string): Promise<string>`.

- [ ] **Step 1: Write `tests/helpers/stack.ts`**

```ts
import { vi, type MockInstance } from "vitest";
import { createLegitVendor } from "@countersign/arena";
import { SimulatedExecutor, createGatewayApp, createTools, type LlmProxy } from "@countersign/gateway";
import { MemoryStore } from "@countersign/shared";
import { listen, type Listening } from "./listen";

export const TEST_SECRET = "test-sim-secret";

export interface Stack {
  arena: Listening;
  gateway: Listening;
  store: MemoryStore;
  executor: SimulatedExecutor;
  paySpy: MockInstance;
  close(): Promise<void>;
}

/** Arena + gateway on ephemeral ports, in-memory store, simulated executor with a spy on pay(). */
export async function startStack(opts: { llm?: LlmProxy } = {}): Promise<Stack> {
  const arena = await listen(createLegitVendor({ simPayerSecret: TEST_SECRET }));
  const store = new MemoryStore();
  const executor = new SimulatedExecutor(TEST_SECRET);
  const paySpy = vi.spyOn(executor, "pay");
  const tools = createTools({ store, executor, fetchHosts: [arena.host] });
  const gateway = await listen(createGatewayApp(tools, opts.llm));
  return {
    arena, gateway, store, executor, paySpy,
    async close() { await gateway.close(); await arena.close(); },
  };
}

export async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export function weatherPlan(host: string) {
  return {
    goal: "current weather for Berkeley",
    expected: [{ category: "weather", maxUnitUsd: 0.1, maxQuantity: 2, vendorDomains: [host], tiers: ["basic"] }],
  };
}

export async function createTestTask(gatewayUrl: string): Promise<string> {
  const r = await postJson(gatewayUrl, "/admin/tasks", { text: "Get the weather in Berkeley", budgetUsd: 1, taskType: "data-lookup" });
  if (r.status !== 200) throw new Error(`createTestTask failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.taskId as string;
}
```

- [ ] **Step 2: Write the failing INV2 test**

`tests/invariants/inv2-plan-first.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestTask, postJson, startStack, weatherPlan, type Stack } from "../helpers/stack";

describe("INV2: fetch_url before declare_plan is refused", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("refuses fetch_url without a plan and stores no page", async () => {
    const taskId = await createTestTask(s.gateway.url);
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: `${s.arena.url}/docs` });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PLAN_REQUIRED");
    expect(await s.store.listPages(taskId)).toEqual([]);
  });

  it("refuses pay_and_fetch without a plan: no quote stored, nothing paid", async () => {
    const taskId = await createTestTask(s.gateway.url);
    const r = await postJson(s.gateway.url, "/tools/pay_and_fetch", {
      taskId,
      req: { url: `${s.arena.url}/api/weather?tier=basic`, payeeDomain: s.arena.host, amountUsd: 0.1, purpose: "weather" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PLAN_REQUIRED");
    expect(await s.store.listQuotes(taskId)).toEqual([]);
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("plans are immutable: a second declare_plan is refused and the first plan stands", async () => {
    const taskId = await createTestTask(s.gateway.url);
    const plan = weatherPlan(s.arena.host);
    expect((await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan })).status).toBe(200);
    const second = await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: { ...plan, goal: "buy everything" } });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PLAN_EXISTS");
    expect((await s.store.getPlan(taskId))!.goal).toBe(plan.goal);
  });

  it("the plan's declaredAt precedes the first page's fetchedAt", async () => {
    const taskId = await createTestTask(s.gateway.url);
    await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: `${s.arena.url}/docs` });
    expect(r.status).toBe(200);
    const [page] = await s.store.listPages(taskId);
    expect((await s.store.getPlan(taskId))!.declaredAt).toBeLessThan(page.fetchedAt);
  });

  it("refuses declare_plan for an unknown task", async () => {
    const r = await postJson(s.gateway.url, "/tools/declare_plan", { taskId: "nope", plan: weatherPlan(s.arena.host) });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("TASK_NOT_FOUND");
  });

  it("refuses fetch_url to a host we do not host", async () => {
    const taskId = await createTestTask(s.gateway.url);
    await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: "http://example.com/" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("HOST_NOT_ALLOWED");
  });

  it("rejects malformed input with BAD_INPUT", async () => {
    const r = await postJson(s.gateway.url, "/tools/fetch_url", { taskId: "t", url: "not a url" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("BAD_INPUT");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/invariants/inv2-plan-first.test.ts`
Expected: FAIL, `createTools is not a function` (or import error for `createGatewayApp`).

- [ ] **Step 4: Write `packages/gateway/src/tools.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  CreateTaskSchema,
  DeclarePlanSchema,
  FetchUrlSchema,
  PayAndFetchSchema,
  type Decision,
  type PayResult,
  type Store,
  type Task,
} from "@countersign/shared";
import type { Executor } from "./executor";

export type ToolErrorCode =
  | "BAD_INPUT"
  | "TASK_NOT_FOUND"
  | "PLAN_REQUIRED"
  | "PLAN_EXISTS"
  | "HOST_NOT_ALLOWED"
  | "UPSTREAM_FAILED";

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string) {
    super(message);
  }
}

export interface GatewayDeps {
  store: Store;
  executor: Executor;
  /** host[:port] values the gateway may contact on the worker's behalf (D9). */
  fetchHosts: string[];
  fetchPage?: (url: string) => Promise<string>;
}

/** D6: until the decision core exists, nothing is approved. */
export const M1_HOLD_REASON = "Decision core not built yet (milestone 1): every payment is held. Fail closed.";

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ToolError("BAD_INPUT", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export function createTools(deps: GatewayDeps) {
  const { store, executor } = deps;
  const hosts = new Set(deps.fetchHosts.map((h) => h.toLowerCase()));
  const fetchPage =
    deps.fetchPage ??
    (async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new ToolError("UPSTREAM_FAILED", `GET ${url} returned ${res.status}`);
      return res.text();
    });

  async function requireTask(taskId: string): Promise<Task> {
    const task = await store.getTask(taskId);
    if (!task) throw new ToolError("TASK_NOT_FOUND", `no task ${taskId}`);
    return task;
  }

  async function requirePlan(taskId: string) {
    const plan = await store.getPlan(taskId);
    if (!plan) throw new ToolError("PLAN_REQUIRED", "declare_plan must be called before fetch_url or pay_and_fetch");
    return plan;
  }

  function requireAllowedHost(url: string) {
    const host = new URL(url).host.toLowerCase();
    if (!hosts.has(host)) throw new ToolError("HOST_NOT_ALLOWED", `${host} is not a host Countersign may contact`);
  }

  return {
    async createTask(input: unknown): Promise<Task> {
      const { text, budgetUsd, taskType } = parse(CreateTaskSchema, input);
      const task: Task = { taskId: randomUUID(), text, budgetUsd, taskType, createdAt: store.now() };
      await store.putTask(task);
      return task;
    },

    async declarePlan(input: unknown): Promise<{ ok: true }> {
      const { taskId, plan } = parse(DeclarePlanSchema, input);
      await requireTask(taskId);
      const inserted = await store.insertPlan({ taskId, goal: plan.goal, expected: plan.expected, declaredAt: store.now() });
      if (!inserted) throw new ToolError("PLAN_EXISTS", "a plan is already declared for this task; plans are immutable");
      return { ok: true };
    },

    async fetchUrl(input: unknown): Promise<{ pageId: string; text: string }> {
      const { taskId, url } = parse(FetchUrlSchema, input);
      await requireTask(taskId);
      await requirePlan(taskId);
      requireAllowedHost(url);
      const text = await fetchPage(url);
      const pageId = randomUUID();
      await store.putPage({ pageId, taskId, url, lines: text.split(/\r?\n/), fetchedAt: store.now() });
      return { pageId, text };
    },

    async payAndFetch(input: unknown): Promise<PayResult> {
      const { taskId, req } = parse(PayAndFetchSchema, input);
      await requireTask(taskId);
      await requirePlan(taskId);
      requireAllowedHost(req.url);
      const started = performance.now();

      let quote;
      try {
        quote = await executor.getQuote(req.url);
      } catch (e) {
        throw new ToolError("UPSTREAM_FAILED", (e as Error).message);
      }
      await store.putQuote({
        quoteId: randomUUID(),
        taskId,
        payeeDomain: quote.payeeDomain,
        amountUsd: quote.amountUsd,
        tier: quote.tier,
        unit: quote.unit,
        rawRequirements: quote.raw,
        receivedAt: store.now(),
      });

      const decision: Decision = {
        decisionId: randomUUID(),
        paymentRequestId: randomUUID(),
        taskId,
        tier: null,
        verdict: "hold",
        fieldOrigins: {},
        reasons: [M1_HOLD_REASON],
        latencyMs: performance.now() - started,
        costUsd: 0,
        createdAt: store.now(),
      };
      await store.putDecision(decision);
      return { status: "held", reason: M1_HOLD_REASON, decisionId: decision.decisionId };
    },
  };
}

export type Tools = ReturnType<typeof createTools>;
```

- [ ] **Step 5: Write `packages/gateway/src/server.ts`**

```ts
import express, { type Express } from "express";
import type { LlmProxy } from "./llm-proxy";
import { ToolError, type ToolErrorCode, type Tools } from "./tools";

const STATUS: Record<ToolErrorCode, number> = {
  BAD_INPUT: 400,
  HOST_NOT_ALLOWED: 403,
  TASK_NOT_FOUND: 404,
  PLAN_REQUIRED: 409,
  PLAN_EXISTS: 409,
  UPSTREAM_FAILED: 502,
};

export function createGatewayApp(tools: Tools, llm?: LlmProxy): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const route = (path: string, handler: (body: unknown) => Promise<unknown>) => {
    app.post(path, async (req, res) => {
      try {
        res.json(await handler(req.body));
      } catch (e) {
        if (e instanceof ToolError) {
          res.status(STATUS[e.code]).json({ error: { code: e.code, message: e.message } });
        } else {
          console.error(`[gateway] ${path}`, e);
          res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
        }
      }
    });
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Operator side. Unauthenticated by design for the hackathon (D13).
  route("/admin/tasks", tools.createTask);

  // Worker side: the only three tools.
  route("/tools/declare_plan", tools.declarePlan);
  route("/tools/fetch_url", tools.fetchUrl);
  route("/tools/pay_and_fetch", tools.payAndFetch);

  app.post("/llm/messages", async (req, res) => {
    if (!llm) {
      res.status(503).json({ error: { code: "LLM_DISABLED", message: "gateway has no ANTHROPIC_API_KEY/WORKER_MODEL" } });
      return;
    }
    try {
      const out = await llm(req.body ?? {});
      res.status(out.status).json(out.json);
    } catch (e) {
      console.error("[gateway] /llm/messages", e);
      res.status(502).json({ error: { code: "UPSTREAM_FAILED", message: "LLM call failed" } });
    }
  });

  return app;
}
```

- [ ] **Step 6: Write `packages/gateway/src/main.ts`**

```ts
import { readFileSync } from "node:fs";
import { MemoryStore } from "@countersign/shared";
import { SimulatedExecutor } from "./executor";
import { createLlmProxy } from "./llm-proxy";
import { createGatewayApp } from "./server";
import { createTools } from "./tools";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }
const env = process.env;

if ((env.EXECUTOR ?? "simulated") !== "simulated") {
  throw new Error("Only EXECUTOR=simulated exists in M1; the real x402 executor lands after B's M0 test");
}
if (!env.SIM_PAYER_SECRET) throw new Error("SIM_PAYER_SECRET is required (see .env.example)");

const { fetchHosts } = JSON.parse(
  readFileSync(new URL("../../../config/allowlist.json", import.meta.url), "utf8"),
) as { fetchHosts: string[] };

const executor = new SimulatedExecutor(env.SIM_PAYER_SECRET);
const tools = createTools({ store: new MemoryStore(), executor, fetchHosts });
const llm =
  env.ANTHROPIC_API_KEY && env.WORKER_MODEL
    ? createLlmProxy({ apiKey: env.ANTHROPIC_API_KEY, model: env.WORKER_MODEL })
    : undefined;
const port = Number(env.GATEWAY_PORT ?? 4000);

createGatewayApp(tools, llm).listen(port, () => {
  console.log(
    `[gateway] http://localhost:${port}  executor=${executor.kind.toUpperCase()}  llm=${llm ? "on" : "off"}  fetchHosts=${fetchHosts.join(",")}`,
  );
});
```

- [ ] **Step 7: Export from `packages/gateway/src/index.ts`**

```ts
export * from "./executor";
export * from "./llm-proxy";
export * from "./tools";
export * from "./server";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/invariants/inv2-plan-first.test.ts && pnpm typecheck`
Expected: 7 tests pass; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add packages/gateway tests/helpers/stack.ts tests/invariants/inv2-plan-first.test.ts && git commit -m "$(cat <<'EOF'
feat(gateway): declare_plan/fetch_url/pay_and_fetch over HTTP; INV2 plan-first enforced

pay_and_fetch stores the vendor quote and always returns HOLD until the
decision core lands (fail closed, D6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Worker in-process code (net guard, client, Claude loop) + static isolation check

**Files:**
- Create: `packages/worker/src/net-guard.ts`, `gateway-client.ts`, `loop.ts`, `main.ts`
- Modify: `packages/worker/src/index.ts`
- Test: `packages/worker/test/loop.test.ts`, `tests/invariants/inv1-worker-isolation.test.ts` (static part only; Task 8 adds the rest)

**Interfaces:**
- Produces:
  - `installNetGuard(gatewayUrl: string): void` (replaces `globalThis.fetch`; non-gateway origins reject with `NET_GUARD: …`)
  - `interface ToolResult { ok: boolean; status: number; body: unknown }`, `interface GatewayClient { declarePlan(taskId: string, plan: unknown): Promise<ToolResult>; fetchUrl(taskId: string, url: string): Promise<ToolResult>; payAndFetch(taskId: string, req: unknown): Promise<ToolResult>; llm(body: Record<string, unknown>): Promise<ToolResult> }`, `createGatewayClient(baseUrl: string): GatewayClient`
  - `TOOL_DEFS`, `SYSTEM_PROMPT`, `callTool(client: GatewayClient, taskId: string, name: string, input: any): Promise<ToolResult>`, `runWorker(opts: { client: GatewayClient; taskId: string; taskText: string; maxTurns?: number }): Promise<{ finalText: string; transcript: unknown[] }>`
  - Worker process entry `packages/worker/src/main.ts` reading `GATEWAY_URL`, `TASK_ID`, `TASK_TEXT`.

- [ ] **Step 1: Write the failing tests**

`packages/worker/test/loop.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { runWorker, type GatewayClient, type ToolResult } from "@countersign/worker";

function fakeClient(llmReplies: unknown[]) {
  const calls: unknown[][] = [];
  let i = 0;
  const ok = (body: unknown): ToolResult => ({ ok: true, status: 200, body });
  const client: GatewayClient = {
    // clone: the loop keeps mutating its messages array after each call
    llm: async (body) => { calls.push(["llm", structuredClone(body)]); return ok(llmReplies[i++]); },
    declarePlan: async (taskId, plan) => { calls.push(["declare_plan", taskId, plan]); return ok({ ok: true }); },
    fetchUrl: async (taskId, url) => { calls.push(["fetch_url", taskId, url]); return ok({ pageId: "p", text: "docs" }); },
    payAndFetch: async (taskId, req) => { calls.push(["pay_and_fetch", taskId, req]); return ok({ status: "held", reason: "r", decisionId: "d" }); },
  };
  return { client, calls };
}

describe("worker loop", () => {
  it("runs tools under the launcher's taskId, never one the model supplies", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "fetch_url", input: { url: "http://a/docs", taskId: "evil" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] },
    ]);
    const out = await runWorker({ client, taskId: "task-1", taskText: "x" });
    expect(calls[1]).toEqual(["fetch_url", "task-1", "http://a/docs"]);
    expect(out.finalText).toBe("done");
  });

  it("never sends a model id: the gateway chooses it", async () => {
    const { client, calls } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
    await runWorker({ client, taskId: "t", taskText: "x" });
    expect(calls[0][1]).not.toHaveProperty("model");
  });

  it("returns an unknown tool to the model as an error result", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "shell", input: {} }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    await runWorker({ client, taskId: "t", taskText: "x" });
    const second = calls[1][1] as { messages: Array<{ content: unknown }> };
    expect(second.messages.at(-1)!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: true }),
    ]);
  });
});
```

`tests/invariants/inv1-worker-isolation.test.ts` (static part; Task 8 appends to this file):
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKER_DIR = fileURLToPath(new URL("../../packages/worker/", import.meta.url));

/** Anything that would let worker code reach the network, a wallet, or a secret without the gateway. */
const FORBIDDEN = [
  /@coinbase\//,
  /x402/i,
  /\bviem\b/,
  /\bethers\b/,
  /["']node:(https?|net|tls|dgram|child_process)["']/,
  /from ["'](https?|net|tls|dgram|undici|axios|child_process)["']/,
  /@countersign\//,
  /SIM_PAYER_SECRET|CDP_|ANTHROPIC_API_KEY/,
];

describe("INV1: the worker has no wallet key and no network except the gateway", () => {
  it("worker src imports nothing that can reach a wallet, the network or a secret", () => {
    const srcDir = join(WORKER_DIR, "src");
    const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) => {
      const code = readFileSync(join(srcDir, f), "utf8");
      return FORBIDDEN.filter((re) => re.test(code)).map((re) => `${f}: ${re}`);
    });
    expect(offenders).toEqual([]);
  });

  it("worker package has zero dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(WORKER_DIR, "package.json"), "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/worker tests/invariants/inv1-worker-isolation.test.ts`
Expected: the 3 loop tests FAIL (`runWorker is not a function`). The 2 static INV1 tests already PASS, because only `src/index.ts` exists. That is intended: they are guards that must stay green as the code below is added.

- [ ] **Step 3: Write `packages/worker/src/net-guard.ts`**

```ts
/** Runs first in the worker process. After this, fetch can only reach the gateway (INV1, D8). */
export function installNetGuard(gatewayUrl: string): void {
  const allowed = new URL(gatewayUrl).origin;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const origin = new URL(href).origin;
    if (origin !== allowed) {
      return Promise.reject(new Error(`NET_GUARD: ${origin} blocked; worker may only call ${allowed}`));
    }
    return realFetch(input, init);
  };
}
```

- [ ] **Step 4: Write `packages/worker/src/gateway-client.ts`**

```ts
export interface ToolResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface GatewayClient {
  declarePlan(taskId: string, plan: unknown): Promise<ToolResult>;
  fetchUrl(taskId: string, url: string): Promise<ToolResult>;
  payAndFetch(taskId: string, req: unknown): Promise<ToolResult>;
  llm(body: Record<string, unknown>): Promise<ToolResult>;
}

export function createGatewayClient(baseUrl: string): GatewayClient {
  async function post(path: string, body: unknown): Promise<ToolResult> {
    const res = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }
  return {
    declarePlan: (taskId, plan) => post("/tools/declare_plan", { taskId, plan }),
    fetchUrl: (taskId, url) => post("/tools/fetch_url", { taskId, url }),
    payAndFetch: (taskId, req) => post("/tools/pay_and_fetch", { taskId, req }),
    llm: (body) => post("/llm/messages", body),
  };
}
```

- [ ] **Step 5: Write `packages/worker/src/loop.ts`**

```ts
import type { GatewayClient, ToolResult } from "./gateway-client";

export const SYSTEM_PROMPT =
  "You are a worker agent buying data for a task. Your only tools are declare_plan, fetch_url and pay_and_fetch. " +
  "Call declare_plan first, before reading any page. If a payment comes back held or blocked, stop and report it; do not retry.";

export const TOOL_DEFS = [
  {
    name: "declare_plan",
    description: "Declare what you intend to buy, before reading any page. Required first step. Cannot be changed later.",
    input_schema: {
      type: "object",
      properties: {
        plan: {
          type: "object",
          properties: {
            goal: { type: "string" },
            expected: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  maxUnitUsd: { type: "number" },
                  maxQuantity: { type: "integer" },
                  vendorDomains: { type: "array", items: { type: "string" } },
                  tiers: { type: "array", items: { type: "string" } },
                },
                required: ["category", "maxUnitUsd", "maxQuantity", "vendorDomains"],
              },
            },
          },
          required: ["goal", "expected"],
        },
      },
      required: ["plan"],
    },
  },
  {
    name: "fetch_url",
    description: "Read a web page. Only works after declare_plan.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "pay_and_fetch",
    description: "Pay for and fetch a paid API resource. Countersign decides approve, hold or block.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        payeeDomain: { type: "string" },
        amountUsd: { type: "number" },
        tier: { type: "string" },
        quantity: { type: "integer" },
        purpose: { type: "string" },
      },
      required: ["url", "payeeDomain", "amountUsd", "purpose"],
    },
  },
];

/** taskId always comes from the launcher, never from model output. */
export async function callTool(client: GatewayClient, taskId: string, name: string, input: any): Promise<ToolResult> {
  switch (name) {
    case "declare_plan":
      return client.declarePlan(taskId, input?.plan);
    case "fetch_url":
      return client.fetchUrl(taskId, input?.url);
    case "pay_and_fetch":
      return client.payAndFetch(taskId, input);
    default:
      return { ok: false, status: 400, body: { error: { code: "UNKNOWN_TOOL", message: `no tool named ${name}` } } };
  }
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

export async function runWorker(opts: {
  client: GatewayClient;
  taskId: string;
  taskText: string;
  maxTurns?: number;
}): Promise<{ finalText: string; transcript: unknown[] }> {
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: `Task: ${opts.taskText}` },
  ];
  for (let turn = 0; turn < (opts.maxTurns ?? 12); turn++) {
    const r = await opts.client.llm({ max_tokens: 1024, system: SYSTEM_PROMPT, tools: TOOL_DEFS, messages });
    if (!r.ok) throw new Error(`LLM call failed: ${r.status} ${JSON.stringify(r.body)}`);
    const msg = r.body as { content: ContentBlock[]; stop_reason: string };
    messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason !== "tool_use") {
      const finalText = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return { finalText, transcript: messages };
    }
    const results = [];
    for (const block of msg.content.filter((b) => b.type === "tool_use")) {
      const out = await callTool(opts.client, opts.taskId, block.name ?? "", block.input);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out.body), is_error: !out.ok });
    }
    messages.push({ role: "user", content: results });
  }
  return { finalText: "max turns reached", transcript: messages };
}
```

- [ ] **Step 6: Write `packages/worker/src/main.ts` and `index.ts`**

`packages/worker/src/main.ts`:
```ts
import { createGatewayClient } from "./gateway-client";
import { runWorker } from "./loop";
import { installNetGuard } from "./net-guard";

const { GATEWAY_URL, TASK_ID, TASK_TEXT } = process.env;
if (!GATEWAY_URL || !TASK_ID || !TASK_TEXT) {
  console.error("worker needs GATEWAY_URL, TASK_ID and TASK_TEXT");
  process.exit(2);
}

installNetGuard(GATEWAY_URL);
const result = await runWorker({ client: createGatewayClient(GATEWAY_URL), taskId: TASK_ID, taskText: TASK_TEXT });
console.log(result.finalText);
```
`packages/worker/src/index.ts`:
```ts
export * from "./gateway-client";
export * from "./loop";
export * from "./net-guard";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run packages/worker tests/invariants/inv1-worker-isolation.test.ts && pnpm typecheck`
Expected: 3 loop tests + 2 static INV1 tests pass; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/worker tests/invariants/inv1-worker-isolation.test.ts && git commit -m "$(cat <<'EOF'
feat(worker): net guard, gateway client and Claude tool loop; static INV1 import check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Worker launcher (allowlisted env) + process-level INV1 tests + operator CLI

**Files:**
- Create: `packages/worker/launch/launcher.ts`, `packages/worker/launch/run.ts`, `packages/worker/test/fixtures/probe.ts`, `tests/helpers/child.ts`
- Modify: `tests/invariants/inv1-worker-isolation.test.ts` (append)

**Interfaces:**
- Consumes: `startStack`, `TEST_SECRET` (Task 6); `installNetGuard` (Task 7); `signSimPayment`, `SIM_PAYMENT_HEADER` (Task 2).
- Produces:
  - `WORKER_PASSTHROUGH_ENV`, `WORKER_EXTRA_ENV`, `buildWorkerEnv(parent: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string>` (throws on non-allowlisted `extra` key), `spawnWorker(entry: string, args: string[], extra: Record<string, string>, opts?: { parentEnv?: NodeJS.ProcessEnv; stdio?: "pipe" | "inherit" }): ChildProcess`, `WORKER_MAIN: string` (absolute path of `src/main.ts`)
  - `runToExit(child: ChildProcess): Promise<{ code: number | null; stdout: string; stderr: string }>` in `tests/helpers/child.ts`

- [ ] **Step 1: Write `tests/helpers/child.ts` and the probe fixture**

`tests/helpers/child.ts`:
```ts
import type { ChildProcess } from "node:child_process";

export function runToExit(child: ChildProcess): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
```
`packages/worker/test/fixtures/probe.ts` (runs as a real worker process; prints one JSON line):
```ts
import { installNetGuard } from "../../src/net-guard";

const gateway = process.env.GATEWAY_URL!;
const target = process.argv[2]!;
installNetGuard(gateway);

const out: Record<string, unknown> = { envKeys: Object.keys(process.env) };
try {
  await fetch(target);
  out.target = "reached";
} catch (e) {
  out.target = "blocked";
  out.targetError = (e as Error).message;
}
try {
  out.gateway = (await fetch(new URL("/health", gateway))).status;
} catch (e) {
  out.gateway = `error: ${(e as Error).message}`;
}
console.log(JSON.stringify(out));
```

- [ ] **Step 2: Append the failing process-level tests to `tests/invariants/inv1-worker-isolation.test.ts`**

Add these imports at the top of the file (merge with the existing ones):
```ts
import { afterEach, beforeEach } from "vitest";
import { buildWorkerEnv, spawnWorker } from "@countersign/worker/launch";
import { SIM_PAYMENT_HEADER, signSimPayment } from "@countersign/shared";
import { runToExit } from "../helpers/child";
import { startStack, type Stack } from "../helpers/stack";
```
Append:
```ts
const PARENT_WITH_SECRETS: NodeJS.ProcessEnv = {
  ...process.env,
  CDP_API_KEY_ID: "leak", CDP_API_KEY_SECRET: "leak", CDP_WALLET_SECRET: "leak",
  ANTHROPIC_API_KEY: "leak", SIM_PAYER_SECRET: "leak", CRS_USERNAME: "leak", CRS_PASSWORD: "leak", CONVEX_URL: "leak",
};
const SECRET_KEY = /^(CDP_|ANTHROPIC|SIM_|CRS_|CONVEX)/i;
const PROBE = fileURLToPath(new URL("../../packages/worker/test/fixtures/probe.ts", import.meta.url));

describe("INV1: worker environment", () => {
  it("buildWorkerEnv passes no secrets even when the parent has them", () => {
    const env = buildWorkerEnv(PARENT_WITH_SECRETS, { GATEWAY_URL: "http://127.0.0.1:1" });
    expect(Object.keys(env).filter((k) => SECRET_KEY.test(k))).toEqual([]);
    expect(env.GATEWAY_URL).toBe("http://127.0.0.1:1");
  });

  it("buildWorkerEnv refuses to inject a non-allowlisted key", () => {
    expect(() => buildWorkerEnv({}, { CDP_WALLET_SECRET: "x" })).toThrow(/not allowed/);
  });
});

describe("INV1: a real worker process", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("cannot reach the arena directly, can reach the gateway, and sees no secrets", async () => {
    const child = spawnWorker(PROBE, [`${s.arena.url}/api/weather?tier=basic`], { GATEWAY_URL: s.gateway.url }, {
      parentEnv: PARENT_WITH_SECRETS,
      stdio: "pipe",
    });
    const { code, stdout, stderr } = await runToExit(child);
    expect(code, stderr).toBe(0);
    const out = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(out.target).toBe("blocked");
    expect(out.targetError).toMatch(/NET_GUARD/);
    expect(out.gateway).toBe(200);
    expect((out.envKeys as string[]).filter((k) => SECRET_KEY.test(k))).toEqual([]);
  });
});

describe("INV1: only the gateway's executor can pay the arena", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("an unpaid direct call gets a 402 and no data", async () => {
    const res = await fetch(`${s.arena.url}/api/weather?tier=basic`);
    expect(res.status).toBe(402);
    expect(await res.json()).not.toHaveProperty("tempC");
  });

  it("a payment signed without the gateway's secret is rejected", async () => {
    const resource = "/api/weather?tier=basic";
    const forged = signSimPayment("guessed-secret", { idempotencyKey: "k", resource, amountAtomic: "100000" });
    const res = await fetch(`${s.arena.url}${resource}`, { headers: { [SIM_PAYMENT_HEADER]: forged } });
    expect(res.status).toBe(402);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/invariants/inv1-worker-isolation.test.ts`
Expected: FAIL, cannot resolve `@countersign/worker/launch` (`launch/launcher.ts` does not exist).

- [ ] **Step 4: Write `packages/worker/launch/launcher.ts`**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Operator-side. Builds the worker's entire environment from an allowlist (INV1, D8). */
export const WORKER_PASSTHROUGH_ENV = ["PATH", "SYSTEMROOT", "TEMP", "TMP"] as const;
export const WORKER_EXTRA_ENV = ["GATEWAY_URL", "TASK_ID", "TASK_TEXT"] as const;

export const WORKER_MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/** Windows env keys are case-insensitive ("Path" vs "PATH"), so match case-insensitively. */
function lookup(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const hit = Object.keys(env).find((k) => k.toUpperCase() === key);
  return hit === undefined ? undefined : env[hit];
}

export function buildWorkerEnv(parent: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of WORKER_PASSTHROUGH_ENV) {
    const value = lookup(parent, key);
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!(WORKER_EXTRA_ENV as readonly string[]).includes(key)) throw new Error(`worker env key not allowed: ${key}`);
    env[key] = value;
  }
  return env;
}

export function spawnWorker(
  entry: string,
  args: string[],
  extra: Record<string, string>,
  opts: { parentEnv?: NodeJS.ProcessEnv; stdio?: "pipe" | "inherit" } = {},
): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    env: buildWorkerEnv(opts.parentEnv ?? process.env, extra),
    stdio: opts.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}
```

- [ ] **Step 5: Write `packages/worker/launch/run.ts`**

```ts
import { WORKER_MAIN, spawnWorker } from "./launcher";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }

const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:4000";
const arenaPort = process.env.ARENA_PORT ?? "4101";
const text =
  process.argv.slice(2).join(" ") ||
  `Get the current weather for Berkeley from WeatherCo. Docs: http://localhost:${arenaPort}/docs. Budget $1.`;

const res = await fetch(new URL("/admin/tasks", gatewayUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text, budgetUsd: 1, taskType: "data-lookup" }),
});
if (!res.ok) throw new Error(`could not create task: ${res.status} ${await res.text()}`);
const { taskId } = (await res.json()) as { taskId: string };
console.log(`[run] task ${taskId}; spawning isolated worker`);

const child = spawnWorker(WORKER_MAIN, [], { GATEWAY_URL: gatewayUrl, TASK_ID: taskId, TASK_TEXT: text }, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/invariants/inv1-worker-isolation.test.ts && pnpm typecheck`
Expected: 7 tests pass (2 static, 2 env, 1 process, 2 arena); typecheck exits 0. If the process test fails with `ERR_MODULE_NOT_FOUND` for `tsx`, the child's cwd is wrong: confirm vitest was started from the repo root.

- [ ] **Step 7: Commit**

```bash
git add packages/worker tests/helpers/child.ts tests/invariants/inv1-worker-isolation.test.ts && git commit -m "$(cat <<'EOF'
feat(worker): launcher with allowlisted env; INV1 process-level tests

A spawned worker sees no secrets, cannot reach the arena directly, and a
payment not signed by the gateway is rejected.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: M1 acceptance, live Claude worker, invariant 3–5 placeholders, docs

**Files:**
- Create: `tests/m1-acceptance.test.ts`, `tests/m1-live.test.ts`, `tests/invariants/inv3-5.todo.test.ts`
- Modify: `README.md` (status table)

**Interfaces:**
- Consumes: `startStack`, `createTestTask`, `weatherPlan`, `postJson` (Task 6); `createGatewayClient` (Task 7); `spawnWorker`, `WORKER_MAIN` (Task 8); `createLlmProxy`, `M1_HOLD_REASON` (Tasks 5–6); `runToExit` (Task 8).

- [ ] **Step 1: Write the M1 acceptance test**

`tests/m1-acceptance.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { M1_HOLD_REASON } from "@countersign/gateway";
import { createGatewayClient } from "@countersign/worker";
import { createTestTask, startStack, weatherPlan, type Stack } from "./helpers/stack";

describe("M1 acceptance: the worker can only read and pay through the gateway", () => {
  let s: Stack;
  beforeEach(async () => { s = await startStack(); });
  afterEach(() => s.close());

  it("declare → fetch docs → pay_and_fetch is HELD, quote and decision stored, nothing paid", async () => {
    const client = createGatewayClient(s.gateway.url);
    const taskId = await createTestTask(s.gateway.url);

    expect((await client.declarePlan(taskId, weatherPlan(s.arena.host))).ok).toBe(true);

    const fetched = await client.fetchUrl(taskId, `${s.arena.url}/docs`);
    expect(fetched.ok).toBe(true);
    expect((fetched.body as { text: string }).text).toContain("Basic tier");
    const [page] = await s.store.listPages(taskId);
    expect(page.lines[1]).toContain("$0.10");

    const pay = await client.payAndFetch(taskId, {
      url: `${s.arena.url}/api/weather?tier=basic&city=Berkeley`,
      payeeDomain: s.arena.host,
      amountUsd: 0.1,
      tier: "basic",
      quantity: 1,
      purpose: "weather for Berkeley",
    });
    expect(pay.body).toMatchObject({ status: "held", reason: M1_HOLD_REASON });

    const quotes = await s.store.listQuotes(taskId);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ payeeDomain: s.arena.host, amountUsd: 0.1, tier: "basic" });

    const decision = await s.store.getDecision((pay.body as { decisionId: string }).decisionId);
    expect(decision).toMatchObject({ verdict: "hold", taskId });
    expect(s.paySpy).not.toHaveBeenCalled();
  });

  it("the gateway's simulated executor can complete a payment (path ready for M2), labelled simulated", async () => {
    const url = `${s.arena.url}/api/weather?tier=basic&city=Berkeley`;
    const out = await s.executor.pay(url, await s.executor.getQuote(url), "m1-acceptance-idem");
    expect(out).toMatchObject({ status: "settled", httpStatus: 200, simulated: true });
  });

  it("the gateway refuses /llm/messages when it has no key configured", async () => {
    const res = await fetch(`${s.gateway.url}/llm/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Write the live worker test (skips without a key)**

`tests/m1-live.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createLlmProxy } from "@countersign/gateway";
import { WORKER_MAIN, spawnWorker } from "@countersign/worker/launch";
import { runToExit } from "./helpers/child";
import { createTestTask, startStack } from "./helpers/stack";

try { process.loadEnvFile(); } catch { /* no .env */ }
const { ANTHROPIC_API_KEY, WORKER_MODEL } = process.env;

describe("M1 live: a real Claude worker in an isolated process", () => {
  it.skipIf(!ANTHROPIC_API_KEY || !WORKER_MODEL)(
    "declares a plan through the gateway and every payment it attempts is held",
    async () => {
      const s = await startStack({ llm: createLlmProxy({ apiKey: ANTHROPIC_API_KEY!, model: WORKER_MODEL! }) });
      try {
        const taskId = await createTestTask(s.gateway.url);
        const text = `Get the current weather for Berkeley from WeatherCo. Docs: ${s.arena.url}/docs. Vendor host: ${s.arena.host}. Budget $1.`;
        const child = spawnWorker(WORKER_MAIN, [], { GATEWAY_URL: s.gateway.url, TASK_ID: taskId, TASK_TEXT: text });
        const { code, stdout, stderr } = await runToExit(child);
        console.log(stdout);
        expect(code, stderr).toBe(0);
        expect(await s.store.getPlan(taskId)).toBeDefined();
        expect(s.paySpy).not.toHaveBeenCalled();
      } finally {
        await s.close();
      }
    },
    120_000,
  );
});
```

- [ ] **Step 3: Write invariant 3–5 placeholders**

`tests/invariants/inv3-5.todo.test.ts`:
```ts
import { describe, it } from "vitest";

describe("invariants pending later milestones", () => {
  it.todo("INV3: any PAGE/UNKNOWN field origin forces final verdict >= HOLD even if Tier 1 or the judge approves (M2)");
  it.todo("INV4: Tier 2 judge input never contains page text, page summaries or the agent's purpose text (M2)");
  it.todo("INV5: a timeout never triggers a second payment; status is confirmed before any retry (M4)");
});
```

- [ ] **Step 4: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: all files pass; `m1-live` reports 1 skipped unless `.env` has `ANTHROPIC_API_KEY` and `WORKER_MODEL`; 3 todo. Typecheck exits 0.

- [ ] **Step 5: Manual end-to-end smoke (needs `.env` with `SIM_PAYER_SECRET`, plus `ANTHROPIC_API_KEY` + `WORKER_MODEL` for step c)**

a. `pnpm dev:arena` → prints `[arena] legit-vendor (SIMULATED) on http://localhost:4101`
b. `pnpm dev:gateway` → prints `[gateway] http://localhost:4000  executor=SIMULATED  llm=on …`
c. `pnpm worker` → prints `[run] task …`, then the model's final text reporting that the payment was held.

Record pass/fail per step in the milestone report. If the key isn't available yet, report step c as "not run".

- [ ] **Step 6: Update the README status table**

Replace the `M1 gateway skeleton | in progress` row with:
```markdown
| M1 gateway skeleton | done: INV1 + INV2 green; all payments HOLD until M2 |
```
and the `M0 repo + decisions` row with:
```markdown
| M0 repo + decisions | repo done; Droid test (D), real x402 payment (B), Convex (C) pending |
```

- [ ] **Step 7: Secret check and commit**

Run: `git status --short && git ls-files | grep -iE '^\.env($|\.)' | grep -v '.env.example' || echo "no env files tracked"`
Expected: `no env files tracked`.

```bash
git add tests README.md && git commit -m "$(cat <<'EOF'
test: M1 acceptance, live Claude worker test, INV3-5 placeholders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Milestone report template (fill after Task 9)

| Check | Result |
|---|---|
| INV1 static: worker imports nothing network/wallet/secret | pass/fail |
| INV1 env: worker env has no secrets | pass/fail |
| INV1 process: worker cannot reach arena, can reach gateway | pass/fail |
| INV1 arena: only the gateway's signature pays | pass/fail |
| INV2: fetch_url / pay_and_fetch refused before plan; plan immutable; ordering | pass/fail |
| M1 acceptance (scripted worker path) | pass/fail |
| M1 live (real Claude worker) | pass/fail/skipped |
| Manual smoke a/b/c | pass/fail/not run |
