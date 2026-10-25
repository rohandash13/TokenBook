// OWNER: D — prints data/eval/history.jsonl as a table, newest last. `npm run eval:history`
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { HISTORY_PATH, type HistoryLine } from "./evalCases.js";

export function readHistory(path: string = HISTORY_PATH): HistoryLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as HistoryLine);
}

const n = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));

export function formatHistory(lines: HistoryLine[]): string {
  if (lines.length === 0) return "no eval history yet";
  const headers = ["at", "sha", "set", "model", "runs", "cases", "precision", "recall", "f1", "exact"];
  const rows = lines.map((l) => [
    l.at.replace("T", " ").slice(0, 16), l.gitSha + (l.dirty ? "*" : ""), l.set, l.model, String(l.runs), String(l.cases),
    n(l.precision), n(l.recall), n(l.f1), n(l.exactMatch),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (c: string[]) => c.map((x, i) => x.padEnd(widths[i])).join(" | ").trimEnd();
  return [line(headers), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(formatHistory(readHistory()));
}
