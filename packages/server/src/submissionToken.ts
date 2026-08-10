import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlayerColor, Rank } from "@salpakan/shared";
import { config } from "./config.js";

/**
 * Recognition-confirmation flow (spec update: "Recognition Confirmation
 * Step"): once a photo is recognized, the player reviews the result before
 * it's locked into the challenge. The server must not persist anything
 * between "recognized" and "confirmed" — a rejected recognition leaves no
 * trace (§2.1) — but it also must not let a client simply assert its own
 * rank at confirm time, or the whole point of server-side recognition (not
 * letting a player just claim any rank they like) is defeated.
 *
 * This token is the resolution: a signed, tamper-evident receipt of exactly
 * what was recognized, handed back to the client to hold (not the server)
 * between the preview and confirm requests. The confirm step trusts the
 * rank/confidence *inside* the token, never anything the client sends
 * directly — so confirming only ever locks in what was actually recognized.
 */
export interface SubmissionTokenPayload {
  sessionId: string;
  challengeId: string;
  color: PlayerColor;
  rank: Rank;
  confidence: number;
  /** SHA-256 hex hash of the exact photo bytes this rank was recognized from. */
  photoHash: string;
  issuedAt: number;
}

// Generous enough to cover a normal "look at the screen, tap confirm" pause
// (including the one-phone hand-off happening around it, per §2.2 — this
// window only needs to outlast a single player's own turn), short enough
// that a token can't be meaningfully replayed long after its challenge
// has moved on.
const TOKEN_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  return config.submissionTokenSecret || config.databaseUrl || "dev-only-insecure-submission-token-secret";
}

function sign(base64Body: string): string {
  return createHmac("sha256", secret()).update(base64Body).digest("base64url");
}

export function signSubmissionToken(payload: SubmissionTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns the payload if the token is well-formed, unexpired, and its signature checks out — otherwise null. */
export function verifySubmissionToken(token: string): SubmissionTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: SubmissionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.issuedAt !== "number" || Date.now() - payload.issuedAt > TOKEN_TTL_MS) {
    return null;
  }
  return payload;
}
