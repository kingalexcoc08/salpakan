import {
  computeRecordHash,
  GENESIS_HASH,
  resolveChallenge,
  type ChallengeSide,
  type FlagVsFlagRule,
  type MatchRecord,
  type MatchRecordContent,
  type MatchRecordResult,
  type PlayerColor,
  Rank,
} from "@salpakan/shared";
import type { Queryable } from "../db.js";
import { generateChallengeId } from "../ids.js";
import type { ChallengeRow } from "../types.js";

export interface PieceSubmission {
  photoHash: string;
  photoPath: string;
  rank: Rank;
  confidence: number;
}

/**
 * Fixed, app-wide mapping between the pure arbitration function's
 * side-agnostic "A"/"B" labels and this app's BLUE/RED player colors. Kept
 * in one place so it's trivial to audit that it's applied consistently.
 */
function colorToSide(color: PlayerColor): ChallengeSide {
  return color === "BLUE" ? "A" : "B";
}
function sideToColor(side: ChallengeSide): PlayerColor {
  return side === "A" ? "BLUE" : "RED";
}

export class ChallengeAlreadyOpenError extends Error {}
export class ChallengeNotFoundError extends Error {}
export class ChallengeAlreadyResolvedError extends Error {}

export class MatchStore {
  constructor(private readonly db: Queryable) {}

  async createChallenge(sessionId: string, initiator: PlayerColor): Promise<ChallengeRow> {
    const existingOpen = await this.db.query("SELECT id FROM challenges WHERE session_id = $1 AND status = 'OPEN'", [
      sessionId,
    ]);
    if (existingOpen.rows.length > 0) {
      throw new ChallengeAlreadyOpenError("A challenge is already open for this session.");
    }

    const countResult = await this.db.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM challenges WHERE session_id = $1",
      [sessionId],
    );
    const challengeNumber = Number(countResult.rows[0]?.c ?? 0) + 1;
    const id = generateChallengeId();
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO challenges (id, session_id, challenge_number, initiator, status, created_at)
       VALUES ($1, $2, $3, $4, 'OPEN', $5)`,
      [id, sessionId, challengeNumber, initiator, now],
    );

    return (await this.getChallenge(sessionId, id))!;
  }

  async getChallenge(sessionId: string, challengeId: string): Promise<ChallengeRow | undefined> {
    const result = await this.db.query<ChallengeRow>("SELECT * FROM challenges WHERE session_id = $1 AND id = $2", [
      sessionId,
      challengeId,
    ]);
    return result.rows[0];
  }

  async getOpenChallenge(sessionId: string): Promise<ChallengeRow | undefined> {
    const result = await this.db.query<ChallengeRow>(
      "SELECT * FROM challenges WHERE session_id = $1 AND status = 'OPEN' LIMIT 1",
      [sessionId],
    );
    return result.rows[0];
  }

  async listChallenges(sessionId: string): Promise<ChallengeRow[]> {
    const result = await this.db.query<ChallengeRow>(
      "SELECT * FROM challenges WHERE session_id = $1 ORDER BY challenge_number ASC",
      [sessionId],
    );
    return result.rows;
  }

  private async getLastRecordHash(sessionId: string): Promise<string> {
    const result = await this.db.query<{ record_hash: string }>(
      "SELECT record_hash FROM challenges WHERE session_id = $1 AND status = 'RESOLVED' ORDER BY challenge_number DESC LIMIT 1",
      [sessionId],
    );
    return result.rows[0]?.record_hash ?? GENESIS_HASH;
  }

  /**
   * Records one player's piece submission for an open challenge. Once both
   * BLUE and RED have submitted, resolves the challenge via the pure
   * `resolveChallenge` function and appends a hash-chained record (spec
   * §5.2/§5.3). Returns the updated row either way.
   */
  async submitPiece(
    sessionId: string,
    challengeId: string,
    color: PlayerColor,
    submission: PieceSubmission,
    flagVsFlagRule: FlagVsFlagRule,
  ): Promise<ChallengeRow> {
    const challenge = await this.getChallenge(sessionId, challengeId);
    if (!challenge) {
      throw new ChallengeNotFoundError("No such challenge.");
    }
    if (challenge.status !== "OPEN") {
      throw new ChallengeAlreadyResolvedError("This challenge has already been resolved.");
    }

    const hashCol = color === "BLUE" ? "blue_photo_hash" : "red_photo_hash";
    const rankCol = color === "BLUE" ? "blue_rank" : "red_rank";
    const confCol = color === "BLUE" ? "blue_confidence" : "red_confidence";
    const pathCol = color === "BLUE" ? "blue_photo_path" : "red_photo_path";

    await this.db.query(
      `UPDATE challenges SET ${hashCol} = $1, ${rankCol} = $2, ${confCol} = $3, ${pathCol} = $4 WHERE id = $5`,
      [submission.photoHash, submission.rank, submission.confidence, submission.photoPath, challengeId],
    );

    let updated = (await this.getChallenge(sessionId, challengeId))!;

    if (updated.blue_rank && updated.red_rank) {
      const outcome = resolveChallenge(updated.blue_rank as Rank, updated.red_rank as Rank, colorToSide(updated.initiator), {
        flagVsFlagRule,
      });

      const colorResult: MatchRecordResult =
        outcome.type === "win"
          ? { type: "win", winner: sideToColor(outcome.winner), loser: sideToColor(outcome.loser), reason: outcome.reason }
          : { type: "mutualDestruction", reason: outcome.reason };

      const resultType = colorResult.type;
      const resultWinner = colorResult.type === "win" ? colorResult.winner : null;
      const resultLoser = colorResult.type === "win" ? colorResult.loser : null;
      const resultReason = colorResult.reason;

      const previousHash = await this.getLastRecordHash(sessionId);
      const content: MatchRecordContent = {
        sessionId,
        challengeNumber: updated.challenge_number,
        timestamp: new Date().toISOString(),
        blue: {
          photoHash: updated.blue_photo_hash!,
          recognizedRank: updated.blue_rank as Rank,
          confidence: updated.blue_confidence!,
        },
        red: {
          photoHash: updated.red_photo_hash!,
          recognizedRank: updated.red_rank as Rank,
          confidence: updated.red_confidence!,
        },
        initiator: updated.initiator,
        result: colorResult,
        previousHash,
      };
      const recordHash = await computeRecordHash(content);

      await this.db.query(
        `UPDATE challenges SET
           status = 'RESOLVED',
           result_type = $1, result_winner = $2, result_loser = $3, result_reason = $4,
           previous_hash = $5, record_hash = $6, resolved_at = $7
         WHERE id = $8`,
        [resultType, resultWinner, resultLoser, resultReason, previousHash, recordHash, content.timestamp, challengeId],
      );

      updated = (await this.getChallenge(sessionId, challengeId))!;
    }

    return updated;
  }

  /** Converts a RESOLVED row into the canonical shared MatchRecord shape (for history + chain verification). */
  toMatchRecord(row: ChallengeRow): MatchRecord | null {
    if (row.status !== "RESOLVED" || !row.record_hash || !row.previous_hash || !row.resolved_at) {
      return null;
    }
    const result =
      row.result_type === "mutualDestruction"
        ? { type: "mutualDestruction" as const, reason: row.result_reason ?? "" }
        : {
            type: "win" as const,
            winner: row.result_winner!,
            loser: row.result_loser!,
            reason: row.result_reason ?? "",
          };

    return {
      sessionId: row.session_id,
      challengeNumber: row.challenge_number,
      timestamp: row.resolved_at,
      blue: {
        photoHash: row.blue_photo_hash!,
        recognizedRank: row.blue_rank as Rank,
        confidence: row.blue_confidence!,
      },
      red: {
        photoHash: row.red_photo_hash!,
        recognizedRank: row.red_rank as Rank,
        confidence: row.red_confidence!,
      },
      initiator: row.initiator,
      result,
      previousHash: row.previous_hash,
      recordHash: row.record_hash,
    };
  }

  /** Clears the on-disk photo path columns after files are purged (spec §5.3 retention policy). */
  async clearPhotoPaths(sessionId: string): Promise<void> {
    await this.db.query("UPDATE challenges SET blue_photo_path = NULL, red_photo_path = NULL WHERE session_id = $1", [
      sessionId,
    ]);
  }

  async getResolvedRecords(sessionId: string): Promise<MatchRecord[]> {
    const rows = await this.listChallenges(sessionId);
    return rows.map((row) => this.toMatchRecord(row)).filter((r): r is MatchRecord => r !== null);
  }
}
