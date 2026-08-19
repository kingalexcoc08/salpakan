import type { PlayerColor, Rank } from "@salpakan/shared";
import type { Queryable } from "../db.js";
import { generateFeedbackId } from "../ids.js";

/**
 * Recognition accuracy feedback (spec update "Fix Low Recognition Accuracy"
 * §2.5). Deliberately a separate, non-chained table from the match log —
 * this data is for measuring/tuning recognition accuracy over time, never
 * for arbitration, and must never be read by the hash-chain/history code.
 *
 * A row is created when a player rejects a recognized rank (retake) and
 * later, if that same player goes on to confirm a different photo for the
 * same challenge, the row is backfilled with what they actually confirmed —
 * giving a labeled (guessed → confirmed) pair for that misread.
 */
export class RecognitionFeedbackStore {
  constructor(private readonly db: Queryable) {}

  async recordRejection(params: {
    sessionId: string;
    challengeId: string;
    color: PlayerColor;
    guessedRank: Rank;
    guessedConfidence: number;
    photoHash: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO recognition_feedback
        (id, session_id, challenge_id, color, guessed_rank, guessed_confidence, photo_hash, confirmed_rank, created_at, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, NULL)`,
      [
        generateFeedbackId(),
        params.sessionId,
        params.challengeId,
        params.color,
        params.guessedRank,
        params.guessedConfidence,
        params.photoHash,
        new Date().toISOString(),
      ],
    );
  }

  /** Backfills every still-open rejection row for this challenge/color with what was eventually confirmed. Safe to call even if there were no prior rejections (no-op). */
  async linkConfirmedRank(params: { sessionId: string; challengeId: string; color: PlayerColor; confirmedRank: Rank }): Promise<void> {
    await this.db.query(
      `UPDATE recognition_feedback
       SET confirmed_rank = $1, confirmed_at = $2
       WHERE session_id = $3 AND challenge_id = $4 AND color = $5 AND confirmed_rank IS NULL`,
      [params.confirmedRank, new Date().toISOString(), params.sessionId, params.challengeId, params.color],
    );
  }
}
