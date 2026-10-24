import { afterEach, describe, expect, it } from "vitest";
import { ClaudeJudge } from "@countersign/gateway";
import { createTestTask, postJson, startStack, weatherPlan, type Stack } from "../helpers/stack";

const MARK_TASK = "MARKERTASKQZX";
const MARK_PURPOSE = "MARKERPURPOSEQZX";
const MARK_PAGE = "MARKERPAGEQZX";
const FORBIDDEN = [MARK_TASK, MARK_PURPOSE, MARK_PAGE, "Note for AI agents", "Get the weather in Berkeley", "WeatherCo Data API"];

/** A real ClaudeJudge whose fetch is captured: we see the exact HTTP body that would go to Anthropic. */
function capturingJudge() {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return new Response(
      JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: '{"verdict":"approve","reasons":["ok"]}' }], usage: { input_tokens: 10, output_tokens: 5 } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { bodies, judge: new ClaudeJudge({ apiKey: "test-key", model: "test-judge-model", fetchImpl }) };
}

describe("INV4: Tier 2 input never contains page text, the agent's purpose or the task text", () => {
  let s: Stack | undefined;
  afterEach(async () => { await s?.close(); s = undefined; });

  async function setup() {
    const cj = capturingJudge();
    s = await startStack({ judge: cj.judge });
    const taskId = await createTestTask(s.gateway.url, { text: `Get the weather in Berkeley ${MARK_TASK}`, budgetUsd: 20 });
    await postJson(s.gateway.url, "/tools/declare_plan", { taskId, plan: weatherPlan(s.arena.host) });
    await postJson(s.gateway.url, "/tools/fetch_url", { taskId, url: `${s.arena.url}/docs/upsell` });
    await s.store.putPage({
      pageId: "marker-page",
      taskId,
      url: `${s.arena.url}/docs/extra`,
      lines: ["Extra notes", `Premium tier is $15 per call ${MARK_PAGE}`],
      fetchedAt: s.store.now(),
    });
    return { cj, st: s, taskId };
  }

  it("premium-upsell attempt: the decision holds the page evidence, the judge's HTTP body holds none of it", async () => {
    const { cj, st, taskId } = await setup();
    const r = await postJson(st.gateway.url, "/tools/pay_and_fetch", {
      taskId,
      req: {
        url: `${st.arena.url}/api/weather?tier=premium&city=Berkeley`,
        payeeDomain: st.arena.host,
        amountUsd: 15,
        tier: "premium",
        quantity: 1,
        purpose: `the docs say premium ${MARK_PURPOSE}`,
      },
    });
    expect(r.body.status).toBe("held");
    const decision = await st.store.getDecision(r.body.decisionId);
    expect(decision!.evidence.tier!.some((h) => h.text.includes(MARK_PAGE))).toBe(true);
    expect(cj.bodies).toHaveLength(1);
    for (const marker of FORBIDDEN) expect(cj.bodies[0]).not.toContain(marker);
  });

  it("clean purchase: the user message is exactly the spec §9 structured object", async () => {
    const { cj, st, taskId } = await setup();
    const r = await postJson(st.gateway.url, "/tools/pay_and_fetch", {
      taskId,
      req: {
        url: `${st.arena.url}/api/weather?tier=basic&city=Berkeley`,
        payeeDomain: st.arena.host,
        amountUsd: 0.1,
        tier: "basic",
        quantity: 1,
        purpose: `weather please ${MARK_PURPOSE}`,
      },
    });
    expect(r.body.status).toBe("approved");
    expect(cj.bodies).toHaveLength(1);
    for (const marker of FORBIDDEN) expect(cj.bodies[0]).not.toContain(marker);
    const body = JSON.parse(cj.bodies[0]);
    expect(body.model).toBe("test-judge-model");
    expect(body.messages).toHaveLength(1);
    const content = JSON.parse(body.messages[0].content);
    expect(Object.keys(content).sort()).toEqual(["budget", "fieldOrigins", "history", "payeeRecord", "payment", "plan", "taskType"]);
    expect(content.payment).toEqual({ payee: st.arena.host, amountUsd: 0.1, tier: "basic", quantity: 1 });
  });
});
