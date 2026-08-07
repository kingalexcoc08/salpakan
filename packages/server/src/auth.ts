import type { NextFunction, Request, Response } from "express";
import type { SessionStore } from "./store/sessionStore.js";
import type { AuthedPlayer } from "./types.js";

/**
 * Verifies the `Authorization: Bearer <token>` header against the session's
 * per-color tokens and attaches the resolved player (sessionId + color) to
 * `res.locals.auth`. A token only ever proves "you are BLUE" or "you are
 * RED" for one specific session — it carries no other identity.
 */
export function requireAuth(sessionStore: SessionStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.params.sessionId;
      const header = req.header("authorization") ?? "";
      const [scheme, token] = header.split(" ");

      if (scheme !== "Bearer" || !token) {
        res.status(401).json({ error: "MISSING_TOKEN", message: "Authorization: Bearer <token> header is required." });
        return;
      }

      const color = await sessionStore.authenticate(sessionId, token);
      if (!color) {
        res.status(401).json({ error: "INVALID_TOKEN", message: "Token does not match this session." });
        return;
      }

      const auth: AuthedPlayer = { sessionId, color };
      res.locals.auth = auth;
      next();
    } catch (err) {
      // Express 4 does not auto-catch rejected promises from async
      // middleware — forward explicitly so a DB error reaches the error
      // handler instead of hanging the request.
      next(err);
    }
  };
}

export function getAuth(res: Response): AuthedPlayer {
  return res.locals.auth as AuthedPlayer;
}
