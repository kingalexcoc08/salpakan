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

-- Enforces "only one open challenge per session" (spec §4.2/§4.3's "one
-- challenge on the board at a time") at the database level, not just in
-- application code. Without this, two near-simultaneous create-challenge
-- requests (a double-tap, or both players tapping "New challenge" within
-- the same moment) could both pass a "SELECT ... WHERE status = 'OPEN'"
-- check before either INSERT commits, leaving a permanently orphaned
-- second OPEN row that nobody's client ever submits into — softlocking the
-- match (can't start a new challenge, can't end the game) since nothing
-- clears it. A concurrent second INSERT now fails this constraint instead,
-- and MatchStore.createChallenge() translates that into the same
-- ChallengeAlreadyOpenError the old application-level check threw.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_challenge_per_session ON challenges (session_id) WHERE status = 'OPEN';

-- Recognition accuracy feedback (spec update "Fix Low Recognition Accuracy"
-- §2.5) — a labeled example every time a player rejects a recognized rank
-- and later confirms a different one for the same piece. Deliberately NOT
-- part of the hash-chained match log: no previous_hash/record_hash columns,
-- never read by the arbitration/history/integrity-verification code paths.
-- Purely for measuring and later tuning recognition accuracy.
CREATE TABLE IF NOT EXISTS recognition_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  color TEXT NOT NULL,
  guessed_rank TEXT NOT NULL,
  guessed_confidence DOUBLE PRECISION NOT NULL,
  photo_hash TEXT NOT NULL,
  confirmed_rank TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_recognition_feedback_lookup ON recognition_feedback (session_id, challenge_id, color);
`;

/**
 * Opens a connection pool to a real Postgres database — e.g. Supabase's
 * "Transaction pooler" URI, which is the right choice for a serverless host
 * like Vercel Functions (short-lived invocations, no durable local process
 * to hold a single long-lived connection). Safe to construct once per
 * process/module and reuse across requests.
 */
export function openDb(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    // Supabase's pooled endpoint terminates TLS in front of the pooler;
    // this mirrors Supabase's own connection examples for the `pg` package.
    ssl: { rejectUnauthorized: false },
    // Serverless-appropriate limits: short-lived invocations shouldn't hold
    // a big idle pool, and a hung connection attempt shouldn't hang the
    // whole function past Vercel's own request timeout.
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  // `pg.Pool` emits 'error' on behalf of any *idle* client that errors out
  // (dropped connection, network blip, etc.) — this is separate from any
  // error a live query throws, which already rejects its own promise and is
  // handled by the caller. An EventEmitter's 'error' event with no listener
  // crashes the entire Node process, which on a serverless host takes down
  // the whole function (surfaced to users as a bare "Serverless Function has
  // crashed" page) instead of just failing the one request that hit it.
  pool.on("error", (err) => {
    console.error("Postgres pool idle client error:", err);
  });

  return pool;
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
