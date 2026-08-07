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
import type { DatabaseSync } from "node:sqlite";
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
  constructor(private readonly db: DatabaseSync) {}

  createChallenge(sessionId: string, initiator: PlayerColor): ChallengeRow {
    const existingOpen = this.db
      .prepare("SELECT id FROM challenges WHERE session_id = ? AND status = 'OPEN'")
      .get(sessionId);
    if (existingOpen) {
      throw new ChallengeAlreadyOpenError("A challenge is already open for this session.");
    }

    const countRow = this.db.prepare("SELECT COUNT(*) as c FROM challenges WHERE session_id = ?").get(sessionId) as {
      c: number;
    };
    const challengeNumber = countRow.c + 1;
    const id = generateChallengeId();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO challenges (id, session_id, challenge_number, initiator, status, created_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?)`,
      )
      .run(id, sessionId, challengeNumber, initiator, now);

    return this.getChallenge(sessionId, id)!;
  }

  getChallenge(sessionId: string, challengeId: string): ChallengeRow | undefined {
    return this.db
      .prepare("SELECT * FROM challenges WHERE session_id = ? AND id = ?")
      .get(sessionId, challengeId) as ChallengeRow | undefined;
  }

  getOpenChallenge(sessionId: string): ChallengeRow | undefined {
    return this.db
      .prepare("SELECT * FROM challenges WHERE session_id = ? AND status = 'OPEN' LIMIT 1")
      .get(sessionId) as ChallengeRow | undefined;
  }

  listChallenges(sessionId: string): ChallengeRow[] {
    return this.db
      .prepare("SELECT * FROM challenges WHERE session_id = ? ORDER BY challenge_number ASC")
      .all(sessionId) as unknown as ChallengeRow[];
  }

  private getLastRecordHash(sessionId: string): string {
    const row = this.db
      .prepare(
        "SELECT record_hash FROM challenges WHERE session_id = ? AND status = 'RESOLVED' ORDER BY challenge_number DESC LIMIT 1",
      )
      .get(sessionId) as { record_hash: string } | undefined;
    return row?.record_hash ?? GENESIS_HASH;
  }

  /**
   * Records one player's piece submission for an open challenge. Once both
   * BLUE and RED have submitted, resolves the challenge via the pure
   * `resolveChallenge` function and appends a hash-chained record (spec
   * §5.2/§5.3). Returns the updated row either way.
   */
  async submitPiece(sessionId: string, challengeId: string, color: PlayerColor, submission: PieceSubmission, flagVsFlagRule: FlagVsFlagRule): Promise<ChallengeRow> {
    const challenge = this.getChallenge(sessionId, challengeId);
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

    this.db
      .prepare(`UPDATE challenges SET ${hashCol} = ?, ${rankCol} = ?, ${confCol} = ?, ${pathCol} = ? WHERE id = ?`)
      .run(submission.photoHash, submission.rank, submission.confidence, submission.photoPath, challengeId);

    let updated = this.getChallenge(sessionId, challengeId)!;

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

      const previousHash = this.getLastRecordHash(sessionId);
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

      this.db
        .prepare(
          `UPDATE challenges SET
             status = 'RESOLVED',
             result_type = ?, result_winner = ?, result_loser = ?, result_reason = ?,
             previous_hash = ?, record_hash = ?, resolved_at = ?
           WHERE id = ?`,
        )
        .run(resultType, resultWinner, resultLoser, resultReason, previousHash, recordHash, content.timestamp, challengeId);

      updated = this.getChallenge(sessionId, challengeId)!;
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
  clearPhotoPaths(sessionId: string): void {
    this.db
      .prepare("UPDATE challenges SET blue_photo_path = NULL, red_photo_path = NULL WHERE session_id = ?")
      .run(sessionId);
  }

  getResolvedRecords(sessionId: string): MatchRecord[] {
    return this.listChallenges(sessionId)
      .map((row) => this.toMatchRecord(row))
      .filter((r): r is MatchRecord => r !== null);
  }
}
