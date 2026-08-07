import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

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

  /** Where the SQLite file lives. ":memory:" is used automatically under NODE_ENV=test. */
  dbPath:
    process.env.DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : path.join(packageRoot, "data", "salpakan.sqlite")),

  /** Directory raw challenge photos are written to until purged (spec §5.3 retention). */
  uploadDir: process.env.UPLOAD_DIR ?? path.join(packageRoot, "uploads"),

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

  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};
