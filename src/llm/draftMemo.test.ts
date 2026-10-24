// OWNER: D
import { describe, expect, it } from "vitest";
import type { MemoInput } from "../shared/types.js";
import type { LlmClient } from "./client.js";
import { draftMemo, numbersAllowed, numbersIn, placeholderMemo } from "./draftMemo.js";

const input: MemoInput = {
  team: "support",
  month: "2026-10",
  estimate: 8940,
  actual: 10040,
  variancePct: 12.304,
  basis: "Run-rate on Oct 1-24 plus launch on 2026-10-27 at 3x per Priya",
  quote: "We launch the new agent on Oct 27, expect about 3x traffic (2026-10-24T15:02:00Z)",
  approvedBy: "Dana",
  sources: ["Anthropic usage API, 2026-10", "Slack reply from Priya", "JE-2026-10-accrual-support"],
};

const NOW = "2026-11-03T09:00:00.000Z";
const fake = (...replies: (string | Error)[]): LlmClient & { calls: number } => {
  const c = {
    calls: 0,
    async complete() {
      const r = replies[Math.min(c.calls++, replies.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return c;
};

const clean =
  "Support accrued $8,940 for 2026-10 against an actual of $10,040, a variance of $1,100 (12.3%) over. " +
  "The estimate used run-rate plus the Oct 27 launch at 3x. Priya said traffic would rise. Approved by Dana.";

describe("numbersIn", () => {
  it("parses money, decimals, percents and negatives", () => {
    expect(numbersIn("$10,040 and 10,040.00 and 12.4% and -12.4% and 7")).toEqual([10040, 10040, 12.4, 12.4, 7]);
  });
});

describe("draftMemo", () => {
  it("uses the placeholder when there is no LLM", async () => {
    const memo = await draftMemo(input, null, () => NOW);
    expect(memo.text).toBe(placeholderMemo(input));
    expect(memo.createdAt).toBe(NOW);
    expect(memo.team).toBe("support");
  });

  it("keeps a clean draft verbatim", async () => {
    const memo = await draftMemo(input, fake(clean), () => NOW);
    expect(memo.text).toBe(clean);
  });

  it("rejects a draft with an invented number", async () => {
    const llm = fake(clean.replace("$1,100", "$12,345"));
    const memo = await draftMemo(input, llm, () => NOW);
    expect(memo.text).toBe(placeholderMemo(input));
    expect(llm.calls).toBe(2);
  });

  it("retries once after a guard failure", async () => {
    const memo = await draftMemo(input, fake("Spend rose 45% on 400 new users.", clean), () => NOW);
    expect(memo.text).toBe(clean);
  });

  it("falls back when the LLM throws", async () => {
    const memo = await draftMemo(input, fake(new Error("network")), () => NOW);
    expect(memo.text).toBe(placeholderMemo(input));
  });

  it("allows dates that appear in the basis and quote", () => {
    expect(numbersAllowed("Launch on Oct 27 (2026-10-27), 3x, reply at 15:02.", input)).toBe(true);
    expect(numbersAllowed("Daily run-rate of $362.", input)).toBe(false);
  });
});

describe("placeholderMemo", () => {
  const text = placeholderMemo(input);

  it("passes its own number guard", () => {
    expect(numbersAllowed(text, input)).toBe(true);
  });

  it("contains every input number, the basis, quote, approver and every source", () => {
    for (const s of ["$8,940", "$10,040", "$1,100", "12.3%", input.basis, input.quote!, "Dana"]) {
      expect(text).toContain(s);
    }
    for (const s of input.sources) expect(text).toContain(s);
    expect(text).toMatch(/Next month/);
  });

  it("is deterministic and handles an under-accrual with no quote", () => {
    const under: MemoInput = { ...input, actual: 7000, variancePct: -21.7, quote: undefined };
    const t = placeholderMemo(under);
    expect(t).toBe(placeholderMemo(under));
    expect(t).toContain("$1,940 (21.7%) under");
    expect(numbersAllowed(t, under)).toBe(true);
  });
});
