// OWNER: D
import { readFile } from "node:fs/promises";
import { TEAM_SIGNALS, lastDayOfMonth } from "../shared/config.js";
import type { Month, Team } from "../shared/types.js";
import type { Signal } from "./types.js";

type Deps = {
  fetch?: typeof fetch;
  token?: string;
  fixturePath?: string;
  log?: (msg: string) => void;
};

const API = "https://api.github.com";
const DEFAULT_FIXTURE = "data/fixtures/signals/github.json";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// 14 days before the 1st of the month through the last day, inclusive (YYYY-MM-DD).
function windowFor(month: Month): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - 14 * 86400000).toISOString().slice(0, 10);
  return { from, to: lastDayOfMonth(month) };
}

const inWindow = (d: string | undefined, w: { from: string; to: string }) =>
  !!d && d >= w.from && d <= w.to;

const dateOf = (iso: string | null | undefined): string | undefined => (iso ? iso.slice(0, 10) : undefined);

function matchesKeywords(team: Team, ...texts: string[]): boolean {
  const hay = texts.join(" ").toLowerCase();
  return TEAM_SIGNALS[team].githubMilestoneKeywords.some((k) => hay.includes(k.toLowerCase()));
}

// "moved from Oct 21" with due 2026-11-04 -> "2026-10-21"
function parsePreviousDueDate(description: string, dueDate: string | undefined): string | undefined {
  const m = /moved from ([A-Z][a-z]{2,8}) (\d{1,2})/i.exec(description);
  if (!m || !dueDate) return undefined;
  const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (idx < 0) return undefined;
  const mm = String(idx + 1).padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${dueDate.slice(0, 4)}-${mm}-${dd}`;
}

class FetchFailed extends Error {}

async function getJson(f: typeof fetch, url: string, token: string): Promise<any> {
  let res: Response;
  try {
    res = await f(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "trueup",
      },
    });
  } catch (err) {
    throw new FetchFailed(`network error for ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new FetchFailed(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function milestoneSignals(team: Team, repo: string, items: any[], w: { from: string; to: string }): Signal[] {
  const out: Signal[] = [];
  for (const ms of items) {
    if (!matchesKeywords(team, ms.title ?? "")) continue;
    const dueDate = dateOf(ms.due_on);
    const updated = dateOf(ms.updated_at);
    if (!(inWindow(dueDate, w) || inWindow(dateOf(ms.created_at), w) || inWindow(updated, w))) continue;
    const description: string = ms.description ?? "";
    const due = dueDate ?? "unscheduled";
    const signal: Signal = {
      id: `gh:milestone:${repo}:${ms.number}`,
      source: "github",
      kind: "milestone",
      team,
      date: updated ?? dateOf(ms.created_at) ?? w.to,
      text: `Milestone '${ms.title}' due ${due}${description.trim() ? `: ${description}` : ""}`,
      url: ms.html_url,
    };
    if (ms.creator?.login) signal.author = ms.creator.login;
    if (dueDate) signal.dueDate = dueDate;
    const prev = parsePreviousDueDate(description, dueDate);
    if (prev) signal.previousDueDate = prev;
    out.push(signal);
  }
  return out;
}

function releaseSignals(team: Team, repo: string, items: any[], w: { from: string; to: string }): Signal[] {
  const out: Signal[] = [];
  for (const r of items) {
    const label: string = r.name || r.tag_name || "";
    const date = dateOf(r.published_at);
    if (!inWindow(date, w) || !matchesKeywords(team, label, r.tag_name ?? "")) continue;
    const signal: Signal = {
      id: `gh:release:${repo}:${r.id ?? r.tag_name}`,
      source: "github",
      kind: "release",
      team,
      date: date!,
      text: `Release ${label}: ${(r.body ?? "").slice(0, 200)}`,
      url: r.html_url,
    };
    if (r.author?.login) signal.author = r.author.login;
    out.push(signal);
  }
  return out;
}

function prSignals(team: Team, repo: string, items: any[], w: { from: string; to: string }): Signal[] {
  const out: Signal[] = [];
  for (const pr of items) {
    const labels: string[] = (pr.labels ?? []).map((l: any) => l.name);
    const date = dateOf(pr.closed_at);
    if (!inWindow(date, w) || !matchesKeywords(team, pr.title ?? "", ...labels)) continue;
    const signal: Signal = {
      id: `gh:pr:${repo}:${pr.number}`,
      source: "github",
      kind: "pr",
      team,
      date: date!,
      text: `PR #${pr.number} ${pr.title}`,
      url: pr.html_url,
      labels,
    };
    if (pr.user?.login) signal.author = pr.user.login;
    out.push(signal);
  }
  return out;
}

async function readFixture(team: Team, w: { from: string; to: string }, path: string): Promise<Signal[]> {
  let all: Signal[];
  try {
    all = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(all)) return [];
  return all.filter((s) => s.team === team && (inWindow(s.date, w) || inWindow(s.dueDate, w)));
}

export async function readGithubSignals(team: Team, month: Month, deps: Deps = {}): Promise<Signal[]> {
  const repos = TEAM_SIGNALS[team].githubRepos;
  if (repos.length === 0) return [];

  const w = windowFor(month);
  const log = deps.log ?? ((msg: string) => console.warn(msg));
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  const fixture = () => readFixture(team, w, deps.fixturePath ?? DEFAULT_FIXTURE);

  if (!token) {
    log("github: no GITHUB_TOKEN, using fixture signals");
    return fixture();
  }

  const f = deps.fetch ?? globalThis.fetch;
  const out: Signal[] = [];
  try {
    for (const repo of repos) {
      const milestones = await getJson(f, `${API}/repos/${repo}/milestones?state=all&per_page=100`, token);
      out.push(...milestoneSignals(team, repo, milestones, w));

      const releases = await getJson(f, `${API}/repos/${repo}/releases?per_page=30`, token);
      out.push(...releaseSignals(team, repo, releases, w));

      const q = `repo:${repo}+is:pr+is:merged+merged:${w.from}..${w.to}`;
      const search = await getJson(f, `${API}/search/issues?q=${q}&per_page=50`, token);
      out.push(...prSignals(team, repo, search.items ?? [], w));
    }
  } catch (err) {
    log(`github: ${(err as Error).message}, using fixture signals`);
    return fixture();
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
