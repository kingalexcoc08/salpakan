import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { createChallengeRouter } from "./routes/challengeRoutes.js";
import { createHistoryRouter } from "./routes/historyRoutes.js";
import { createSessionRouter } from "./routes/sessionRoutes.js";
import type { VisionService } from "./services/visionService.js";
import { MatchStore } from "./store/matchStore.js";
import { SessionStore } from "./store/sessionStore.js";

export function createApp(db: DatabaseSync, visionService: VisionService): Express {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  const sessionStore = new SessionStore(db);
  const matchStore = new MatchStore(db);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/sessions", createSessionRouter(sessionStore, matchStore));
  app.use("/api/sessions/:sessionId/challenges", createChallengeRouter(sessionStore, matchStore, visionService));
  app.use("/api/sessions/:sessionId/history", createHistoryRouter(sessionStore, matchStore));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isPhotoTooLargeError(err)) {
      res.status(413).json({ error: "PHOTO_TOO_LARGE" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  });

  return app;
}

// Narrow multer's LIMIT_FILE_SIZE error without importing multer's error
// class directly in the error handler's type position.
function isPhotoTooLargeError(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "LIMIT_FILE_SIZE";
}
