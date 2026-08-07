import { Rank, verifyChain } from "@salpakan/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { MatchStore } from "../src/store/matchStore.js";
import { SessionStore } from "../src/store/sessionStore.js";
import type { DatabaseSync } from "node:sqlite";

function sub(rank: Rank, hash: string) {
  return { photoHash: hash, photoPath: `/tmp/${hash}.jpg`, rank, confidence: 0.9 };
}

describe("MatchStore + hash chain integration", () => {
  let db: DatabaseSync;
  let sessionStore: SessionStore;
  let matchStore: MatchStore;
  let sessionId: string;

  beforeEach(() => {
    db = openDb(":memory:");
    sessionStore = new SessionStore(db);
    matchStore = new MatchStore(db);
    const { session } = sessionStore.createSession({ captureMode: "ONE_PHONE" });
    sessionId = session.id;
  });

  it("resolves a challenge and builds a valid first record chained to GENESIS", async () => {
    const challenge = matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, challenge.id, "BLUE", sub(Rank.Major, "h1"), "challengerWins");
    const resolvedRow = await matchStore.submitPiece(sessionId, challenge.id, "RED", sub(Rank.Captain, "h2"), "challengerWins");

    expect(resolvedRow.status).toBe("RESOLVED");
    expect(resolvedRow.result_winner).toBe("BLUE"); // Major beats Captain
    expect(resolvedRow.previous_hash).toBe("GENESIS");
    expect(resolvedRow.record_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains multiple challenges and passes shared verifyChain", async () => {
    const c1 = matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Captain, "r1"), "challengerWins");

    // Private (BLUE) vs Spy (RED) special case -> BLUE wins regardless of initiator.
    const c2 = matchStore.createChallenge(sessionId, "RED");
    await matchStore.submitPiece(sessionId, c2.id, "BLUE", sub(Rank.Private, "b2"), "challengerWins");
    const c2Resolved = await matchStore.submitPiece(sessionId, c2.id, "RED", sub(Rank.Spy, "r2"), "challengerWins");
    expect(c2Resolved.result_winner).toBe("BLUE");

    const records = matchStore.getResolvedRecords(sessionId);
    expect(records).toHaveLength(2);
    expect(records[1].previousHash).toBe(records[0].recordHash);

    const result = await verifyChain(records);
    expect(result.valid).toBe(true);
  });

  it("detects tampering when a stored record is altered directly in the DB", async () => {
    const c1 = matchStore.createChallenge(sessionId, "BLUE");
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Captain, "r1"), "challengerWins");

    // Simulate an attacker directly editing the DB row's rank after the fact,
    // without recomputing the hash — the anti-cheat mechanism this guards against.
    db.prepare("UPDATE challenges SET blue_rank = ? WHERE id = ?").run(Rank.FiveStarGeneral, c1.id);

    const records = matchStore.getResolvedRecords(sessionId);
    const result = await verifyChain(records);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it("refuses to open a second challenge while one is still open", () => {
    matchStore.createChallenge(sessionId, "BLUE");
    expect(() => matchStore.createChallenge(sessionId, "RED")).toThrow();
  });

  it("stays OPEN after only one side has submitted — resolution requires both", async () => {
    const c1 = matchStore.createChallenge(sessionId, "BLUE");
    const afterFirst = await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Major, "b1"), "challengerWins");
    expect(afterFirst.status).toBe("OPEN");
  });

  it("computes a Flag vs Flag challenge using the configured house rule", async () => {
    const c1 = matchStore.createChallenge(sessionId, "RED"); // RED initiates
    await matchStore.submitPiece(sessionId, c1.id, "BLUE", sub(Rank.Flag, "b1"), "challengerWins");
    const resolved = await matchStore.submitPiece(sessionId, c1.id, "RED", sub(Rank.Flag, "r1"), "challengerWins");
    expect(resolved.result_winner).toBe("RED"); // challenger (RED) wins by default house rule
  });
});
