import { Rank } from "@salpakan/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "../src/db.js";
import { RecognitionFeedbackStore } from "../src/store/recognitionFeedbackStore.js";
import { SessionStore } from "../src/store/sessionStore.js";
import { createTestDb } from "./testDb.js";

describe("RecognitionFeedbackStore", () => {
  let db: Queryable;
  let store: RecognitionFeedbackStore;
  let sessionId: string;

  beforeEach(async () => {
    db = await createTestDb();
    store = new RecognitionFeedbackStore(db);
    const sessionStore = new SessionStore(db);
    const { session } = await sessionStore.createSession({ captureMode: "ONE_PHONE" });
    sessionId = session.id;
  });

  it("records a rejection with confirmed_rank left null", async () => {
    await store.recordRejection({
      sessionId,
      challengeId: "c1",
      color: "BLUE",
      guessedRank: Rank.Sergeant,
      guessedConfidence: 0.6,
      photoHash: "hash-1",
    });

    const { rows } = await db.query<{ guessed_rank: string; confirmed_rank: string | null; photo_hash: string }>(
      "SELECT guessed_rank, confirmed_rank, photo_hash FROM recognition_feedback WHERE session_id = $1",
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].guessed_rank).toBe(Rank.Sergeant);
    expect(rows[0].confirmed_rank).toBeNull();
    expect(rows[0].photo_hash).toBe("hash-1");
  });

  it("backfills the confirmed rank onto matching open rows only", async () => {
    await store.recordRejection({ sessionId, challengeId: "c1", color: "BLUE", guessedRank: Rank.Sergeant, guessedConfidence: 0.6, photoHash: "h1" });
    await store.recordRejection({ sessionId, challengeId: "c1", color: "BLUE", guessedRank: Rank.Private, guessedConfidence: 0.5, photoHash: "h2" });
    // A different color's rejection on the same challenge must not be touched by BLUE's confirm.
    await store.recordRejection({ sessionId, challengeId: "c1", color: "RED", guessedRank: Rank.Captain, guessedConfidence: 0.7, photoHash: "h3" });

    await store.linkConfirmedRank({ sessionId, challengeId: "c1", color: "BLUE", confirmedRank: Rank.Major });

    const { rows } = await db.query<{ color: string; confirmed_rank: string | null }>(
      "SELECT color, confirmed_rank FROM recognition_feedback WHERE session_id = $1 ORDER BY color, guessed_rank",
      [sessionId],
    );
    const blueRows = rows.filter((r) => r.color === "BLUE");
    const redRows = rows.filter((r) => r.color === "RED");
    expect(blueRows.every((r) => r.confirmed_rank === Rank.Major)).toBe(true);
    expect(redRows[0].confirmed_rank).toBeNull();
  });

  it("linking with no prior rejections is a harmless no-op", async () => {
    await expect(store.linkConfirmedRank({ sessionId, challengeId: "no-such-challenge", color: "BLUE", confirmedRank: Rank.Flag })).resolves.not.toThrow();
  });

  it("never touches the challenges table (separate from the hash-chained match log)", async () => {
    await store.recordRejection({ sessionId, challengeId: "c1", color: "BLUE", guessedRank: Rank.Spy, guessedConfidence: 0.4, photoHash: "h1" });
    const { rows } = await db.query("SELECT * FROM challenges");
    expect(rows).toHaveLength(0);
  });
});
