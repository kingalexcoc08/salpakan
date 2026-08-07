import { Rank } from "./ranks.js";
import { rankStrength } from "./ranks.js";

/**
 * A challenge always involves exactly two sides. The pure arbitration
 * function is deliberately side-label-agnostic ("A"/"B") — callers (server,
 * UI) map their own concepts (e.g. "BLUE"/"RED", player IDs) onto A/B right
 * before calling in, and map the result back right after. This keeps the
 * trust-critical comparison logic free of any app/session concepts so it
 * stays trivially unit-testable and reusable (§5.2).
 */
export type ChallengeSide = "A" | "B";

export interface ChallengeOutcomeWin {
  type: "win";
  winner: ChallengeSide;
  loser: ChallengeSide;
  /** Human-readable reason, useful for match-log audit trails and UI copy. */
  reason: string;
}

export interface ChallengeOutcomeMutual {
  type: "mutualDestruction";
  reason: string;
}

export type ChallengeOutcome = ChallengeOutcomeWin | ChallengeOutcomeMutual;

export type FlagVsFlagRule = "challengerWins" | "mutualDestruction";

export interface ArbitrationOptions {
  /**
   * House rule for a Flag vs Flag challenge. Tournament-standard default
   * ("challengerWins") lets the flag that initiated the challenge capture
   * the stationary one. Configurable because local variants differ — see
   * spec §1.2 / §9 open question.
   */
  flagVsFlagRule?: FlagVsFlagRule;
}

const DEFAULT_OPTIONS: Required<ArbitrationOptions> = {
  flagVsFlagRule: "challengerWins",
};

function otherSide(side: ChallengeSide): ChallengeSide {
  return side === "A" ? "B" : "A";
}

function win(winner: ChallengeSide, reason: string): ChallengeOutcomeWin {
  return { type: "win", winner, loser: otherSide(winner), reason };
}

function mutual(reason: string): ChallengeOutcomeMutual {
  return { type: "mutualDestruction", reason };
}

/**
 * Resolves a single piece-vs-piece challenge according to the official
 * Salpakan rank hierarchy and special-case rules (spec §1.2):
 *
 *  1. Flag vs Flag — house rule (default: challenger wins).
 *  2. Flag vs anything else — the Flag is always captured, no matter the
 *     other piece's rank (a Flag has no combat strength).
 *  3. Equal rank (including Private-vs-Private and Spy-vs-Spy) — mutual
 *     destruction, both pieces removed.
 *  4. Spy vs Private — the Private always wins, regardless of who
 *     initiated the challenge. This is checked before the general Spy rule.
 *  5. Spy vs any other combat rank — the Spy wins (Spies beat every rank
 *     except Private).
 *  6. Otherwise — standard rule: higher rank in the 14-rank hierarchy wins.
 *
 * This function is pure and has no knowledge of recognition/photos/sessions
 * — see spec §5.2. It must not throw for any pair of valid Rank values.
 */
export function resolveChallenge(
  rankA: Rank,
  rankB: Rank,
  whoInitiated: ChallengeSide,
  options: ArbitrationOptions = {},
): ChallengeOutcome {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 1. Flag vs Flag
  if (rankA === Rank.Flag && rankB === Rank.Flag) {
    if (opts.flagVsFlagRule === "mutualDestruction") {
      return mutual("Flag vs Flag: house rule is mutual destruction.");
    }
    return win(whoInitiated, "Flag vs Flag: the challenging Flag captures the stationary one.");
  }

  // 2. Flag vs anything else — Flag has no combat strength, always captured.
  if (rankA === Rank.Flag) {
    return win("B", "A Flag has no combat strength and is captured by any challenger.");
  }
  if (rankB === Rank.Flag) {
    return win("A", "A Flag has no combat strength and is captured by any challenger.");
  }

  // 3. Equal rank -> mutual destruction (covers Private-vs-Private, Spy-vs-Spy, etc.)
  if (rankA === rankB) {
    return mutual(`Equal rank (${rankA}): both pieces are eliminated.`);
  }

  // 4. Spy vs Private special case — Private always wins, regardless of initiator.
  if (rankA === Rank.Spy && rankB === Rank.Private) {
    return win("B", "Private defeats Spy (special rule), regardless of who initiated.");
  }
  if (rankB === Rank.Spy && rankA === Rank.Private) {
    return win("A", "Private defeats Spy (special rule), regardless of who initiated.");
  }

  // 5. Spy vs any other combat rank — the Spy wins.
  if (rankA === Rank.Spy) {
    return win("A", "Spy defeats all combat ranks except Private.");
  }
  if (rankB === Rank.Spy) {
    return win("B", "Spy defeats all combat ranks except Private.");
  }

  // 6. Standard rule — higher rank in the hierarchy wins.
  const strengthA = rankStrength(rankA);
  const strengthB = rankStrength(rankB);
  if (strengthA > strengthB) {
    return win("A", `${rankA} outranks ${rankB}.`);
  }
  return win("B", `${rankB} outranks ${rankA}.`);
}
