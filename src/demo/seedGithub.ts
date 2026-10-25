// OWNER: D
// Seeds the Northwind GitHub repos (milestones, issues, PRs, releases) from the scenario.
// Idempotent: every item is matched by title/tag and tagged with SEED_GITHUB_MARKER so `reset` can find it.
import { SEED_GITHUB_MARKER, type Scenario, type SeedRepo } from "./scenario.js";

const API = "https://api.github.com";

export type SeedGithubOpts = {
  token: string;
  fetch?: typeof fetch;
  reset?: boolean;
  dryRun?: boolean;
  log?: (m: string) => void;
  sleep?: (ms: number) => Promise<void>; // injectable delay between writes (default 250 ms)
};

export type SeedGithubResult = { milestones: number; issues: number; prs: number; releases: number; deleted: number };

type Res = { status: number; data: any; link: string | null };
type Item = Record<string, any>;

export async function seedGithub(scenario: Scenario, opts: SeedGithubOpts): Promise<SeedGithubResult> {
  const f = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const dry = !!opts.dryRun;
  const sleepFn = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const result: SeedGithubResult = { milestones: 0, issues: 0, prs: 0, releases: 0, deleted: 0 };

  async function request(method: string, path: string, body?: unknown, allow: number[] = []): Promise<Res> {
    const url = path.startsWith("http") ? path : API + path;
    const res = await f(url, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "trueup-seed",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok && !allow.includes(res.status)) {
      const msg = data && typeof data === "object" && data.message ? data.message : String(text || res.statusText);
      throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${msg}`);
    }
    return { status: res.status, data, link: res.headers.get("link") };
  }

  // Writes are skipped (and logged) in dry-run mode; otherwise throttled.
  async function write(method: string, path: string, body?: unknown, allow: number[] = []): Promise<Res | null> {
    if (dry) {
      log(`[dry-run] would ${method} ${path}`);
      return null;
    }
    await sleepFn(250);
    return request(method, path, body, allow);
  }

  async function list(path: string): Promise<Item[]> {
    const out: Item[] = [];
    let next: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    while (next) {
      const res: Res = await request("GET", next);
      if (Array.isArray(res.data)) out.push(...res.data);
      const m: RegExpExecArray | null = res.link ? /<([^>]+)>;\s*rel="next"/.exec(res.link) : null;
      next = m ? m[1] : null;
    }
    return out;
  }

  const hasMarker = (s: unknown) => typeof s === "string" && s.includes(SEED_GITHUB_MARKER);
  const withMarker = (s: string) => `${s}\n\n${SEED_GITHUB_MARKER}`;
  const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

  const defaults = new Map<string, string>();
  async function defaultBranch(r: string): Promise<string> {
    let d = defaults.get(r);
    if (!d) {
      d = (await request("GET", `/repos/${r}`)).data.default_branch as string;
      defaults.set(r, d);
    }
    return d;
  }

  // Reset: remove marked items. Returns issue numbers it closed so seeding doesn't treat them as present.
  async function resetRepo(r: string): Promise<Set<number>> {
    const closed = new Set<number>();
    for (const m of await list(`/repos/${r}/milestones?state=all`)) {
      if (!hasMarker(m.description)) continue;
      await write("DELETE", `/repos/${r}/milestones/${m.number}`, undefined, [404]);
      result.deleted++;
    }
    for (const i of await list(`/repos/${r}/issues?state=open`)) {
      if (i.pull_request || !hasMarker(i.body)) continue;
      await write("PATCH", `/repos/${r}/issues/${i.number}`, { state: "closed" });
      closed.add(i.number);
      result.deleted++;
    }
    for (const rel of await list(`/repos/${r}/releases`)) {
      if (!hasMarker(rel.body)) continue;
      await write("DELETE", `/repos/${r}/releases/${rel.id}`, undefined, [404]);
      result.deleted++;
    }
    return closed;
  }

  async function legacyCleanup(): Promise<void> {
    for (const entry of scenario.legacyCleanup) {
      const found = (await list(`/repos/${entry.repo}/milestones?state=all`)).find((m) => m.title === entry.milestoneTitle);
      if (!found) {
        log(`legacy milestone "${entry.milestoneTitle}" not found in ${entry.repo}`);
        continue;
      }
      await write("DELETE", `/repos/${entry.repo}/milestones/${found.number}`, undefined, [404]);
      result.deleted++;
    }
  }

  async function ensureLabels(sr: SeedRepo): Promise<void> {
    const names = new Set<string>();
    for (const x of [...sr.issues, ...sr.prs]) x.labels.forEach((l) => names.add(l));
    for (const name of names) {
      const res = await request("GET", `/repos/${sr.repo}/labels/${encodeURIComponent(name)}`, undefined, [404]);
      if (res.status === 404) await write("POST", `/repos/${sr.repo}/labels`, { name, color: "ededed" });
    }
  }

  async function seedMilestones(sr: SeedRepo): Promise<Map<string, number>> {
    const r = sr.repo;
    const existing = await list(`/repos/${r}/milestones?state=all`);
    const numbers = new Map<string, number>();
    for (const m of existing) numbers.set(m.title, m.number);
    for (const ms of sr.milestones) {
      const payload = {
        title: ms.title,
        due_on: `${ms.dueOn}T23:59:59Z`,
        description: withMarker(ms.description),
        state: ms.state ?? "open",
      };
      const found = existing.find((m) => m.title === ms.title);
      if (found) {
        await write("PATCH", `/repos/${r}/milestones/${found.number}`, {
          due_on: payload.due_on,
          description: payload.description,
          state: payload.state,
        });
      } else {
        const res = await write("POST", `/repos/${r}/milestones`, payload);
        if (res?.data?.number) numbers.set(ms.title, res.data.number);
      }
      result.milestones++;
    }
    return numbers;
  }

  async function seedIssues(sr: SeedRepo, milestones: Map<string, number>, closedByReset: Set<number>): Promise<void> {
    const r = sr.repo;
    const existing = (await list(`/repos/${r}/issues?state=all`)).filter(
      (i) => !i.pull_request && hasMarker(i.body) && !closedByReset.has(i.number),
    );
    for (const is of sr.issues) {
      if (existing.some((i) => i.title === is.title)) continue;
      const body: Record<string, unknown> = { title: is.title, body: withMarker(is.body), labels: is.labels };
      if (is.milestone) {
        const n = milestones.get(is.milestone);
        if (n) body.milestone = n;
        else if (!dry) throw new Error(`Issue "${is.title}" references unknown milestone "${is.milestone}" in ${r}`);
      }
      await write("POST", `/repos/${r}/issues`, body);
      result.issues++;
    }
  }

  async function mergePr(r: string, number: number): Promise<void> {
    await write("PUT", `/repos/${r}/pulls/${number}/merge`, { merge_method: "squash" });
  }

  async function seedPrs(sr: SeedRepo): Promise<void> {
    const r = sr.repo;
    if (!sr.prs.length) return;
    const existing = await list(`/repos/${r}/pulls?state=all`);
    for (const pr of sr.prs) {
      const found = existing.find((p) => p.title === pr.title);
      if (found) {
        if (pr.merge && found.state === "open" && !found.merged_at) {
          await mergePr(r, found.number);
          result.prs++;
        }
        continue;
      }
      const base = await defaultBranch(r);
      const ref = await request("GET", `/repos/${r}/git/ref/heads/${encPath(base)}`);
      const sha = ref.data.object.sha as string;
      const branchRes = await write("POST", `/repos/${r}/git/refs`, { ref: `refs/heads/${pr.branch}`, sha }, [422]);
      if (branchRes && branchRes.status === 422 && !/already exists/i.test(String(branchRes.data?.message))) {
        throw new Error(`GitHub POST /repos/${r}/git/refs failed: 422 ${branchRes.data?.message}`);
      }
      const filePath = `/repos/${r}/contents/${encPath(pr.file)}`;
      const cur = await request("GET", `${filePath}?ref=${encodeURIComponent(pr.branch)}`, undefined, [404]);
      const put: Record<string, unknown> = {
        message: `seed: ${pr.title}`,
        content: Buffer.from(pr.content, "utf8").toString("base64"),
        branch: pr.branch,
      };
      if (cur.status !== 404 && cur.data?.sha) put.sha = cur.data.sha;
      await write("PUT", filePath, put);
      const created = await write("POST", `/repos/${r}/pulls`, {
        title: pr.title,
        head: pr.branch,
        base,
        body: withMarker(pr.body),
      });
      const number = created?.data?.number as number | undefined;
      if (pr.labels.length) await write("POST", `/repos/${r}/issues/${number ?? "{number}"}/labels`, { labels: pr.labels });
      if (pr.merge) await mergePr(r, number ?? ("{number}" as unknown as number));
      result.prs++;
    }
  }

  async function seedReleases(sr: SeedRepo): Promise<void> {
    const r = sr.repo;
    for (const rel of sr.releases) {
      const cur = await request("GET", `/repos/${r}/releases/tags/${encodeURIComponent(rel.tag)}`, undefined, [404]);
      if (cur.status !== 404) continue;
      await write("POST", `/repos/${r}/releases`, {
        tag_name: rel.tag,
        name: rel.name,
        body: withMarker(rel.body),
        target_commitish: await defaultBranch(r),
      });
      result.releases++;
    }
  }

  const closedByRepo = new Map<string, Set<number>>();
  if (opts.reset) {
    for (const sr of scenario.repos) closedByRepo.set(sr.repo, await resetRepo(sr.repo));
  }
  await legacyCleanup();
  for (const sr of scenario.repos) {
    log(`seeding ${sr.repo}`);
    await ensureLabels(sr);
    const milestones = await seedMilestones(sr);
    await seedIssues(sr, milestones, closedByRepo.get(sr.repo) ?? new Set());
    await seedPrs(sr);
    await seedReleases(sr);
  }
  return result;
}
