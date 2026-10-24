import { z } from "zod";
import { normalizeCategory, toAtomic } from "@countersign/shared";

/** D27: routing is config (config/approvers.json), never code. */
export const ApproverConfigSchema = z
  .object({
    routes: z.array(
      z
        .object({
          when: z
            .object({
              category: z.string().min(1).optional(),
              maxUsd: z.number().nonnegative().optional(),
            })
            .strict(),
          approver: z.string().min(1),
        })
        .strict(),
    ),
    default: z.string().min(1),
  })
  .strict();

export type ApproverConfig = z.infer<typeof ApproverConfigSchema>;
export type ApproverRoute = ApproverConfig["routes"][number];

/** Used only when no config is passed (unit tests of createTools). main.ts always loads config/approvers.json. */
export const DEFAULT_APPROVER_CONFIG: ApproverConfig = { routes: [], default: "Sam" };

export function parseApprovers(json: unknown): ApproverConfig {
  return ApproverConfigSchema.parse(json);
}

/** First route whose every condition holds; else the default. */
export function routeHold(config: ApproverConfig, target: { category: string | null; amountUsd: number }): string {
  for (const route of config.routes) {
    const { category, maxUsd } = route.when;
    if (category !== undefined && (target.category === null || normalizeCategory(category) !== normalizeCategory(target.category))) continue;
    if (maxUsd !== undefined && toAtomic(target.amountUsd) > toAtomic(maxUsd)) continue;
    return route.approver;
  }
  return config.default;
}
