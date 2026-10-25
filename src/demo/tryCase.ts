// OWNER: D — black-box oracle for red-teaming: run one case through TrueUp and print only the verdict.
//   npx tsx src/demo/tryCase.ts path/to/cases.json [--deterministic]
// The file is an EvalCaseFile[] (see src/demo/evalCases.ts). Prints, per case, what TrueUp would book
// and the guard's drop reasons — never code or prompts.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getLlm } from "../llm/client.js";
import { inferDrivers } from "../llm/inferDrivers.js";
import type { EvalCaseFile } from "./evalCases.js";

async function main() {
  try { process.loadEnvFile?.(); } catch { /* no .env */ }
  const file = process.argv[2];
  if (!file) throw new Error("usage: tryCase.ts <cases.json> [--deterministic]");
  const llm = process.argv.includes("--deterministic") ? null : getLlm();
  const cases = JSON.parse(readFileSync(file, "utf8")) as EvalCaseFile[];
  for (const c of cases) {
    const r = await inferDrivers(c.team, c.month, c.signals, llm, c.asOf);
    console.log(JSON.stringify({
      id: c.id,
      booked: r.events.map((e) => ({ date: e.date, multiplier: e.multiplier, note: e.note, cites: e.evidence?.map((v) => v.id) })),
      dropped: r.dropped.map((d) => d.reason),
    }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
}
