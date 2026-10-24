import { installNetGuard } from "../../src/net-guard";

const gateway = process.env.GATEWAY_URL!;
const target = process.argv[2]!;
installNetGuard(gateway);

const out: Record<string, unknown> = { envKeys: Object.keys(process.env) };
try {
  await fetch(target);
  out.target = "reached";
} catch (e) {
  out.target = "blocked";
  out.targetError = (e as Error).message;
}
try {
  out.gateway = (await fetch(new URL("/health", gateway))).status;
} catch (e) {
  out.gateway = `error: ${(e as Error).message}`;
}
console.log(JSON.stringify(out));
