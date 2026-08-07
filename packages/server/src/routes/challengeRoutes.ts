import type { PlayerColor } from "@salpakan/shared";
import { Router } from "express";
import multer from "multer";
import { getAuth, requireAuth } from "../auth.js";
import { config } from "../config.js";
import { savePhoto } from "../photoStorage.js";
import type { VisionService } from "../services/visionService.js";
import { ChallengeAlreadyOpenError, ChallengeAlreadyResolvedError, ChallengeNotFoundError, MatchStore } from "../store/matchStore.js";
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

export function createChallengeRouter(sessionStore: SessionStore, matchStore: MatchStore, visionService: VisionService): Router {
  const router = Router({ mergeParams: true });

  router.use(requireAuth(sessionStore));

  router.post("/", (req, res) => {
    const auth = getAuth(res);
    const session = sessionStore.getSessionById(auth.sessionId)!;
    if (session.status !== "ACTIVE") {
      res.status(409).json({ error: "SESSION_NOT_ACTIVE" });
      return;
    }

    const initiator: PlayerColor = req.body?.initiator === "BLUE" || req.body?.initiator === "RED" ? req.body.initiator : auth.color;

    try {
      const challenge = matchStore.createChallenge(auth.sessionId, initiator);
      res.status(201).json({ challengeId: challenge.id, challengeNumber: challenge.challenge_number, initiator });
    } catch (err) {
      if (err instanceof ChallengeAlreadyOpenError) {
        res.status(409).json({ error: "CHALLENGE_ALREADY_OPEN" });
        return;
      }
      throw err;
    }
  });

  // Lets a device discover the currently-open challenge without already
  // knowing its id — needed when the *other* player created it (two-phone
  // mode) or after a page reload.
  router.get("/current", (req, res) => {
    const auth = getAuth(res);
    const open = matchStore.getOpenChallenge(auth.sessionId);
    if (!open) {
      res.json({ status: "NONE" });
      return;
    }
    res.json(buildSelfView(open, auth.color));
  });

  router.get("/:challengeId", (req, res) => {
    const auth = getAuth(res);
    const row = matchStore.getChallenge(auth.sessionId, req.params.challengeId);
    if (!row) {
      res.status(404).json({ error: "CHALLENGE_NOT_FOUND" });
      return;
    }
    res.json(buildSelfView(row, auth.color));
  });

  router.post("/:challengeId/submissions", upload.single("photo"), async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const session = sessionStore.getSessionById(auth.sessionId)!;
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

      const existing = matchStore.getChallenge(auth.sessionId, req.params.challengeId);
      if (!existing) {
        res.status(404).json({ error: "CHALLENGE_NOT_FOUND" });
        return;
      }
      if (existing.status !== "OPEN") {
        res.status(409).json({ error: "CHALLENGE_ALREADY_RESOLVED" });
        return;
      }

      const recognition = await visionService.recognizeRank(file.buffer, file.mimetype);

      if (recognition.confidence < config.confidenceThreshold) {
        res.status(422).json({
          error: "LOW_CONFIDENCE",
          confidence: recognition.confidence,
          threshold: config.confidenceThreshold,
          message: "Could not confidently read the rank — please retake the photo with better lighting/focus.",
        });
        return;
      }

      const stored = await savePhoto(auth.sessionId, req.params.challengeId, auth.color, file.buffer, file.mimetype);

      const updated = await matchStore.submitPiece(
        auth.sessionId,
        req.params.challengeId,
        auth.color,
        { photoHash: stored.hash, photoPath: stored.path, rank: recognition.rank, confidence: recognition.confidence },
        session.flag_vs_flag_rule,
      );

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

  return router;
}
