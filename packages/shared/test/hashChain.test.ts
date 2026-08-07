import { describe, expect, it } from "vitest";
import { appendRecord, GENESIS_HASH, sha256Hex, verifyChain } from "../src/hashChain.js";
import { Rank } from "../src/ranks.js";
import type { MatchRecord, MatchRecordContent, PlayerSubmission } from "../src/types.js";

function submission(rank: Rank, hash: string): PlayerSubmission {
  return { photoHash: hash, recognizedRank: rank, confidence: 0.97 };
}

function baseContent(n: number, previousHash: string): Omit<MatchRecordContent, "previousHash"> {
  return {
    sessionId: "session-1",
    challengeNumber: n,
    timestamp: new Date(2026, 0, 1, 12, 0, n).toISOString(),
    blue: submission(Rank.Captain, `blue-hash-${n}`),
    red: submission(Rank.Major, `red-hash-${n}`),
    initiator: "BLUE",
    result: { type: "win", winner: "RED", loser: "BLUE", reason: "Major outranks Captain." },
  };
}

describe("sha256Hex", () => {
  it("produces a stable, well-formed hex digest", async () => {
    const hash = await sha256Hex("hello world");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("hello world")).toBe(hash);
  });

  it("produces different digests for different input", async () => {
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });
});

describe("appendRecord / verifyChain", () => {
  it("chains the first record to GENESIS_HASH", async () => {
    const record = await appendRecord(null, baseContent(1, GENESIS_HASH));
    expect(record.previousHash).toBe(GENESIS_HASH);
    expect(record.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains each subsequent record to the previous record's hash", async () => {
    const r1 = await appendRecord(null, baseContent(1, GENESIS_HASH));
    const r2 = await appendRecord(r1, baseContent(2, r1.recordHash));
    expect(r2.previousHash).toBe(r1.recordHash);
  });

  it("verifies a clean, untampered chain as valid", async () => {
    const r1 = await appendRecord(null, baseContent(1, GENESIS_HASH));
    const r2 = await appendRecord(r1, baseContent(2, r1.recordHash));
    const r3 = await appendRecord(r2, baseContent(3, r2.recordHash));

    const result = await verifyChain([r1, r2, r3]);
    expect(result.valid).toBe(true);
  });

  it("detects a record whose content was altered after the fact", async () => {
    const r1 = await appendRecord(null, baseContent(1, GENESIS_HASH));
    const r2 = await appendRecord(r1, baseContent(2, r1.recordHash));

    const tampered: MatchRecord = {
      ...r2,
      // Attacker flips the recognized rank post-hoc without recomputing the hash.
      blue: { ...r2.blue, recognizedRank: Rank.FiveStarGeneral },
    };

    const result = await verifyChain([r1, tampered]);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
  });

  it("detects a record whose result was altered after the fact", async () => {
    const r1 = await appendRecord(null, baseContent(1, GENESIS_HASH));
    const tampered: MatchRecord = {
      ...r1,
      result: { type: "win", winner: "BLUE", loser: "RED", reason: "forged" },
    };
    const result = await verifyChain([tampered]);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it("detects a deleted/reordered record by the broken previousHash link", async () => {
    const r1 = await appendRecord(null, baseContent(1, GENESIS_HASH));
    const r2 = await appendRecord(r1, baseContent(2, r1.recordHash));
    const r3 = await appendRecord(r2, baseContent(3, r2.recordHash));

    // Remove r2 from the middle of the log — r3.previousHash no longer matches r1.recordHash.
    const result = await verifyChain([r1, r3]);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
  });

  it("detects a forged recordHash that doesn't match recomputed content", async () => {
    const r1 = await appendRecord(null, baseContent(1, GENESIS_HASH));
    const forged: MatchRecord = { ...r1, recordHash: "0".repeat(64) };
    const result = await verifyChain([forged]);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it("treats an empty log as trivially valid", async () => {
    const result = await verifyChain([]);
    expect(result.valid).toBe(true);
  });

  it("is insensitive to object key ordering (canonicalization)", async () => {
    const content = baseContent(1, GENESIS_HASH);
    const r1 = await appendRecord(null, content);

    // Re-append the same logical content but with keys constructed in a
    // different order — should hash identically.
    const reordered: Omit<MatchRecordContent, "previousHash"> = {
      result: content.result,
      timestamp: content.timestamp,
      red: content.red,
      blue: content.blue,
      challengeNumber: content.challengeNumber,
      sessionId: content.sessionId,
      initiator: content.initiator,
    };
    const r1Reordered = await appendRecord(null, reordered);
    expect(r1Reordered.recordHash).toBe(r1.recordHash);
  });
});
