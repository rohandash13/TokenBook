export function gatewayOrigin() {
  const url = new URL(process.env.GATEWAY_URL ?? "http://127.0.0.1:4000");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Dashboard gateway must be loopback HTTP");
  return url.origin;
}
