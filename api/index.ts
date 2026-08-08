import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../packages/server/src/app.js";
import { ensureSchema, openDb } from "../packages/server/src/db.js";
import { createVisionService } from "../packages/server/src/services/visionService.js";

/**
 * Vercel Function entrypoint for the whole API. Every request under /api/*
 * is routed here by an explicit rewrite in vercel.json (`/api/:path*` →
 * `/api`) rather than relying on the `[...path].ts` filename convention —
 * that convention turned out not to reliably match multi-segment paths
 * (e.g. `/api/sessions/:id` 404'd at the platform level while `/api/sessions`
 * worked) in this project's setup, so routing is now explicit instead of
 * inferred from the filename.
 *
 * The request then hands straight to the existing Express app unchanged
 * (the app's own routes are already mounted under /api/..., so no path
 * rewriting is needed on this end — Vercel preserves the original request
 * URL in `req.url` even after a rewrite). This is deliberately a thin
 * wrapper, not a rewrite of the app itself: the same Express app also runs
 * as a traditional long-running process via packages/server/src/index.ts —
 * only the entrypoint differs.
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
    })().catch((err) => {
      // Don't cache a failed init — a transient DB hiccup (e.g. Supabase
      // waking up) would otherwise permanently 500 every request for the
      // rest of this warm container's lifetime. Let the next request retry.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

function setCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Answer CORS preflight immediately, without touching the database — a
  // slow/failed DB connection must never take down preflight, or the
  // browser reports a bare "CORS error" that hides the real cause.
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const app = await getApp();
    app(req, res);
  } catch (err) {
    // getApp() failed (e.g. bad/missing DATABASE_URL, DB unreachable) before
    // the Express app — and its own cors() middleware — ever got a chance to
    // run. Set CORS headers by hand so the browser surfaces the real error
    // instead of a misleading CORS failure.
    console.error("Failed to initialize app:", err);
    setCorsHeaders(res);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Unknown error" }));
  }
}
