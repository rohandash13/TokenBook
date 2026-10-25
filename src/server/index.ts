// OWNER: C
import express from 'express';

try { process.loadEnvFile(); } catch { /* no .env — fine offline */ }

const app = express();
app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`TrueUp API on http://localhost:${port}`));
