import { createApp } from "./app.js";
import { config } from "./config.js";
import { ensureSchema, openDb } from "./db.js";
import { createVisionService } from "./services/visionService.js";

if (!config.databaseUrl) {
  console.error("DATABASE_URL is required — a Postgres connection string (e.g. Supabase's Transaction pooler URI). See README.");
  process.exit(1);
}

const db = openDb(config.databaseUrl);
await ensureSchema(db);

const visionService = createVisionService();
const app = createApp(db, visionService);

app.listen(config.port, () => {
  console.log(`Salpakan Digital Arbiter server listening on :${config.port}`);
  console.log(`Vision provider: ${config.visionProvider}`);
  if (config.visionProvider === "stub") {
    console.warn("WARNING: using the offline stub vision service — set ANTHROPIC_API_KEY for real rank recognition.");
  }
});
