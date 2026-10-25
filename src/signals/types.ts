// OWNER: D — raw evidence collected from Slack and GitHub before any inference.
import type { Team } from "../shared/types.js";

export type SignalKind = "message" | "milestone" | "release" | "pr";

export type Signal = {
  id: string; // "slack:C123:1729790000.0001", "gh:milestone:owner/repo:7"
  source: "slack" | "github";
  kind: SignalKind;
  team: Team;
  date: string; // YYYY-MM-DD the signal was created (UTC)
  text: string; // message text, or "Milestone 'Support agent v2 launch' due 2026-10-27: <description>"
  url: string;
  author?: string;
  dueDate?: string; // milestones only
  previousDueDate?: string; // milestones only, when known to have moved
  labels?: string[]; // PRs only
};

export type EventKind = "launch" | "campaign" | "load_test" | "deprecation";
