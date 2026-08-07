import { newDb } from "pg-mem";
import { ensureSchema, type Queryable } from "../src/db.js";

/**
 * Builds a fresh, fully in-memory Postgres-compatible database for a single
 * test (or test file). Runs the exact same schema/SQL the app runs against
 * real Postgres — pg-mem parses and executes real SQL rather than faking
 * the store's behavior — so these tests exercise the real query text
 * without needing network access or live Supabase credentials.
 */
export async function createTestDb(): Promise<Queryable> {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool() as unknown as Queryable;
  await ensureSchema(pool);
  return pool;
}
