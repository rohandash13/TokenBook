import { appendFileSync, existsSync, readFileSync } from "node:fs";
/** Sequential model calls with a persistent conservative pre-charge. Failed requests also consume the reservation. */
export class BudgetedModel {
  spentUsd: number;
  constructor(private opts: { key: string; model: string; inputPrice: number; outputPrice: number; capUsd: number; ledger: string }) {
    for (const n of [opts.inputPrice, opts.outputPrice, opts.capUsd]) if (!Number.isFinite(n) || n <= 0) throw new Error("live prices and cap must be positive finite numbers");
    this.spentUsd = existsSync(opts.ledger) ? readFileSync(opts.ledger, "utf8").trim().split("\n").filter(Boolean).reduce((n,line) => n + JSON.parse(line).reservedUsd, 0) : 0;
  }
  async verdict(input: unknown) {
    const text = JSON.stringify(input);
    const maxTokens = 256;
    // Bytes bound token count conservatively; margin covers system and message framing.
    const reservedUsd = ((Buffer.byteLength(text, "utf8") + 4096) * this.opts.inputPrice + maxTokens * this.opts.outputPrice) / 1e6;
    if (!(this.spentUsd + reservedUsd <= this.opts.capUsd)) throw new Error("authorized API cost cap reached");
    appendFileSync(this.opts.ledger, JSON.stringify({ at: new Date().toISOString(), reservedUsd }) + "\n");
    this.spentUsd += reservedUsd;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": this.opts.key },
      body: JSON.stringify({ model: this.opts.model, max_tokens: maxTokens, system: 'Judge this payment from its task, plan, payment and agent reason. Reply only JSON: {"verdict":"approve"|"hold"|"block"}.', messages: [{ role: "user", content: text }] }),
    });
    if (!response.ok) throw new Error(`baseline model HTTP ${response.status}`);
    const body = await response.json() as any;
    const output = body.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") ?? "";
    const parsed = JSON.parse(output);
    if (!["approve", "hold", "block"].includes(parsed.verdict)) throw new Error("invalid baseline verdict");
    const usage = body.usage;
    const costUsd = typeof usage?.input_tokens === "number" && typeof usage?.output_tokens === "number" ? (usage.input_tokens * this.opts.inputPrice + usage.output_tokens * this.opts.outputPrice) / 1e6 : null;
    return { verdict: parsed.verdict as "approve" | "hold" | "block", costUsd };
  }
}
