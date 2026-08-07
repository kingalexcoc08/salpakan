import { Pool } from "pg";

/**
 * Minimal query interface both a real `pg.Pool` (production, pointed at
 * Supabase Postgres) and the in-memory `pg-mem` adapter used in tests
 * satisfy — the stores only ever depend on this, never on `pg` directly, so
 * swapping the backing database doesn't touch a single query call site.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Timestamps are TEXT, not a native Postgres timestamp type — deliberately.
// The hash chain (spec §5.3) hashes each record's exact field values,
// including the timestamp string generated in JS at write time. Postgres's
// timestamp types reformat on storage/read (different separator, timezone
// notation, precision), so a value read back would not be byte-identical to
// what was written and would silently break every hash recomputation ever
// after. TEXT stores exactly the string handed to it, nothing more — same
// reasoning as the original SQLite schema this replaces.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  capture_mode TEXT NOT NULL,
  flag_vs_flag_rule TEXT NOT NULL,
  status TEXT NOT NULL,
  blue_name TEXT,
  red_name TEXT,
  blue_token TEXT,
  red_token TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  challenge_number INTEGER NOT NULL,
  initiator TEXT NOT NULL,
  status TEXT NOT NULL,
  blue_photo_hash TEXT,
  blue_rank TEXT,
  blue_confidence DOUBLE PRECISION,
  blue_photo_path TEXT,
  red_photo_hash TEXT,
  red_rank TEXT,
  red_confidence DOUBLE PRECISION,
  red_photo_path TEXT,
  result_type TEXT,
  result_winner TEXT,
  result_loser TEXT,
  result_reason TEXT,
  previous_hash TEXT,
  record_hash TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (session_id, challenge_number)
);

CREATE INDEX IF NOT EXISTS idx_challenges_session ON challenges (session_id, challenge_number);
`;

/**
 * Opens a connection pool to a real Postgres database — e.g. Supabase's
 * "Transaction pooler" URI, which is the right choice for a serverless host
 * like Vercel Functions (short-lived invocations, no durable local process
 * to hold a single long-lived connection). Safe to construct once per
 * process/module and reuse across requests.
 */
export function openDb(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // Supabase's pooled endpoint terminates TLS in front of the pooler;
    // this mirrors Supabase's own connection examples for the `pg` package.
    ssl: { rejectUnauthorized: false },
  });
}

/**
 * Idempotently ensures the schema exists. A no-op in steady state against a
 * project that's already been migrated (e.g. via Supabase's own migration
 * tooling), but lets any other Postgres target — local dev, or the
 * in-memory pg-mem instance used in tests — bootstrap itself from nothing.
 */
export async function ensureSchema(db: Queryable): Promise<void> {
  await db.query(SCHEMA);
}
