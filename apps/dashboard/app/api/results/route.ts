import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function GET() {
  try { return new Response(await readFile(resolve(process.cwd(), "../../artifacts/benchmark/latest.json"), "utf8"), { headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
  catch { return Response.json({ setups: [], rows: [], mode: "No benchmark run yet. Run pnpm bench." }); }
}
