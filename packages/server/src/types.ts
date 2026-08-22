import type { CaptureMode, FlagVsFlagRule, PlayerColor } from "@salpakan/shared";

export type SessionStatus = "WAITING_FOR_OPPONENT" | "ACTIVE" | "ENDED";
/** ABANDONED = discarded while still OPEN (recovery for a challenge nobody ever finished) — never resolved, never chained. */
export type ChallengeStatus = "OPEN" | "RESOLVED" | "ABANDONED";

export interface SessionRow {
  id: string;
  code: string;
  capture_mode: CaptureMode;
  flag_vs_flag_rule: FlagVsFlagRule;
  status: SessionStatus;
  blue_name: string | null;
  red_name: string | null;
  blue_token: string | null;
  red_token: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface ChallengeRow {
  id: string;
  session_id: string;
  challenge_number: number;
  initiator: PlayerColor;
  status: ChallengeStatus;
  blue_photo_hash: string | null;
  blue_rank: string | null;
  blue_confidence: number | null;
  blue_photo_path: string | null;
  red_photo_hash: string | null;
  red_rank: string | null;
  red_confidence: number | null;
  red_photo_path: string | null;
  result_type: string | null;
  result_winner: PlayerColor | null;
  result_loser: PlayerColor | null;
  result_reason: string | null;
  previous_hash: string | null;
  record_hash: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AuthedPlayer {
  sessionId: string;
  color: PlayerColor;
}
