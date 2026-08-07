import { Rank } from "@salpakan/shared";
import type { Express } from "express";
import { rm } from "node:fs/promises";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { fixturePhoto, ScriptedVisionService } from "./testVisionService.js";

let app: Express;

beforeEach(() => {
  const db = openDb(":memory:");
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

    // BLUE submits first — must only see their own rank, and must be waiting.
    const blueSubmitRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions`)
      .set("Authorization", `Bearer ${blueToken}`)
      .attach("photo", fixturePhoto(Rank.Major, 0.95), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(blueSubmitRes.body.status).toBe("WAITING_FOR_OPPONENT");
    expect(blueSubmitRes.body.yourRank).toBe(Rank.Major);
    const blueSubmitJson = JSON.stringify(blueSubmitRes.body);
    expect(blueSubmitJson).not.toContain("CAPTAIN");
    expect(blueSubmitJson).not.toContain("outcome");

    // RED submits second — this resolves the challenge.
    const redSubmitRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions`)
      .set("Authorization", `Bearer ${redToken}`)
      .attach("photo", fixturePhoto(Rank.Captain, 0.9), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(200);

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

  it("rejects a low-confidence recognition and does not store it as a final submission", async () => {
    const { sessionId, blueToken, redToken } = await createTwoPhoneMatch();
    const challengeRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges`)
      .set("Authorization", `Bearer ${blueToken}`)
      .send({ initiator: "BLUE" })
      .expect(201);
    const challengeId = challengeRes.body.challengeId;

    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions`)
      .set("Authorization", `Bearer ${blueToken}`)
      .attach("photo", fixturePhoto(Rank.Major, 0.4), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(422)
      .expect((res) => {
        expect(res.body.error).toBe("LOW_CONFIDENCE");
      });

    const pollRes = await request(app)
      .get(`/api/sessions/${sessionId}/challenges/${challengeId}`)
      .set("Authorization", `Bearer ${blueToken}`)
      .expect(200);
    expect(pollRes.body.status).toBe("OPEN");
    expect(pollRes.body.yourSubmitted).toBe(false);

    // Sanity: opponent submitting normally still works afterward.
    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions`)
      .set("Authorization", `Bearer ${redToken}`)
      .attach("photo", fixturePhoto(Rank.Sergeant, 0.9), { filename: "piece.jpg", contentType: "image/jpeg" })
      .expect(200);
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

    await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions`)
      .set("Authorization", `Bearer ${blueToken}`)
      .attach("photo", fixturePhoto(Rank.Private, 0.9), { filename: "a.jpg", contentType: "image/jpeg" })
      .expect(200);

    const redRes = await request(app)
      .post(`/api/sessions/${sessionId}/challenges/${challengeId}/submissions`)
      .set("Authorization", `Bearer ${redToken}`)
      .attach("photo", fixturePhoto(Rank.Private, 0.9), { filename: "b.jpg", contentType: "image/jpeg" })
      .expect(200);

    expect(redRes.body.outcome).toBe("MUTUAL_DESTRUCTION");
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
