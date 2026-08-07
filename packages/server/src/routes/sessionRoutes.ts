import { Router } from "express";
import { getAuth, requireAuth } from "../auth.js";
import { purgeSessionPhotos } from "../photoStorage.js";
import type { MatchStore } from "../store/matchStore.js";
import type { SessionStore } from "../store/sessionStore.js";

export function createSessionRouter(sessionStore: SessionStore, matchStore: MatchStore): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    try {
      const { captureMode, flagVsFlagRule, creatorColor, blueName, redName } = req.body ?? {};

      if (captureMode !== "TWO_PHONE" && captureMode !== "ONE_PHONE") {
        res.status(400).json({ error: "INVALID_CAPTURE_MODE", message: "captureMode must be TWO_PHONE or ONE_PHONE." });
        return;
      }
      if (flagVsFlagRule && flagVsFlagRule !== "challengerWins" && flagVsFlagRule !== "mutualDestruction") {
        res.status(400).json({ error: "INVALID_FLAG_VS_FLAG_RULE" });
        return;
      }
      if (creatorColor && creatorColor !== "BLUE" && creatorColor !== "RED") {
        res.status(400).json({ error: "INVALID_COLOR" });
        return;
      }

      const { session, tokens } = await sessionStore.createSession({
        captureMode,
        flagVsFlagRule,
        creatorColor,
        blueName,
        redName,
      });

      res.status(201).json({
        sessionId: session.id,
        code: session.code,
        captureMode: session.capture_mode,
        flagVsFlagRule: session.flag_vs_flag_rule,
        status: session.status,
        tokens,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/join", async (req, res, next) => {
    const { code, name } = req.body ?? {};
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "MISSING_CODE" });
      return;
    }
    try {
      const { session, color, token } = await sessionStore.joinSession(code.toUpperCase(), name);
      res.status(200).json({
        sessionId: session.id,
        code: session.code,
        captureMode: session.capture_mode,
        status: session.status,
        yourColor: color,
        token,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
      const statusByError: Record<string, number> = {
        SESSION_NOT_FOUND: 404,
        SESSION_NOT_JOINABLE: 409,
        SESSION_FULL: 409,
      };
      if (message in statusByError) {
        res.status(statusByError[message]).json({ error: message });
        return;
      }
      next(err);
    }
  });

  router.get("/:sessionId", async (req, res, next) => {
    try {
      const session = await sessionStore.getSessionById(req.params.sessionId);
      if (!session) {
        res.status(404).json({ error: "SESSION_NOT_FOUND" });
        return;
      }
      const challenges = await matchStore.listChallenges(session.id);
      res.json({
        sessionId: session.id,
        code: session.code,
        captureMode: session.capture_mode,
        flagVsFlagRule: session.flag_vs_flag_rule,
        status: session.status,
        blueName: session.blue_name,
        redName: session.red_name,
        blueJoined: Boolean(session.blue_token),
        redJoined: Boolean(session.red_token),
        challengeCount: challenges.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // Manual end-of-game flag (spec §4.4 — full board/win-condition tracking is out of scope for MVP).
  router.post("/:sessionId/end", requireAuth(sessionStore), async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const session = (await sessionStore.getSessionById(auth.sessionId))!;

      if (session.status === "ENDED") {
        res.json({ status: "ENDED" });
        return;
      }
      const openChallenge = await matchStore.getOpenChallenge(session.id);
      if (openChallenge) {
        res.status(409).json({
          error: "CHALLENGE_STILL_OPEN",
          message: "Resolve the current challenge before ending the session.",
        });
        return;
      }

      await sessionStore.markEnded(session.id);
      // Retention policy (spec §5.3 recommendation): drop raw photos once the
      // game is over, keep only hashes + ranks already in the match log.
      await purgeSessionPhotos(session.id);
      await matchStore.clearPhotoPaths(session.id);

      res.json({ status: "ENDED" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
