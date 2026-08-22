import { Rank, verifyChain } from "@salpakan/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { ChallengeAlreadyOpenError, ChallengeAlreadyResolvedError, ChallengeNotFoundError, MatchStore } from "../src/store/matchStore.js";
import { SessionStore } from "../src/store/sessionStore.js";
import type { Queryable } from "../src/db.js";
import { createTestDb } from "./testDb.js";

function sub(rank: Rank, hash: string) {
  return { photoHash: hash, photoPath: `/tmp/${hash}.jpg`, rank, confidence: 0.9 };
}

describe("MatchStore + hash chain integration", () => {
  let db: Queryable;
  let sessionStore: SessionStore;
  let matchStore: MatchStore;
  let sessionId: string;

  beforeEach(async () => {
    db = await createTestDb();
    sessionStore = new SessionStore(db);
    matchStore = new MatchStore(db);
    const { session } = await sessionStore.createSession({ captureMode: "ONE_PHONE" });
    sessionId = session.id;
  });

  it("resolves a challenge and builds a valid first record chained to GENESIS", async () => {
    const challenge = await matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, challenge.id, "BLUE", sub(Rank.Major, "h1"), "challengerWins");
    const resolvedRow = await matchStore.submitPiece(sessionId, challenge.id, "RED", sub(Rank.Captain, "h2"), "challengerWins");

    expect(resolvedRow.status).toBe("RESOLVED");
    expect(resolvedRow.result_winner).toBe("BLUE"); // Major beats Captain
    expect(resolvedRow.previous_hash).toBe("GENESIS");
    expect(resolvedRow.record_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains multiple challenges and passes shared verifyChain", async () => {
    const c1 = await matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Captain, "r1"), "challengerWins");

    // Private (BLUE) vs Spy (RED) special case -> BLUE wins regardless of initiator.
    const c2 = await matchStore.createChallenge(sessionId, "RED");
    await matchStore.submitPiece(sessionId, c2.id, "BLUE", sub(Rank.Private, "b2"), "challengerWins");
    const c2Resolved = await matchStore.submitPiece(sessionId, c2.id, "RED", sub(Rank.Spy, "r2"), "challengerWins");
    expect(c2Resolved.result_winner).toBe("BLUE");

    const records = await matchStore.getResolvedRecords(sessionId);
    expect(records).toHaveLength(2);
    expect(records[1].previousHash).toBe(records[0].recordHash);

    const result = await verifyChain(records);
    expect(result.valid).toBe(true);
  });

  it("detects tampering when a stored record is altered directly in the DB", async () => {
    const c1 = await matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Captain, "r1"), "challengerWins");

    // Simulate an attacker directly editing the DB row's rank after the fact,
    // without recomputing the hash — the anti-cheat mechanism this guards against.
    await db.query("UPDATE challenges SET blue_rank = $1 WHERE id = $2", [Rank.FiveStarGeneral, c1.id]);

    const records = await matchStore.getResolvedRecords(sessionId);
    const result = await verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it("refuses to open a second challenge while one is still open", async () => {
    await matchStore.createChallenge(sessionId, "BLUE");
    await expect(matchStore.createChallenge(sessionId, "RED")).rejects.toThrow(ChallengeAlreadyOpenError);
  });

  it("a DB-level constraint (not a racy check-then-insert) rejects a genuinely concurrent second create", async () => {
    // Fire both at once — this is what used to be able to slip through a
    // check-then-insert race and orphan a second OPEN challenge nobody
    // could ever finish, permanently softlocking the match.
    const results = await Promise.allSettled([matchStore.createChallenge(sessionId, "BLUE"), matchStore.createChallenge(sessionId, "RED")]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ChallengeAlreadyOpenError);

    // Exactly one OPEN challenge exists — no orphan.
    const all = await matchStore.listChallenges(sessionId);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("OPEN");
  });

  it("abandoning a stuck OPEN challenge frees the session to start a new one", async () => {
    const stuck = await matchStore.createChallenge(sessionId, "BLUE");
    await expect(matchStore.createChallenge(sessionId, "RED")).rejects.toThrow(ChallengeAlreadyOpenError);

    await matchStore.abandonChallenge(sessionId, stuck.id);
    expect((await matchStore.getChallenge(sessionId, stuck.id))!.status).toBe("ABANDONED");

    // No longer blocks a fresh challenge.
    const fresh = await matchStore.createChallenge(sessionId, "RED");
    expect(fresh.status).toBe("OPEN");
  });

  it("refuses to abandon a challenge that isn't open (already resolved)", async () => {
    const c1 = await matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Captain, "r1"), "challengerWins");

    await expect(matchStore.abandonChallenge(sessionId, c1.id)).rejects.toThrow(ChallengeAlreadyResolvedError);
  });

  it("refuses to abandon a challenge that doesn't exist", async () => {
    await expect(matchStore.abandonChallenge(sessionId, "no-such-id")).rejects.toThrow(ChallengeNotFoundError);
  });

  it("an abandoned challenge never enters the hash chain or resolved history", async () => {
    const stuck = await matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.abandonChallenge(sessionId, stuck.id);

    const c2 = await matchStore.createChallenge(sessionId, "RED");
    await matchStore.submitPiece(sessionId, c2.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    await matchStore.submitPiece(sessionId, c2.id, "RED", sub(Rank.Captain, "r1"), "challengerWins");

    const records = await matchStore.getResolvedRecords(sessionId);
    expect(records).toHaveLength(1); // the abandoned one is excluded
    const result = await verifyChain(records);
    expect(result.valid).toBe(true);
    expect(records[0].previousHash).toBe("GENESIS"); // chain starts clean, unaffected by the abandoned challenge
  });

  it("stays OPEN after only one side has submitted — resolution requires both", async () => {
    const c1 = await matchStore.createChallenge(sessionId, "BLUE");
    const afterFirst = await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    expect(afterFirst.status).toBe("OPEN");
  });

  it("computes a Flag vs Flag challenge using the configured house rule", async () => {
    const c1 = await matchStore.createChallenge(sessionId, "RED"); // RED initiates
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Flag, "b1"), "challengerWins");
    const resolved = await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Flag, "r1"), "challengerWins");
    expect(resolved.result_winner).toBe("RED"); // challenger (RED) wins by default house rule
  });
});
