// OWNER: D
import { describe, expect, it } from "vitest";
import { SEED_GITHUB_MARKER, type Scenario, type SeedRepo } from "./scenario.js";
import { seedGithub } from "./seedGithub.js";

type Call = { method: string; path: string; body: any; headers: Record<string, string> };
type Handler = (c: Call) => Response | undefined;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function fakeFetch(handlers: Handler[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      path: String(url).replace("https://api.github.com", ""),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    };
    calls.push(call);
    for (const h of handlers) {
      const r = h(call);
      if (r) return r;
    }
    return json({ message: `unhandled ${call.method} ${call.path}` }, 500);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const on = (method: string, re: RegExp, fn: (c: Call) => Response): Handler => (c) =>
  c.method === method && re.test(c.path) ? fn(c) : undefined;

const R = "acme/northwind-demo";
const sleep = async () => {};

function repo(over: Partial<SeedRepo> = {}): SeedRepo {
  return { repo: R, team: "support" as any, milestones: [], issues: [], prs: [], releases: [], ...over };
}
function scenario(r: SeedRepo, legacy: Scenario["legacyCleanup"] = []): Scenario {
  return {
    company: "Northwind", month: "2026-10", personas: [], channels: [], messages: [],
    repos: [r], legacyCleanup: legacy, expected: {} as any,
  };
}
const base = (): Handler[] => [
  on("GET", /^\/repos\/acme\/northwind-demo$/, () => json({ default_branch: "main" })),
  on("GET", /\/labels\//, () => json({ name: "x" })),
  on("GET", /\/(milestones|issues|pulls|releases)\?/, () => json([])),
];
const run = (s: Scenario, handlers: Handler[], o: Record<string, unknown> = {}) => {
  const f = fakeFetch([...handlers, ...base()]);
  return seedGithub(s, { token: "tok", fetch: f.fn, sleep, ...o }).then((result) => ({ result, calls: f.calls }));
};
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("seedGithub", () => {
  it("sends required headers and creates a missing milestone with marker and due_on", async () => {
    const s = scenario(repo({ milestones: [{ title: "Launch", dueOn: "2026-10-28", description: "Big day" }] }));
    const { result, calls } = await run(s, [
      on("GET", /\/milestones/, () => json([])),
      on("POST", /\/milestones$/, () => json({ number: 7 }, 201)),
    ]);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.path).toBe(`/repos/${R}/milestones`);
    expect(post.body).toEqual({
      title: "Launch", due_on: "2026-10-28T23:59:59Z",
      description: `Big day\n\n${SEED_GITHUB_MARKER}`, state: "open",
    });
    expect(post.headers).toMatchObject({
      Authorization: "Bearer tok", Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "trueup-seed",
    });
    expect(result.milestones).toBe(1);
  });

  it("updates an existing milestone", async () => {
    const s = scenario(repo({ milestones: [{ title: "Launch", dueOn: "2026-11-04", description: "Moved", state: "closed" }] }));
    const { calls } = await run(s, [
      on("GET", /\/milestones/, () => json([{ number: 3, title: "Launch", description: "old", due_on: "2026-10-21T00:00:00Z" }])),
      on("PATCH", /\/milestones\/3$/, () => json({ number: 3 })),
    ]);
    const patch = writes(calls)[0];
    expect(patch.method).toBe("PATCH");
    expect(patch.body).toEqual({ due_on: "2026-11-04T23:59:59Z", description: `Moved\n\n${SEED_GITHUB_MARKER}`, state: "closed" });
    expect(writes(calls)).toHaveLength(1);
  });

  it("legacy cleanup deletes 'Fall campaign' in northwind-demo", async () => {
    const s = scenario(repo(), [{ repo: R, milestoneTitle: "Fall campaign" }]);
    const { result, calls } = await run(s, [
      on("GET", /\/milestones/, () => json([{ number: 9, title: "Fall campaign", description: "hand made" }])),
      on("DELETE", /\/milestones\/9$/, () => new Response(null, { status: 204 })),
    ]);
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE /repos/${R}/milestones/9`]);
    expect(result.deleted).toBe(1);
  });

  it("creates an issue with milestone number and labels, creating missing labels", async () => {
    const s = scenario(repo({
      milestones: [{ title: "M1", dueOn: "2026-10-30", description: "d" }],
      issues: [{ title: "Ship it", body: "details", labels: ["launch"], milestone: "M1" }],
    }));
    const { result, calls } = await run(s, [
      on("GET", /\/labels\/launch/, () => json({ message: "Not Found" }, 404)),
      on("POST", /\/labels$/, () => json({}, 201)),
      on("GET", /\/milestones/, () => json([])),
      on("POST", /\/milestones$/, () => json({ number: 5 }, 201)),
      on("GET", /\/issues\?/, () => json([])),
      on("POST", /\/issues$/, () => json({ number: 1 }, 201)),
    ]);
    expect(calls.find((c) => c.path.endsWith("/labels") && c.method === "POST")!.body.name).toBe("launch");
    const issue = calls.find((c) => c.method === "POST" && c.path.endsWith("/issues"))!;
    expect(issue.body).toEqual({ title: "Ship it", body: `details\n\n${SEED_GITHUB_MARKER}`, labels: ["launch"], milestone: 5 });
    expect(result.issues).toBe(1);
  });

  it("skips an existing seeded issue", async () => {
    const s = scenario(repo({ issues: [{ title: "Ship it", body: "b", labels: [] }] }));
    const { result, calls } = await run(s, [
      on("GET", /\/issues\?/, () => json([{ number: 1, title: "Ship it", body: `b ${SEED_GITHUB_MARKER}` }])),
    ]);
    expect(writes(calls)).toHaveLength(0);
    expect(result.issues).toBe(0);
  });

  const pr = { title: "Add retries", body: "pr body", labels: ["infra"], branch: "seed/retries", file: "docs/a b.md", content: "hello", merge: true };

  it("runs the PR flow in order", async () => {
    const { result, calls } = await run(scenario(repo({ prs: [pr] })), [
      on("GET", /\/pulls\?/, () => json([])),
      on("GET", /\/git\/ref\/heads\/main$/, () => json({ object: { sha: "abc" } })),
      on("POST", /\/git\/refs$/, () => json({}, 201)),
      on("GET", /\/contents\//, () => json({ message: "Not Found" }, 404)),
      on("PUT", /\/contents\//, () => json({}, 201)),
      on("POST", /\/pulls$/, () => json({ number: 42 }, 201)),
      on("POST", /\/issues\/42\/labels$/, () => json([])),
      on("PUT", /\/pulls\/42\/merge$/, () => json({ merged: true })),
    ]);
    const seq = calls.filter((c) => !c.path.includes("/labels/") && !c.path.includes("/milestones") && !c.path.includes("/issues?"))
      .map((c) => `${c.method} ${c.path}`);
    expect(seq).toEqual([
      `GET /repos/${R}/pulls?state=all&per_page=100`,
      `GET /repos/${R}`,
      `GET /repos/${R}/git/ref/heads/main`,
      `POST /repos/${R}/git/refs`,
      `GET /repos/${R}/contents/docs/a%20b.md?ref=seed%2Fretries`,
      `PUT /repos/${R}/contents/docs/a%20b.md`,
      `POST /repos/${R}/pulls`,
      `POST /repos/${R}/issues/42/labels`,
      `PUT /repos/${R}/pulls/42/merge`,
    ]);
    const byPath = (m: string, p: string) => calls.find((c) => c.method === m && c.path.endsWith(p))!;
    expect(byPath("POST", "/git/refs").body).toEqual({ ref: "refs/heads/seed/retries", sha: "abc" });
    expect(byPath("PUT", "/contents/docs/a%20b.md").body).toMatchObject({ content: Buffer.from("hello").toString("base64"), branch: "seed/retries" });
    expect(byPath("POST", "/pulls").body).toMatchObject({ head: "seed/retries", base: "main", body: `pr body\n\n${SEED_GITHUB_MARKER}` });
    expect(byPath("PUT", "/merge").body).toEqual({ merge_method: "squash" });
    expect(result.prs).toBe(1);
  });

  it("tolerates an existing branch and passes sha for an existing file", async () => {
    const { calls } = await run(scenario(repo({ prs: [{ ...pr, merge: false }] })), [
      on("GET", /\/pulls\?/, () => json([])),
      on("GET", /\/git\/ref\/heads\/main$/, () => json({ object: { sha: "abc" } })),
      on("POST", /\/git\/refs$/, () => json({ message: "Reference already exists" }, 422)),
      on("GET", /\/contents\//, () => json({ sha: "filesha" })),
      on("PUT", /\/contents\//, () => json({})),
      on("POST", /\/pulls$/, () => json({ number: 1 }, 201)),
      on("POST", /\/issues\/1\/labels$/, () => json([])),
    ]);
    expect(calls.find((c) => c.method === "PUT")!.body.sha).toBe("filesha");
    expect(calls.some((c) => c.path.endsWith("/merge"))).toBe(false);
  });

  it("skips an existing PR, merging it only if needed", async () => {
    const a = await run(scenario(repo({ prs: [pr] })), [
      on("GET", /\/pulls\?/, () => json([{ number: 4, title: "Add retries", state: "closed", merged_at: "2026-10-01T00:00:00Z" }])),
    ]);
    expect(writes(a.calls)).toHaveLength(0);
    expect(a.result.prs).toBe(0);
    const b = await run(scenario(repo({ prs: [pr] })), [
      on("GET", /\/pulls\?/, () => json([{ number: 4, title: "Add retries", state: "open", merged_at: null }])),
      on("PUT", /\/pulls\/4\/merge$/, () => json({ merged: true })),
    ]);
    expect(writes(b.calls).map((c) => c.path)).toEqual([`/repos/${R}/pulls/4/merge`]);
  });

  it("creates a release once", async () => {
    const s = scenario(repo({ releases: [{ tag: "v1.0.0", name: "One", body: "notes" }] }));
    let exists = false;
    const handlers = [
      on("GET", /\/releases\/tags\/v1\.0\.0$/, () => (exists ? json({ id: 1 }) : json({ message: "Not Found" }, 404))),
      on("POST", /\/releases$/, () => { exists = true; return json({ id: 1 }, 201); }),
    ];
    const first = await run(s, handlers);
    const second = await run(s, handlers);
    expect(first.result.releases).toBe(1);
    expect(first.calls.find((c) => c.method === "POST")!.body).toEqual({
      tag_name: "v1.0.0", name: "One", body: `notes\n\n${SEED_GITHUB_MARKER}`, target_commitish: "main",
    });
    expect(second.result.releases).toBe(0);
    expect(writes(second.calls)).toHaveLength(0);
  });

  it("reset removes only marked items and follows pagination", async () => {
    const { result, calls } = await run(scenario(repo()), [
      on("GET", /\/milestones\?state=all&per_page=100$/, () =>
        json([{ number: 1, description: `x ${SEED_GITHUB_MARKER}` }], 200, { link: `<https://api.github.com/repos/${R}/milestones?page=2>; rel="next"` })),
      on("GET", /\/milestones\?page=2$/, () => json([{ number: 2, description: "hand made" }])),
      on("GET", /\/issues\?state=open/, () => json([
        { number: 10, title: "a", body: `${SEED_GITHUB_MARKER}` },
        { number: 11, title: "b", body: "mine" },
        { number: 12, title: "pr", body: SEED_GITHUB_MARKER, pull_request: {} },
      ])),
      on("GET", /\/releases\?/, () => json([{ id: 20, body: SEED_GITHUB_MARKER }, { id: 21, body: "hand" }])),
      on("DELETE", /.*/, () => new Response(null, { status: 204 })),
      on("PATCH", /.*/, () => json({})),
    ], { reset: true });
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /repos/${R}/milestones/1`,
      `PATCH /repos/${R}/issues/10`,
      `DELETE /repos/${R}/releases/20`,
    ]);
    expect(writes(calls)[1].body).toEqual({ state: "closed" });
    expect(result.deleted).toBe(3);
  });

  it("dry run issues no non-GET calls", async () => {
    const logs: string[] = [];
    const s = scenario(repo({
      milestones: [{ title: "M", dueOn: "2026-10-30", description: "d" }],
      issues: [{ title: "i", body: "b", labels: ["new"], milestone: "M" }],
      prs: [pr],
      releases: [{ tag: "v1", name: "n", body: "b" }],
    }), [{ repo: R, milestoneTitle: "Fall campaign" }]);
    const { result, calls } = await run(s, [
      on("GET", /\/labels\/new/, () => json({}, 404)),
      on("GET", /\/milestones/, () => json([{ number: 9, title: "Fall campaign" }])),
      on("GET", /\/issues\?/, () => json([])),
      on("GET", /\/pulls\?/, () => json([])),
      on("GET", /\/git\/ref\//, () => json({ object: { sha: "abc" } })),
      on("GET", /\/contents\//, () => json({}, 404)),
      on("GET", /\/releases\/tags\//, () => json({}, 404)),
    ], { dryRun: true, reset: true, log: (m: string) => logs.push(m) });
    expect(writes(calls)).toHaveLength(0);
    expect(logs.filter((l) => l.startsWith("[dry-run]")).length).toBeGreaterThan(5);
    expect(result.milestones).toBe(1);
    expect(result.prs).toBe(1);
  });

  it("errors include method, path, status and GitHub's message", async () => {
    const s = scenario(repo({ milestones: [{ title: "M", dueOn: "2026-10-30", description: "d" }] }));
    await expect(run(s, [
      on("GET", /\/milestones/, () => json({ message: "Bad credentials" }, 401)),
    ])).rejects.toThrow(/GET \/repos\/acme\/northwind-demo\/milestones.*401.*Bad credentials/);
  });
});
