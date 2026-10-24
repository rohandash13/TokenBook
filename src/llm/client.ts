// OWNER: D
// Thin wrapper over the Anthropic SDK. Everything else in src/llm takes an
// LlmClient so tests can pass a fake and the app runs with no API key.
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export type LlmClient = {
  complete(system: string, user: string): Promise<string>;
};

/** Returns null when ANTHROPIC_API_KEY or ANTHROPIC_MODEL is unset; callers must fall back. */
export function getLlm(env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL;
  if (!apiKey || !model) return null;
  const sdk = new Anthropic({ apiKey });
  return {
    async complete(system, user) {
      const res = await sdk.messages.create({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
      });
      return res.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
    },
  };
}

/** Pulls the first JSON object out of a reply, tolerating ```json fences and surrounding prose. */
export function parseJsonLoose(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Asks for JSON, validates it with zod, retries once on any failure, then returns null.
 * Never throws: a null result means "use the deterministic fallback".
 */
export async function completeJson<T>(
  llm: LlmClient | null,
  system: string,
  user: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  if (!llm) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = schema.safeParse(parseJsonLoose(await llm.complete(system, user)));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to the retry
    }
  }
  return null;
}
