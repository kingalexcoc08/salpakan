import { verifyChain } from "@salpakan/shared";
import { Router } from "express";
import { getAuth, requireAuth } from "../auth.js";
import type { MatchStore } from "../store/matchStore.js";
import type { SessionStore } from "../store/sessionStore.js";

/**
 * Post-game match history (spec §5.5) — the only place both players' ranks
 * are ever revealed together, and only once the game has ended. Doubles as
 * the dispute-resolution record: includes a hash-chain integrity check so
 * tampering with any past record is detectable.
 */
export function createHistoryRouter(sessionStore: SessionStore, matchStore: MatchStore): Router {
  const router = Router({ mergeParams: true });

  router.get("/", requireAuth(sessionStore), async (req, res, next) => {
    try {
      const auth = getAuth(res);
      const session = (await sessionStore.getSessionById(auth.sessionId))!;

      if (session.status !== "ENDED") {
        res.status(409).json({
          error: "SESSION_NOT_ENDED",
          message: "Match history is only available after the session has ended (spec §5.0/§5.5).",
        });
        return;
      }

      const records = await matchStore.getResolvedRecords(auth.sessionId);
      const integrity = await verifyChain(records);

      res.json({
        sessionId: session.id,
        blueName: session.blue_name,
        redName: session.red_name,
        endedAt: session.ended_at,
        integrity,
        challenges: records.map((r) => ({
          challengeNumber: r.challengeNumber,
          timestamp: r.timestamp,
          initiator: r.initiator,
          blue: { rank: r.blue.recognizedRank, confidence: r.blue.confidence, photoHash: r.blue.photoHash },
          red: { rank: r.red.recognizedRank, confidence: r.red.confidence, photoHash: r.red.photoHash },
          result: r.result,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
