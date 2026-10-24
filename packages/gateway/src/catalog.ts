import { readFileSync } from "node:fs";
import { z } from "zod";
import { normalizeCategory } from "./normalize";

/** D3: category comes from the endpoint URL, never from the agent's purpose text. */
export interface CatalogEntry {
  pathPrefix: string;
  category: string;
}

export const CatalogSchema = z.array(
  z.object({
    pathPrefix: z.string().startsWith("/"),
    category: z.string().min(1),
  }),
);

export function parseCatalog(json: unknown): CatalogEntry[] {
  return CatalogSchema.parse(json);
}

export function loadCatalogFile(path: string | URL): CatalogEntry[] {
  return parseCatalog(JSON.parse(readFileSync(path, "utf8")));
}

/** Longest pathPrefix that matches on a path-segment boundary. Not in catalog -> null (traced as UNKNOWN). */
export function categoryFor(url: string, catalog: CatalogEntry[]): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  let best: { prefix: string; category: string } | null = null;
  for (const entry of catalog) {
    const prefix = entry.pathPrefix.replace(/\/+$/, "");
    const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (hit && (!best || prefix.length > best.prefix.length)) best = { prefix, category: entry.category };
  }
  return best ? normalizeCategory(best.category) : null;
}
