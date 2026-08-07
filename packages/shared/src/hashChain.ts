import type { ChainVerificationResult, MatchRecord, MatchRecordContent } from "./types.js";

export const GENESIS_HASH = "GENESIS";

/**
 * SHA-256 hex digest of a UTF-8 string. Uses the Web Crypto API
 * (`crypto.subtle`), available as a global in both modern Node (>=19) and
 * browsers, so this module works unmodified in the server and the PWA.
 */
export async function sha256Hex(input: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(input));
}

/**
 * SHA-256 hex digest of raw bytes (e.g. an uploaded photo's contents).
 * Used for the photo-integrity hashes in each match record (spec §5.3) —
 * hashing the bytes directly, not any string encoding of them.
 */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Deterministic canonical JSON (sorted keys at every level) so the same
 * logical content always hashes to the same value regardless of key
 * insertion order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Computes the hash for a match record given its content (everything but
 * `recordHash`) — the content's canonical JSON is hashed together with
 * `previousHash`, which is already embedded in `content`.
 */
export async function computeRecordHash(content: MatchRecordContent): Promise<string> {
  return sha256Hex(canonicalize(content));
}

/**
 * Builds a complete, hash-chained MatchRecord: fills in `previousHash` from
 * the prior record (or GENESIS_HASH for the first) and computes `recordHash`.
 */
export async function appendRecord(
  previous: MatchRecord | null,
  content: Omit<MatchRecordContent, "previousHash">,
): Promise<MatchRecord> {
  const previousHash = previous ? previous.recordHash : GENESIS_HASH;
  const fullContent: MatchRecordContent = { ...content, previousHash };
  const recordHash = await computeRecordHash(fullContent);
  return { ...fullContent, recordHash };
}

/**
 * Walks the full log verifying that:
 *  1. Each record's `previousHash` matches the actual hash of the record
 *     before it (or GENESIS_HASH for the first record).
 *  2. Each record's stored `recordHash` matches a fresh recomputation from
 *     its content.
 *
 * Any mismatch means a record was altered, reordered, deleted, or forged
 * after the fact — the log is flagged as compromised (spec §5.3).
 */
export async function verifyChain(records: readonly MatchRecord[]): Promise<ChainVerificationResult> {
  let expectedPreviousHash = GENESIS_HASH;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (record.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        brokenAtIndex: i,
        reason: `Record ${i} previousHash does not match the preceding record's hash.`,
      };
    }

    const { recordHash, ...content } = record;
    const recomputed = await computeRecordHash(content);
    if (recomputed !== recordHash) {
      return {
        valid: false,
        brokenAtIndex: i,
        reason: `Record ${i} content hash does not match its stored recordHash — record was altered.`,
      };
    }

    expectedPreviousHash = recordHash;
  }

  return { valid: true };
}
