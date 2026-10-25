// OWNER: D
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TEAM_SIGNALS } from "../shared/config.js";
import { readGithubSignals } from "./github.js";
import type { Signal } from "./types.js";

const REPO = "nikhilrajgopal/northwind-demo";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const milestones = [
  {
    number: 1, title: "Support agent v2 launch", description: "", due_on: "2026-10-27T07:00:00Z",
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-01T10:00:00Z",
    html_url: "https://github.com/x/milestone/1", creator: { login: "nikhil" },
  },
  {
    number: 2, title: "Fall campaign", description: "description moved from Oct 21", due_on: "2026-11-04T08:00:00Z",
    created_at: "2026-09-02T00:00:00Z", updated_at: "2026-10-19T10:00:00Z",
    html_url: "https://github.com/x/milestone/2", creator: { login: "nikhil" },
  },
  {
    number: 3, title: "Support old thing", description: "", due_on: "2026-03-01T00:00:00Z",
    created_at: "2026-02-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z",
    html_url: "https://github.com/x/milestone/3", creator: { login: "nikhil" },
  },
];
const releases = [
  { id: 10, tag_name: "v1", name: "Support v1", body: "x".repeat(300), published_at: "2026-10-05T00:00:00Z", html_url: "r1", author: { login: "a" } },
  { id: 11, tag_name: "v0", name: "Support v0", body: "old", published_at: "2026-08-05T00:00:00Z", html_url: "r2" },
];
const prs = {
  items: [
    { number: 5, title: "Tune prompts", labels: [{ name: "support" }], closed_at: "2026-10-10T00:00:00Z", html_url: "p5", user: { login: "bob" } },
    { number: 6, title: "Unrelated", labels: [{ name: "infra" }], closed_at: "2026-10-11T00:00:00Z", html_url: "p6", user: { login: "bob" } },
    { number: 7, title: "Support too old", labels: [], closed_at: "2026-08-11T00:00:00Z", html_url: "p7" },
  ],
};

function fakeFetch(status = 200) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (status !== 200) return json({}, status);
    if (u.includes("/milestones")) return json(milestones);
    if (u.includes("/releases")) return json(releases);
    return json(prs);
  });
}

function fixtureFile(signals: Signal[]) {
  const p = join(mkdtempSync(join(tmpdir(), "gh-")), "github.json");
  writeFileSync(p, JSON.stringify(signals));
  return p;
}

const run = (team: any, f: any, extra: object = {}) =>
  readGithubSignals(team, "2026-10", { fetch: f, token: "t", log: () => {}, ...extra });

describe("readGithubSignals", () => {
  it("maps milestones and parses previousDueDate", async () => {
    const out = await run("support", fakeFetch());
    const ms = out.find((s) => s.id === `gh:milestone:${REPO}:2`)!;
    expect(ms).toMatchObject({
      source: "github", team: "support", date: "2026-10-19",
      dueDate: "2026-11-04", previousDueDate: "2026-10-21", author: "nikhil",
      text: "Milestone 'Fall campaign' due 2026-11-04: description moved from Oct 21",
    });
  });

  it("omits description suffix when empty", async () => {
    const out = await run("support", fakeFetch());
    const ms = out.find((s) => s.id === `gh:milestone:${REPO}:1`)!;
    expect(ms.text).toBe("Milestone 'Support agent v2 launch' due 2026-10-27");
    expect(ms.previousDueDate).toBeUndefined();
  });

  it("a repo listed for one team yields everything in window, with no keyword filter", async () => {
    const support = await run("support", fakeFetch());
    expect(support.filter((s) => s.kind === "milestone").map((s) => s.id)).toEqual([`gh:milestone:${REPO}:1`, `gh:milestone:${REPO}:2`]);
    expect(support.filter((s) => s.kind === "pr").map((s) => s.id)).toEqual([`gh:pr:${REPO}:5`, `gh:pr:${REPO}:6`]);
    const f = fakeFetch();
    await run("search", f);
    expect(String(f.mock.calls[0][0])).toContain("nikhilrajgopal/northwind-search");
  });

  it("a repo listed for several teams still filters by keyword", async () => {
    const saved = TEAM_SIGNALS.growth.githubRepos;
    TEAM_SIGNALS.growth.githubRepos = [REPO];
    try {
      const support = await run("support", fakeFetch());
      expect(support.filter((s) => s.kind === "milestone").map((s) => s.id)).toEqual([`gh:milestone:${REPO}:1`]);
      expect(support.filter((s) => s.kind === "pr").map((s) => s.id)).toEqual([`gh:pr:${REPO}:5`]);
      const growth = await run("growth", fakeFetch());
      expect(growth.filter((s) => s.kind === "milestone").map((s) => s.id)).toEqual([`gh:milestone:${REPO}:2`]);
    } finally {
      TEAM_SIGNALS.growth.githubRepos = saved;
    }
  });

  it("sends required headers", async () => {
    const f = fakeFetch();
    await run("support", f);
    expect(f).toHaveBeenCalledTimes(3);
    for (const call of f.mock.calls) {
      const headers = (call as any)[1].headers;
      expect(headers).toEqual({
        Authorization: "Bearer t",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "trueup",
      });
    }
  });

  it("filters releases by window and truncates body", async () => {
    const out = (await run("support", fakeFetch())).filter((s) => s.kind === "release");
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(`Release Support v1: ${"x".repeat(200)}`);
    expect(out[0].date).toBe("2026-10-05");
  });

  it("filters PRs by window", async () => {
    const out = (await run("support", fakeFetch())).filter((s) => s.kind === "pr");
    expect(out).toHaveLength(2); // single-team repo: unrelated PR kept too, old one dropped by window
    expect(out[0]).toMatchObject({ text: "PR #5 Tune prompts", labels: ["support"], author: "bob", date: "2026-10-10" });
  });

  it("falls back to filtered fixture on non-2xx with one warning", async () => {
    const fixture: Signal[] = [
      { id: "a", source: "github", kind: "milestone", team: "support", date: "2026-10-01", text: "in", url: "u" },
      { id: "b", source: "github", kind: "milestone", team: "growth", date: "2026-10-01", text: "other team", url: "u" },
      { id: "c", source: "github", kind: "milestone", team: "support", date: "2026-01-01", text: "old", url: "u" },
      { id: "d", source: "github", kind: "milestone", team: "support", date: "2026-01-01", dueDate: "2026-10-27", text: "due", url: "u" },
    ];
    const log = vi.fn();
    const out = await run("support", fakeFetch(500), { fixturePath: fixtureFile(fixture), log });
    expect(out.map((s) => s.id)).toEqual(["a", "d"]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("uses fixture without fetching when there is no token", async () => {
    const f = fakeFetch();
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const fixture: Signal[] = [
        { id: "a", source: "github", kind: "pr", team: "support", date: "2026-10-02", text: "x", url: "u" },
      ];
      const log = vi.fn();
      const out = await readGithubSignals("support", "2026-10", { fetch: f, log, fixturePath: fixtureFile(fixture) });
      expect(out.map((s) => s.id)).toEqual(["a"]);
      expect(f).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
    }
  });

  it("returns [] when fixture is missing", async () => {
    const out = await run("support", fakeFetch(500), { fixturePath: "/nonexistent/github.json" });
    expect(out).toEqual([]);
  });

  it("falls back when fetch throws", async () => {
    const f = vi.fn(async () => { throw new Error("boom"); });
    expect(await run("support", f, { fixturePath: "/nonexistent/x.json" })).toEqual([]);
  });
});
