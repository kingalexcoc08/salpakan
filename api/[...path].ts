import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../packages/server/src/app.js";
import { ensureSchema, openDb } from "../packages/server/src/db.js";
import { createVisionService } from "../packages/server/src/services/visionService.js";

/**
 * Vercel Function entrypoint — a catch-all under /api/* that hands every
 * request straight to the existing Express app unchanged (the app's own
 * routes are already mounted under /api/..., so no path rewriting is
 * needed). This is deliberately a thin wrapper, not a rewrite: the same
 * Express app also runs as a traditional long-running process via
 * packages/server/src/index.ts — only the entrypoint differs.
 *
 * The app (and its Postgres pool) is built once and reused across warm
 * invocations of this function, since Vercel may reuse the same container
 * for consecutive requests — cheaper than reconnecting on every request.
 */
let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required — a Postgres connection string (e.g. Supabase's Transaction pooler URI).");
      }
      const db = openDb(process.env.DATABASE_URL);
      await ensureSchema(db);
      return createApp(db, createVisionService());
    })();
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  app(req, res);
}
