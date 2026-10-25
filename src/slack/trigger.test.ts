// OWNER: D
import { describe, expect, it } from "vitest";
import * as http from "node:http";
import { handleTrigger, type TriggerDeps } from "./trigger.js";
import type { SlackClient } from "./checkin.js";
import { PendingStore } from "./extractDrivers.js";
import type { TrueUpApi } from "./api.js";

function makeTrigger(env: NodeJS.ProcessEnv = { SLACK_LEAD_SUPPORT: "U123" }): TriggerDeps & { posted: string[] } {
  const posted: string[] = [];
  const client: SlackClient = {
    conversations: { open: async ({ users }) => ({ channel: { id: `D-${users}` } }) },
    chat: { postMessage: async (args) => { posted.push(args.channel); return {}; } },
  };
  const api: TrueUpApi = {
    postContext: async () => {},
    getEstimates: async () => [],
    getActualToDate: async () => 0,
    getContexts: async () => [],
    refreshSignals: async () => {},
  };
  return { client, deps: { api, pending: new PendingStore(), env }, posted };
}

function fakeReq(method: string, url: string, body: string): http.IncomingMessage {
  const req = Object.assign(
    (async function* () { yield body; })(),
    { method, url },
  ) as unknown as http.IncomingMessage;
  return req;
}

type FakeRes = http.ServerResponse & { code: number; body: string };

function fakeRes(): FakeRes {
  const res: { code: number; body: string; headersSent: boolean; writeHead: (code: number) => FakeRes; end: (b?: string) => FakeRes } = {
    code: 0,
    body: "",
    headersSent: false,
    writeHead(code: number): FakeRes { res.code = code; return res as unknown as FakeRes; },
    end(b = ""): FakeRes { res.body = b; return res as unknown as FakeRes; },
  };
  return res as unknown as FakeRes;
}

describe("handleTrigger", () => {
  it("triggers sendCheckIn for a valid team and returns 200", async () => {
    const trigger = makeTrigger();
    const req = fakeReq("POST", "/checkin", JSON.stringify({ team: "support", month: "2026-10" }));
    const res = fakeRes();
    await handleTrigger(req, res, trigger);
    expect(res.code).toBe(200);
    expect(trigger.posted).toEqual(["D-U123"]);
  });

  it("returns 400 for an unknown team", async () => {
    const trigger = makeTrigger();
    const req = fakeReq("POST", "/checkin", JSON.stringify({ team: "finance" }));
    const res = fakeRes();
    await handleTrigger(req, res, trigger);
    expect(res.code).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const trigger = makeTrigger();
    const req = fakeReq("POST", "/checkin", "not json");
    const res = fakeRes();
    await handleTrigger(req, res, trigger);
    expect(res.code).toBe(400);
  });

  it("returns 503 when sendCheckIn throws (no lead id set)", async () => {
    const trigger = makeTrigger({});  // no env vars
    const req = fakeReq("POST", "/checkin", JSON.stringify({ team: "support" }));
    const res = fakeRes();
    await handleTrigger(req, res, trigger);
    expect(res.code).toBe(503);
  });

  it("returns 404 for unknown paths", async () => {
    const trigger = makeTrigger();
    const req = fakeReq("GET", "/health", "");
    const res = fakeRes();
    await handleTrigger(req, res, trigger);
    expect(res.code).toBe(404);
  });
});

describe("handleTrigger overview and summary", () => {
  it("POST /overview returns 200 and DMs the lead", async () => {
    const trigger = makeTrigger();
    const res = fakeRes();
    await handleTrigger(fakeReq("POST", "/overview", JSON.stringify({ team: "support", month: "2026-10" })), res, trigger);
    expect(res.code).toBe(200);
    expect(trigger.posted).toEqual(["D-U123"]);
  });

  it("POST /overview returns 400 for a bad team", async () => {
    const res = fakeRes();
    await handleTrigger(fakeReq("POST", "/overview", JSON.stringify({ team: "finance" })), res, makeTrigger());
    expect(res.code).toBe(400);
  });

  it("POST /summary returns 200 and DMs configured leads", async () => {
    const trigger = makeTrigger({ SLACK_LEAD_SUPPORT: "U123", SLACK_LEAD_GROWTH: "U456" });
    const res = fakeRes();
    await handleTrigger(fakeReq("POST", "/summary", JSON.stringify({ month: "2026-10" })), res, trigger);
    expect(res.code).toBe(200);
    expect(trigger.posted).toEqual(["D-U123", "D-U456"]);
  });

  it("POST /summary returns 400 for invalid JSON", async () => {
    const res = fakeRes();
    await handleTrigger(fakeReq("POST", "/summary", "nope"), res, makeTrigger());
    expect(res.code).toBe(400);
  });
});
