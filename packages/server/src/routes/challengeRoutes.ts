import { sha256HexBytes, type PlayerColor } from "@salpakan/shared";
import { Router } from "express";
import multer from "multer";
import { getAuth, requireAuth } from "../auth.js";
import { config } from "../config.js";
import { savePhoto } from "../photoStorage.js";
import { normalizeImage } from "../services/imageNormalize.js";
import type { VisionService } from "../services/visionService.js";
import { signSubmissionToken, verifySubmissionToken } from "../submissionToken.js";
import { ChallengeAlreadyOpenError, ChallengeAlreadyResolvedError, ChallengeNotFoundError, MatchStore } from "../store/matchStore.js";
import type { RecognitionFeedbackStore } from "../store/recognitionFeedbackStore.js";
import type { SessionStore } from "../store/sessionStore.js";
import type { ChallengeRow } from "../types.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPhotoBytes },
});

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"]);

/**
 * Builds what a single color is allowed to see about a challenge — spec
 * §5.0's core rule: your own rank, plus the outcome by color/side, never
 * the opponent's rank.
 */
function buildSelfView(row: ChallengeRow, color: PlayerColor) {
  const yourRankCol = color === "BLUE" ? row.blue_rank : row.red_rank;
  const yourConfidence = color === "BLUE" ? row.blue_confidence : row.red_confidence;
  const yourSubmitted = Boolean(yourRankCol);

  if (row.status === "OPEN") {
    // Distinguish "still waiting on you" from "you're in, waiting on your
    // opponent" — useful for the UI, and neither ever leaks the other
    // side's rank since the opponent hasn't submitted (or their value
    // simply isn't included in this color's view either way).
    const status = yourSubmitted ? ("WAITING_FOR_OPPONENT" as const) : ("OPEN" as const);
    return {
      challengeId: row.id,
      challengeNumber: row.challenge_number,
      status,
      yourSubmitted,
      yourRank: yourRankCol,
      yourConfidence,
    };
  }

  let outcome: "WIN" | "LOSE" | "MUTUAL_DESTRUCTION";
  if (row.result_type === "mutualDestruction") {
    outcome = "MUTUAL_DESTRUCTION";
  } else {
    outcome = row.result_winner === color ? "WIN" : "LOSE";
  }

  return {
    challengeId: row.id,
    challengeNumber: row.challenge_number,
    status: "RESOLVED" as const,
    yourRank: yourRankCol,
    yourConfidence,
    outcome,
  };
}

export function createChallengeRouter(
  sessionStore: SessionStore,
  matchStore: MatchStore,
  visionService: VisionService,
  recognitionFeedbackStore: RecognitionFeedbackStore,
): Router {
  const router = Router({ mergeParams: true });

  router.use(requireAuth(sessionStore));

  router.post("/", async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const session = (await sessionStore.getSessionById(auth.sessionId))!;
      if (session.status !== "ACTIVE") {
        res.status(409).json({ error: "SESSION_NOT_ACTIVE" });
        return;
      }

      const initiator: PlayerColor = req.body?.initiator === "BLUE" || req.body?.initiator === "RED" ? req.body.initiator : auth.color;

      const challenge = await matchStore.createChallenge(auth.sessionId, initiator);
      res.status(201).json({ challengeId: challenge.id, challengeNumber: challenge.challenge_number, initiator });
    } catch (err) {
      if (err instanceof ChallengeAlreadyOpenError) {
        res.status(409).json({ error: "CHALLENGE_ALREADY_OPEN" });
        return;
      }
      next(err);
    }
  });

  // Lets a device discover the currently-open challenge without already
  // knowing its id — needed when the *other* player created it (two-phone
  // mode) or after a page reload.
  router.get("/current", async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const open = await matchStore.getOpenChallenge(auth.sessionId);
      if (!open) {
        res.json({ status: "NONE" });
        return;
      }
      res.json(buildSelfView(open, auth.color));
    } catch (err) {
      next(err);
    }
  });

  router.get("/:challengeId", async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const row = await matchStore.getChallenge(auth.sessionId, req.params.challengeId);
      if (!row) {
        res.status(404).json({ error: "CHALLENGE_NOT_FOUND" });
        return;
      }
      res.json(buildSelfView(row, auth.color));
    } catch (err) {
      next(err);
    }
  });

  // Step 1 of the recognition-confirmation flow: recognize the photo and
  // hand back a signed token describing the result, but write nothing to
  // the challenge yet. If the player rejects this recognition ("No,
  // retake"), the client simply never calls /confirm — nothing here ever
  // touched the database, so a rejected attempt leaves no trace at all.
  router.post("/:challengeId/submissions/preview", upload.single("photo"), async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const session = (await sessionStore.getSessionById(auth.sessionId))!;
      if (session.status !== "ACTIVE") {
        res.status(409).json({ error: "SESSION_NOT_ACTIVE" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "MISSING_PHOTO", message: "Include the piece photo as multipart field 'photo'." });
        return;
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        res.status(400).json({ error: "UNSUPPORTED_MEDIA_TYPE", mimetype: file.mimetype });
        return;
      }

      const existing = await matchStore.getChallenge(auth.sessionId, req.params.challengeId);
      if (!existing) {
        res.status(404).json({ error: "CHALLENGE_NOT_FOUND" });
        return;
      }
      if (existing.status !== "OPEN") {
        res.status(409).json({ error: "CHALLENGE_ALREADY_RESOLVED" });
        return;
      }

      // Safety-net server-side downscale (spec §2.3) — a no-op for images
      // already within bounds, deterministic for oversized ones, so this
      // never breaks the preview/confirm photo-hash check below.
      const normalized = await normalizeImage(file.buffer, file.mimetype);

      const recognition = await visionService.recognizeRank(normalized.buffer, normalized.mimeType);
      const photoHash = await sha256HexBytes(normalized.buffer);
      const issuedAt = Date.now();

      const token = signSubmissionToken({
        sessionId: auth.sessionId,
        challengeId: req.params.challengeId,
        color: auth.color,
        rank: recognition.rank,
        confidence: recognition.confidence,
        photoHash,
        issuedAt,
      });

      // No longer a hard block — the confirmation screen shows this flag
      // prominently and lets the player decide (an auto-flag can itself be
      // a false positive), rather than forcing a retake before they ever
      // see the recognized rank.
      res.status(200).json({
        rank: recognition.rank,
        confidence: recognition.confidence,
        lowConfidence: recognition.confidence < config.confidenceThreshold,
        token,
      });
    } catch (err) {
      next(err);
    }
  });

  // Step 2: lock in a previously previewed recognition. The rank/confidence
  // that get written are always the ones inside the signed token — never
  // anything the client sends directly — so a player confirming can only
  // ever lock in what the server actually recognized from their photo.
  router.post("/:challengeId/submissions/confirm", upload.single("photo"), async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const session = (await sessionStore.getSessionById(auth.sessionId))!;
      if (session.status !== "ACTIVE") {
        res.status(409).json({ error: "SESSION_NOT_ACTIVE" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "MISSING_PHOTO", message: "Include the same piece photo as multipart field 'photo'." });
        return;
      }

      const token = typeof req.body?.token === "string" ? req.body.token : null;
      if (!token) {
        res.status(400).json({ error: "MISSING_TOKEN", message: "Include the token returned by the preview step." });
        return;
      }
      const payload = verifySubmissionToken(token);
      if (!payload) {
        res.status(400).json({
          error: "INVALID_OR_EXPIRED_TOKEN",
          message: "That recognition result has expired — please retake the photo.",
        });
        return;
      }
      if (payload.sessionId !== auth.sessionId || payload.challengeId !== req.params.challengeId || payload.color !== auth.color) {
        res.status(400).json({ error: "TOKEN_MISMATCH" });
        return;
      }

      // Same deterministic safety-net downscale as /preview — re-running it
      // on the identical original bytes resent here reproduces the same
      // output, so this photo-hash comparison still works.
      const normalized = await normalizeImage(file.buffer, file.mimetype);
      const photoHash = await sha256HexBytes(normalized.buffer);
      if (photoHash !== payload.photoHash) {
        res.status(400).json({
          error: "PHOTO_MISMATCH",
          message: "The photo being confirmed doesn't match what was recognized — please retake and confirm again.",
        });
        return;
      }

      const existing = await matchStore.getChallenge(auth.sessionId, req.params.challengeId);
      if (!existing) {
        res.status(404).json({ error: "CHALLENGE_NOT_FOUND" });
        return;
      }
      if (existing.status !== "OPEN") {
        res.status(409).json({ error: "CHALLENGE_ALREADY_RESOLVED" });
        return;
      }

      const stored = await savePhoto(auth.sessionId, req.params.challengeId, auth.color, normalized.buffer, normalized.mimeType);

      const updated = await matchStore.submitPiece(
        auth.sessionId,
        req.params.challengeId,
        auth.color,
        { photoHash: stored.hash, photoPath: stored.path, rank: payload.rank, confidence: payload.confidence },
        session.flag_vs_flag_rule,
      );

      // Backfill any earlier rejected recognitions for this same
      // challenge+color with what was actually confirmed (spec §2.5) — a
      // no-op if the player got it right on the first try.
      await recognitionFeedbackStore.linkConfirmedRank({
        sessionId: auth.sessionId,
        challengeId: req.params.challengeId,
        color: auth.color,
        confirmedRank: payload.rank,
      });

      res.status(200).json(buildSelfView(updated, auth.color));
    } catch (err) {
      if (err instanceof ChallengeNotFoundError) {
        res.status(404).json({ error: "CHALLENGE_NOT_FOUND" });
        return;
      }
      if (err instanceof ChallengeAlreadyResolvedError) {
        res.status(409).json({ error: "CHALLENGE_ALREADY_RESOLVED" });
        return;
      }
      next(err);
    }
  });

  // Logs a rejected recognition ("No, retake") for later accuracy tuning
  // (spec §2.5) — a labeled (guessed rank) example, separate from the
  // hash-chained match log. Takes only the token from the rejected preview
  // (no photo re-upload needed — the token already carries the guessed
  // rank/confidence/photo hash); the eventual confirmed rank, if any, gets
  // backfilled onto this row from the /confirm handler above. Best-effort:
  // failing to log feedback must never block the player from retaking.
  router.post("/:challengeId/submissions/feedback", async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const token = typeof req.body?.token === "string" ? req.body.token : null;
      if (!token) {
        res.status(400).json({ error: "MISSING_TOKEN" });
        return;
      }
      const payload = verifySubmissionToken(token);
      if (!payload) {
        // The preview this refers to already expired/was malformed — there's
        // nothing meaningful to log, but this isn't the player's fault and
        // shouldn't block them from retaking, so treat it as a no-op.
        res.status(204).end();
        return;
      }
      if (payload.sessionId !== auth.sessionId || payload.challengeId !== req.params.challengeId || payload.color !== auth.color) {
        res.status(400).json({ error: "TOKEN_MISMATCH" });
        return;
      }

      await recognitionFeedbackStore.recordRejection({
        sessionId: auth.sessionId,
        challengeId: req.params.challengeId,
        color: auth.color,
        guessedRank: payload.rank,
        guessedConfidence: payload.confidence,
        photoHash: payload.photoHash,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
