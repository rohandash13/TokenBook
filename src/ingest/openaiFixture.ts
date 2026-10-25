// OWNER: B
// OpenAI usage as UsageDay[] with source "openai". Fixture only: the generator already plants OpenAI rows
// (search and platform use gpt-4.1-mini). A live OPENAI_ADMIN_KEY client is out of scope for the demo.

import type { Month, UsageDay } from "../shared/types.js";
import { loadUsage } from "./loadUsage.js";

export function openaiUsage(month: Month, asOf?: string): UsageDay[] {
  return loadUsage(month, asOf).filter((u) => u.source === "openai");
}
