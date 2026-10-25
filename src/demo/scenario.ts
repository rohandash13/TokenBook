// OWNER: D — the synthetic Northwind Labs world that `npm run seed:demo` writes into Slack and GitHub.
// Everything here is demo data, posted by the TrueUp bot as personas and tagged so it can be wiped.
import type { Team } from "../shared/types.js";

export type Persona = {
  id: string; // "priya"
  name: string; // "Priya Raman"
  title: string; // "Support lead"
  team: Team | "finance" | "exec";
  avatar: string; // https image url (used as icon_url)
};

export type SeedChannel = {
  name: string; // "support-eng" (no #)
  purpose: string;
  teams: Team[]; // one team = team channel; several = shared channel, messages assigned by keywords
};

export type SeedMessage = {
  id: string; // stable key, "support-launch-1"
  channel: string; // channel name
  persona: string; // Persona.id
  day: string; // YYYY-MM-DD the story says it happened (Slack can't backdate; shown in text only when the text says so)
  text: string;
  replyTo?: string; // SeedMessage.id to thread under
};

export type SeedMilestone = { title: string; dueOn: string; description: string; state?: "open" | "closed" };
export type SeedIssue = { title: string; body: string; labels: string[]; milestone?: string };
export type SeedPr = { title: string; body: string; labels: string[]; branch: string; file: string; content: string; merge: boolean };
export type SeedRelease = { tag: string; name: string; body: string };
export type SeedRepo = {
  repo: string; // "nikhilrajgopal/northwind-demo"
  team: Team;
  milestones: SeedMilestone[];
  issues: SeedIssue[];
  prs: SeedPr[];
  releases: SeedRelease[];
};

export type Scenario = {
  company: string;
  month: string; // "2026-10"
  personas: Persona[];
  channels: SeedChannel[];
  messages: SeedMessage[];
  repos: SeedRepo[];
  // Pre-existing hand-made items the seeder removes so they don't contradict the story.
  legacyCleanup: { repo: string; milestoneTitle: string }[];
  // What TrueUp should conclude for each team after reading everything; used by tests and the demo script.
  expected: Record<Team, { events: { date: string; multiplier: number; note: string }[]; why: string }>;
};

// Tag on every seeded Slack message (chat.postMessage `metadata`) and GitHub item (body footer) so reset can find them.
export const SEED_EVENT_TYPE = "trueup_seed";
export const SEED_GITHUB_MARKER = "<!-- trueup-seed -->";
