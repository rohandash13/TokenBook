import { gatewayOrigin } from "@/lib/gateway";
const allowed = /^admin\/(?:holds(?:\/[^/]+\/(?:approve|reject))?|rules(?:\/[^/]+\/(?:activate|reject))?|decisions(?:\/[^/]+)?|receipts|budget\/[^/]+|chain\/verify|payees|metrics)$/;
async function proxy(req: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  if (!allowed.test(path)) return Response.json({ error: { message: "route unavailable" } }, { status: 404 });
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && origin !== new URL(req.url).origin) return Response.json({ error: { message: "same-origin requests required" } }, { status: 403 });
  try {
    const upstream = await fetch(`${gatewayOrigin()}/${path}${new URL(req.url).search}`, { method: req.method, headers: { "content-type": "application/json" }, ...(req.method === "POST" ? { body: await req.text() } : {}), signal: AbortSignal.timeout(30000), redirect: "manual", cache: "no-store" });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch { return Response.json({ error: { message: "Gateway unavailable. Start pnpm demo or the gateway." } }, { status: 503 }); }
}
export { proxy as GET, proxy as POST };
