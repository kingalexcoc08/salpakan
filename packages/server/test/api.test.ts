import { Rank } from "@salpakan/shared";
import type { Express } from "express";
import { rm } from "node:fs/promises";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import type { Queryable } from "../src/db.js";
import { createTestDb } from "./testDb.js";
import { fixturePhoto, ScriptedVisionService } from "./testVisionService.js";

let app: Express;
let db: Queryable;

beforeEach(async () => {
  db = await createTestDb();
  app = createApp(db, new ScriptedVisionService());
});

afterEach(async () => {
  await rm(config.uploadDir, { recursive: true, force: true });
});

async function createTwoPhoneMatch() {
  const createRes = await request(app)
    .post("/api/sessions")
    .send({ captureMode: "TWO_PHONE", creatorColor: "BLUE", blueName: "Alex" })
    .expect(201);

  const sessionId = createRes.body.sessionId;
  const blueToken = createRes.body.tokens.BLUE;
  const code = createRes.body.code;

  const joinRes = await request(app).post("/api/sessions/join").send({ code, name: "Sam" }).expect(200);
  const redToken = joinRes.body.token;
  expect(joinRes.body.yourColor).toBe("RED");

  return { sessionId, blueToken, redToken, code };
}

/** Runs the preview step and returns its body (rank/confidence/lowConfidence/token). */
async function preview(sessionId: string, token: string, challengeId: string, rank: Rank, confidence: number, filename = "piece.jpg") {
  const res = await request(app)
    .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/preview`)
    .set("Authorization", `Bearer ${token}`)
    .attach("photo", fixturePhoto(rank, confidence), { filename, contentType: "image/jpeg" })
    .expect(200);
  return res.body as { rank: Rank; confidence: number; lowConfidence: boolean; token: string };
}

/**
 * Convenience: preview then immediately confirm the same photo/rank — the
 * common-path helper most tests want. Always expects 200; a supertest Test
 * builder is thenable, so returning one from an async function would
 * collapse it into a plain (already-resolved) Response with no further
 * `.expect(...)` chaining available — hence baking the expectation in here.
 */
async function submitConfirmed(sessionId: string, token: string, challengeId: string, rank: Rank, confidence: number, filename = "piece.jpg") {
  const previewed = await preview(sessionId, token, challengeId, rank, confidence, filename);
  return request(app)
    .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`)
    .set("Authorization", `Bearer ${token}`)
    .field("token", previewed.token)
    .attach("photo", fixturePhoto(rank, confidence), { filename, contentType: "image/jpeg" })
    .expect(200);
}

describe("Full two-phone challenge flow", () => {
  it("never reveals the opponent's rank live, only resolves after both submit, and reveals both in post-game history", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();

    const statusRes = await request(app).get(`/api/sessions/${sessionId}`).expect(200);
    expect(statusRes.body.status).toBe("ACTIVE");
    expect(statusRes.body.blueJoined).toBe(true);
    expect(statusRes.body.redJoined).toBe(true);

    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    // BLUE confirms first — must only see their own rank, and must be waiting.
    const blueSubmitRes = await submitConfirmed(sessionId, blueToken, challengeId, Rank.Major, 0.95);

    expect(blueSubmitRes.body.status).toBe("WAITING_FOR_OPPONENT");
    expect(blueSubmitRes.body.yourRank).toBe(Rank.Major);
    const blueSubmitJson = JSON.stringify(blueSubmitRes.body);
    expect(blueSubmitJson).not.toContain("CAPTAIN");
    expect(blueSubmitJson).not.toContain("outcome");

    // RED confirms second — this resolves the challenge.
    const redSubmitRes = await submitConfirmed(sessionId, redToken, challengeId, Rank.Captain, 0.9);

    expect(redSubmitRes.body.status).toBe("RESOLVED");
    expect(redSubmitRes.body.yourRank).toBe(Rank.Captain);
    expect(redSubmitRes.body.outcome).toBe("LOSE"); // Captain < Major
    const redSubmitJson = JSON.stringify(redSubmitRes.body);
    expect(redSubmitJson).not.toContain("MAJOR"); // never shown RED the winning rank

    // BLUE polls the result — should see WIN and their own rank only.
    const bluePollRes = await request(app)
      .get(`/api/sessions/${sessionId}/challenges/${challengeId}`)
      .set("Authorization", `Bearer ${blueToken}`)
      .expect(200);
    expect(bluePollRes.body.outcome).toBe("WIN");
    expect(bluePollRes.body.yourRank).toBe(Rank.Major);
    expect(JSON.stringify(bluePollRes.body)).not.toContain("CAPTAIN");

    // History is not available before the game ends.
    await request(app)
      .get(`/api/sessions/${sessionId}/history`)
      .set("Authorization", `Bearer ${blueToken}`)
      .expect(409);

    // End the game.
    await request(app).post(`/api/sessions/${sessionId}/end`).set("Authorization", `Bearer ${blueToken}`).expect(200);

    // Now both ranks are revealed together in history.
    const historyRes = await request(app)
      .get(`/api/sessions/${sessionId}/history`)
      .set("Authorization", `Bearer ${redToken}`)
      .expect(200);

    expect(historyRes.body.integrity.valid).toBe(true);
    expect(historyRes.body.challenges).toHaveLength(1);
    expect(historyRes.body.challenges[0].blue.rank).toBe(Rank.Major);
    expect(historyRes.body.challenges[0].red.rank).toBe(Rank.Captain);
    expect(historyRes.body.challenges[0].result).toMatchObject({ type: "win", winner: "BLUE", loser: "RED" });
  });

  it("rejects requests without a valid bearer token", async () => {
    const { sessionId } = await createTwoPhoneMatch();
    await request(app).post(`/api/sessions/${sessionId}/challenges`).send({ initiator: "BLUE" }).expect(401);
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", "Bearer not-a-real-token")
      .send({ initiator: "BLUE" })
      .expect(401);
  });

  it("mutual destruction (equal rank) is reported as MUTUAL_DESTRUCTION to both sides, not WIN/LOSE", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "RED" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    await submitConfirmed(sessionId, blueToken, challengeId, Rank.Private, 0.9, "a.jpg");
    const redRes = await submitConfirmed(sessionId, redToken, challengeId, Rank.Private, 0.9, "b.jpg");

    expect(redRes.body.outcome).toBe("MUTUAL_DESTRUCTION");
  });
});

describe("Recognition confirmation flow", () => {
  it("preview does not write anything to the challenge — the challenge stays OPEN and unsubmitted until confirm", async () => {
    const { sessionId, blueToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    const previewed = await preview(sessionId, blueToken, challengeId, Rank.Major, 0.95);
    expect(previewed.rank).toBe(Rank.Major);
    expect(previewed.lowConfidence).toBe(false);
    expect(previewed.token).toBeTruthy();

    const pollRes = await request(app)
      .get(`/api/sessions/${sessionId}/challenges/${challengeId}`)
      .set("Authorization", `Bearer ${blueToken}`)
      .expect(200);
    expect(pollRes.body.status).toBe("OPEN");
    expect(pollRes.body.yourSubmitted).toBe(false);
  });

  it("a rejected recognition (retake, i.e. never confirmed) leaves no trace — only the eventually-confirmed photo is logged", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    // BLUE previews a misread, rejects it (never calls confirm)...
    await preview(sessionId, blueToken, challengeId, Rank.Sergeant, 0.9, "misread.jpg");
    // ...then retakes and previews+confirms a different rank instead.
    const blueSubmitRes = await submitConfirmed(sessionId, blueToken, challengeId, Rank.Major, 0.95, "retake.jpg");
    expect(blueSubmitRes.body.yourRank).toBe(Rank.Major);

    const redSubmitRes = await submitConfirmed(sessionId, redToken, challengeId, Rank.Captain, 0.9);
    expect(redSubmitRes.body.status).toBe("RESOLVED");

    await request(app).post(`/api/sessions/${sessionId}/end`).set("Authorization", `Bearer ${blueToken}`).expect(200);
    const historyRes = await request(app)
      .get(`/api/sessions/${sessionId}/history`)
      .set("Authorization", `Bearer ${blueToken}`)
      .expect(200);

    // Only one challenge record exists, and it reflects the confirmed
    // retake (Major) — the rejected preview (Sergeant) was never written.
    expect(historyRes.body.challenges).toHaveLength(1);
    expect(historyRes.body.challenges[0].blue.rank).toBe(Rank.Major);
    expect(JSON.stringify(historyRes.body)).not.toContain("SERGEANT");
  });

  it("flags low confidence in the preview response instead of blocking it outright", async () => {
    const { sessionId, blueToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    const previewed = await preview(sessionId, blueToken, challengeId, Rank.Major, 0.4);
    expect(previewed.lowConfidence).toBe(true);
    expect(previewed.confidence).toBe(0.4);
    // The player can still choose to confirm a low-confidence read (the
    // auto-flag can itself be a false positive) — it isn't auto-blocked.
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`)
      .set("Authorization", `Bearer ${blueToken}`)
      .field("token", previewed.token)
      .attach("photo", fixturePhoto(Rank.Major, 0.4), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(200);
  });

  it("rejects confirm with a token issued to a different color", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    const bluePreview = await preview(sessionId, blueToken, challengeId, Rank.Major, 0.95);

    // RED tries to confirm using BLUE's token.
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`)
      .set("Authorization", `Bearer ${redToken}`)
      .field("token", bluePreview.token)
      .attach("photo", fixturePhoto(Rank.Major, 0.95), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("TOKEN_MISMATCH");
      });
  });

  it("rejects confirm when the photo doesn't match what the token was issued for", async () => {
    const { sessionId, blueToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    const previewed = await preview(sessionId, blueToken, challengeId, Rank.Major, 0.95);

    // Confirm with a *different* photo than the one that was recognized.
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`)
      .set("Authorization", `Bearer ${blueToken}`)
      .field("token", previewed.token)
      .attach("photo", fixturePhoto(Rank.Captain, 0.95), { filename: "different.jpg", contentType: "image/jpeg" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("PHOTO_MISMATCH");
      });
  });

  it("rejects confirm with a missing or garbage token", async () => {
    const { sessionId, blueToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`)
      .set("Authorization", `Bearer ${blueToken}`)
      .attach("photo", fixturePhoto(Rank.Major, 0.95), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("MISSING_TOKEN");
      });

    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`)
      .set("Authorization", `Bearer ${blueToken}`)
      .field("token", "not-a-real-token")
      .attach("photo", fixturePhoto(Rank.Major, 0.95), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("INVALID_OR_EXPIRED_TOKEN");
      });
  });
});

describe("Recognition accuracy feedback (spec §2.5)", () => {
  it("logs a rejected recognition, and backfills the confirmed rank once the player retakes and confirms", async () => {
    const { sessionId, blueToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    const rejected = await preview(sessionId, blueToken, challengeId, Rank.Sergeant, 0.5, "misread.jpg");
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/feedback`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ token: rejected.token })
      .expect(204);

    const afterReject = await db.query<{ guessed_rank: string; confirmed_rank: string | null }>(
      "SELECT guessed_rank, confirmed_rank FROM recognition_feedback WHERE session_id = $1 AND challenge_id = $2",
      [sessionId, challengeId],
    );
    expect(afterReject.rows).toHaveLength(1);
    expect(afterReject.rows[0].guessed_rank).toBe(Rank.Sergeant);
    expect(afterReject.rows[0].confirmed_rank).toBeNull();

    // Not part of the tamper-evident match log — the challenge is still OPEN, nothing was written there.
    const pollRes = await request(app)
      .get(`/api/sessions/${sessionId}/challenges/${challengeId}`)
      .set("Authorization", `Bearer ${blueToken}`)
      .expect(200);
    expect(pollRes.body.status).toBe("OPEN");

    await submitConfirmed(sessionId, blueToken, challengeId, Rank.Major, 0.95, "retake.jpg");

    const afterConfirm = await db.query<{ confirmed_rank: string | null }>(
      "SELECT confirmed_rank FROM recognition_feedback WHERE session_id = $1 AND challenge_id = $2",
      [sessionId, challengeId],
    );
    expect(afterConfirm.rows[0].confirmed_rank).toBe(Rank.Major);
  });

  it("rejects a feedback token that belongs to a different color", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    const bluePreview = await preview(sessionId, blueToken, challengeId, Rank.Major, 0.6);
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/feedback`)
      .set("Authorization", `Bearer ${redToken}`)
      .send({ token: bluePreview.token })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe("TOKEN_MISMATCH");
      });
  });

  it("treats a missing/garbage feedback token as a harmless no-op rather than an error", async () => {
    const { sessionId, blueToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions/feedback`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ token: "not-a-real-token" })
      .expect(204);
  });
});

describe("GET /challenges/current", () => {
  it("lets the opponent's device discover a challenge it didn't create", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();

    const noneRes = await request(app)
      .get(`/api/sessions/${sessionId}/challenges/current`)
      .set("Authorization", `Bearer ${redToken}`)
      .expect(200);
    expect(noneRes.body.status).toBe("NONE");

    const createRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);

    const discoveredRes = await request(app)
      .get(`/api/sessions/${sessionId}/challenges/current`)
      .set("Authorization", `Bearer ${redToken}`)
      .expect(200);
    expect(discoveredRes.body.challengeId).toBe(createRes.body.challengeId);
    expect(discoveredRes.body.status).toBe("OPEN");
  });
});

describe("ONE_PHONE mode", () => {
  it("issues both BLUE and RED tokens immediately and starts ACTIVE", async () => {
    const res = await request(app).post("/api/sessions").send({ captureMode: "ONE_PHONE" }).expect(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.tokens.BLUE).toBeTruthy();
    expect(res.body.tokens.RED).toBeTruthy();
  });
});
