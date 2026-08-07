import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
// Type-only import: fully erased at compile time, so it never triggers
// runtime module resolution and is safe under every bundler/test runner.
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// node:sqlite ships as an experimental built-in since Node 22.5 — no native
// module compilation required, which keeps the MVP dependency-free and easy
// to run anywhere Node itself runs. Loaded via createRequire (rather than a
// static `import`) because it's new enough that some bundlers/test runners
// (e.g. Vite's module graph, which vitest uses) don't yet recognize it as a
// builtin and mis-resolve the static specifier.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};

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
  session_id TEXT NOT NULL REFERENCES sessions(id),
  challenge_number INTEGER NOT NULL,
  initiator TEXT NOT NULL,
  status TEXT NOT NULL,
  blue_photo_hash TEXT,
  blue_rank TEXT,
  blue_confidence REAL,
  blue_photo_path TEXT,
  red_photo_hash TEXT,
  red_rank TEXT,
  red_confidence REAL,
  red_photo_path TEXT,
  result_type TEXT,
  result_winner TEXT,
  result_loser TEXT,
  result_reason TEXT,
  previous_hash TEXT,
  record_hash TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(session_id, challenge_number)
);

CREATE INDEX IF NOT EXISTS idx_challenges_session ON challenges(session_id, challenge_number);
`;

export function openDb(dbPath: string): DatabaseSyncType {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export type { DatabaseSyncType as DatabaseSync };
