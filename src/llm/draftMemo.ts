// OWNER: D
// Drafts an audit memo from MemoInput. Every number comes from the input;
// a draft containing any other number is thrown away for the template.
import type { Memo, MemoInput } from "../shared/types.js";
import { getLlm, type LlmClient } from "./client.js";

export async function draftMemo(
  input: MemoInput,
  llm: LlmClient | null = getLlm(),
  now: () => string = () => new Date().toISOString(),
): Promise<Memo> {
  // TODO(D): implement — see docs/plan-d.md task 3
  return { ...input, text: placeholderMemo(input), createdAt: now() };
}

/** Deterministic memo used when the LLM is unavailable or its draft fails the number check. */
export function placeholderMemo(input: MemoInput): string {
  // TODO(D): implement — see docs/plan-d.md task 3
  return `Variance memo for ${input.team}, ${input.month}. (placeholder)`;
}
