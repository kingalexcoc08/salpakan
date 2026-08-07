import type { Rank } from "./ranks.js";

/** Which physical color/side a player is playing, distinct from A/B used
 * internally by the pure arbitration function. */
export type PlayerColor = "BLUE" | "RED";

export type CaptureMode = "TWO_PHONE" | "ONE_PHONE";

export interface PlayerSubmission {
  photoHash: string;
  recognizedRank: Rank;
  confidence: number;
}

/**
 * The outcome of a resolved challenge expressed in app-level PlayerColor
 * terms, for persistence/display. This is the color-mapped counterpart of
 * arbitration.ts's side-agnostic ChallengeOutcome ("A"/"B") — callers map
 * one to the other right at the resolution boundary (see server matchStore).
 */
export type MatchRecordResult =
  | { type: "win"; winner: PlayerColor; loser: PlayerColor; reason: string }
  | { type: "mutualDestruction"; reason: string };

/**
 * One entry in the tamper-evident match log (spec §5.3). `recordHash` is
 * computed over every other field plus `previousHash`, so altering any
 * field of a past record — or reordering/removing one — changes its hash
 * and breaks the chain for every record after it.
 */
export interface MatchRecord {
  sessionId: string;
  challengeNumber: number;
  timestamp: string; // ISO-8601
  blue: PlayerSubmission;
  red: PlayerSubmission;
  initiator: PlayerColor;
  result: MatchRecordResult;
  /** "GENESIS" for the first record in a session. */
  previousHash: string;
  recordHash: string;
}

/** Fields that go into the hash — i.e. everything except the resulting hash itself. */
export type MatchRecordContent = Omit<MatchRecord, "recordHash">;

export interface ChainVerificationResult {
  valid: boolean;
  /** Index of the first record whose hash doesn't match, if invalid. */
  brokenAtIndex?: number;
  reason?: string;
}
