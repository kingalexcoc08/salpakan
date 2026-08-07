import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { createVisionService } from "./services/visionService.js";

const db = openDb(config.dbPath);
const visionService = createVisionService();
const app = createApp(db, visionService);

app.listen(config.port, () => {
  console.log(`Salpakan Digital Arbiter server listening on :${config.port}`);
  console.log(`Vision provider: ${config.visionProvider}`);
  if (config.visionProvider === "stub") {
    console.warn("WARNING: using the offline stub vision service — set ANTHROPIC_API_KEY for real rank recognition.");
  }
});
