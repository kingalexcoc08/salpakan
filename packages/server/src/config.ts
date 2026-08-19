import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

// Vercel sets VERCEL=1 on every deployed function. Its filesystem is
// read-only everywhere except os.tmpdir() (/tmp) — writing anywhere else
// (e.g. a folder under the deployed code itself) throws EROFS/ENOENT on
// every single request. Detecting this automatically means production
// doesn't depend on someone remembering to set UPLOAD_DIR by hand.
const defaultUploadDir = process.env.VERCEL ? path.join(os.tmpdir(), "salpakan-uploads") : path.join(packageRoot, "uploads");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: envInt("PORT", 4000),

  /**
   * Postgres connection string — e.g. Supabase's "Transaction pooler" URI.
   * Required outside of tests (which run against an in-memory pg-mem
   * instance instead — see test/testDb.ts). No longer node:sqlite / a local
   * file: a serverless host (Vercel Functions) has no durable local disk
   * between invocations, so persistence has to live in a real database.
   */
  databaseUrl: process.env.DATABASE_URL ?? "",

  /**
   * Directory raw challenge photos are written to until purged (spec §5.3
   * retention). NOTE: this is local disk, which does NOT persist across
   * invocations on a serverless host — on Vercel it defaults to /tmp (see
   * defaultUploadDir above), the only writable path there, but /tmp is
   * wiped between cold starts. Fine for a traditional long-running host;
   * needs to move to object storage (e.g. Supabase Storage) for photos to
   * durably survive on Vercel Functions — tracked as a follow-up, not yet
   * done.
   */
  uploadDir: process.env.UPLOAD_DIR ?? defaultUploadDir,

  /** Recognition confidence below this triggers a "please retake the photo" response (spec §5.1). */
  confidenceThreshold: envFloat("CONFIDENCE_THRESHOLD", 0.75),

  /** Reject uploads larger than this to keep payloads small on flaky venue wifi (spec §6). */
  maxPhotoBytes: envInt("MAX_PHOTO_BYTES", 8 * 1024 * 1024),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicVisionModel: process.env.ANTHROPIC_VISION_MODEL ?? "claude-sonnet-5",

  /**
   * "anthropic" calls the real Claude vision API (requires ANTHROPIC_API_KEY).
   * "stub" is a deterministic offline fallback for local dev/demo/tests when
   * no API key is configured — see services/visionService.ts.
   */
  visionProvider: (process.env.VISION_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "stub")) as
    | "anthropic"
    | "stub",

  /**
   * How many few-shot reference images (rankReferences.ts) to attach to each
   * recognition call (spec update "Fix Low Recognition Accuracy" §2.2):
   * "none" (cheapest), "grouped" (one per rank-encoding family — the spec's
   * suggested fallback if attaching all 15 is too expensive/slow), or "full"
   * (one per rank). Defaults to "grouped". Has no effect at all while
   * REFERENCE_IMAGES is empty (no real photos loaded yet) — every mode
   * degrades to "none" until reference photos are populated.
   */
  visionReferenceMode: (process.env.VISION_REFERENCE_MODE ?? "grouped") as "none" | "grouped" | "full",

  /**
   * Safety-net cap (longest side, in pixels) for images sent to the vision
   * API and saved to disk — normalizeImage() downscales anything larger
   * server-side (spec §2.3), independent of whatever preprocessing the
   * client already did. A no-op for images already under this size.
   */
  maxUploadDimension: envInt("MAX_UPLOAD_DIMENSION", 1600),

  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  /**
   * Secret used to sign the short-lived "recognition confirmation" token
   * (see submissionToken.ts) that lets a client hold onto an unconfirmed
   * recognition result between the preview and confirm requests without the
   * server persisting anything in between. Falls back to the (already
   * required in production) database URL so this works without any extra
   * manual Vercel configuration — clients never see DATABASE_URL, so it's
   * still unguessable to them. Only the final, dev-only fallback is ever a
   * predictable value, and that path never runs in production (DATABASE_URL
   * is required there).
   */
  submissionTokenSecret: process.env.SUBMISSION_TOKEN_SECRET ?? "",
};
