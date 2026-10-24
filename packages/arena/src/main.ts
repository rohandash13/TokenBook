import { createLegitVendor } from "./legit-vendor";

try { process.loadEnvFile(); } catch { /* no .env: rely on the shell */ }

const secret = process.env.SIM_PAYER_SECRET;
if (!secret) throw new Error("SIM_PAYER_SECRET is required (see .env.example)");
const port = Number(process.env.ARENA_PORT ?? 4101);

createLegitVendor({ simPayerSecret: secret }).listen(port, () => {
  console.log(`[arena] legit-vendor (SIMULATED) on http://localhost:${port}`);
});
