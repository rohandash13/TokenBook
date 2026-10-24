// OWNER: C
import { defaultDeps } from './deps';
import { createApp } from './routes';

try { process.loadEnvFile(); } catch { /* no .env — fine offline */ }

const port = Number(process.env.PORT || 8787);
createApp(defaultDeps).listen(port, () => console.log(`TrueUp API on http://localhost:${port}`));
