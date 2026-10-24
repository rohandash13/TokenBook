import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BudgetedModel } from "../src/budgeted-model";
it("refuses a call exceeding the cap before network or ledger write", async () => {
  const fetchSpy = vi.spyOn(globalThis,"fetch");
  const model = new BudgetedModel({ key: "unit-test-key", model: "unit-test-model", inputPrice: 1, outputPrice: 1, capUsd: .000001, ledger: join(tmpdir(), `countersign-budget-${randomUUID()}.jsonl`) });
  await expect(model.verdict({ payment: "test" })).rejects.toThrow("cap reached");
  expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
});
