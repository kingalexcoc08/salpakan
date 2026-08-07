/**
 * Official Salpakan (Game of the Generals) rank hierarchy.
 * Index order matters: 0 = highest combat rank, descending to Private,
 * then the two non-hierarchical special pieces (Spy, Flag) which have
 * their own resolution rules (see arbitration.ts).
 */
export enum Rank {
  FiveStarGeneral = "FIVE_STAR_GENERAL",
  FourStarGeneral = "FOUR_STAR_GENERAL",
  ThreeStarGeneral = "THREE_STAR_GENERAL",
  TwoStarGeneral = "TWO_STAR_GENERAL",
  OneStarGeneral = "ONE_STAR_GENERAL",
  Colonel = "COLONEL",
  LieutenantColonel = "LIEUTENANT_COLONEL",
  Major = "MAJOR",
  Captain = "CAPTAIN",
  FirstLieutenant = "FIRST_LIEUTENANT",
  SecondLieutenant = "SECOND_LIEUTENANT",
  Sergeant = "SERGEANT",
  Private = "PRIVATE",
  Spy = "SPY",
  Flag = "FLAG",
}

/**
 * Combat strength ordering, highest first. Spy and Flag are deliberately
 * excluded — they do not participate in the simple "higher number wins"
 * comparison and are handled as special cases in resolveChallenge().
 */
export const COMBAT_RANK_ORDER: readonly Rank[] = [
  Rank.FiveStarGeneral,
  Rank.FourStarGeneral,
  Rank.ThreeStarGeneral,
  Rank.TwoStarGeneral,
  Rank.OneStarGeneral,
  Rank.Colonel,
  Rank.LieutenantColonel,
  Rank.Major,
  Rank.Captain,
  Rank.FirstLieutenant,
  Rank.SecondLieutenant,
  Rank.Sergeant,
  Rank.Private,
];

/** Number of pieces of each rank present in a full 21-piece side. */
export const RANK_COUNTS: Record<Rank, number> = {
  [Rank.FiveStarGeneral]: 1,
  [Rank.FourStarGeneral]: 1,
  [Rank.ThreeStarGeneral]: 1,
  [Rank.TwoStarGeneral]: 1,
  [Rank.OneStarGeneral]: 1,
  [Rank.Colonel]: 1,
  [Rank.LieutenantColonel]: 1,
  [Rank.Major]: 1,
  [Rank.Captain]: 1,
  [Rank.FirstLieutenant]: 1,
  [Rank.SecondLieutenant]: 1,
  [Rank.Sergeant]: 1,
  [Rank.Private]: 6,
  [Rank.Spy]: 2,
  [Rank.Flag]: 1,
};

export const ALL_RANKS: readonly Rank[] = Object.values(Rank);

export const PIECES_PER_SIDE = Object.values(RANK_COUNTS).reduce((a, b) => a + b, 0);

/** Human-readable labels for UI display. */
export const RANK_LABELS: Record<Rank, string> = {
  [Rank.FiveStarGeneral]: "5-Star General",
  [Rank.FourStarGeneral]: "4-Star General",
  [Rank.ThreeStarGeneral]: "3-Star General",
  [Rank.TwoStarGeneral]: "2-Star General",
  [Rank.OneStarGeneral]: "1-Star General",
  [Rank.Colonel]: "Colonel",
  [Rank.LieutenantColonel]: "Lieutenant Colonel",
  [Rank.Major]: "Major",
  [Rank.Captain]: "Captain",
  [Rank.FirstLieutenant]: "1st Lieutenant",
  [Rank.SecondLieutenant]: "2nd Lieutenant",
  [Rank.Sergeant]: "Sergeant",
  [Rank.Private]: "Private",
  [Rank.Spy]: "Spy",
  [Rank.Flag]: "Flag",
};

function combatIndex(rank: Rank): number {
  return COMBAT_RANK_ORDER.indexOf(rank);
}

/** Combat strength of a rank in the linear hierarchy; -1 for Spy/Flag. */
export function rankStrength(rank: Rank): number {
  const idx = combatIndex(rank);
  // Higher strength = higher rank. Reverse the array position so
  // 5-Star General (index 0) has the highest numeric strength.
  return idx === -1 ? -1 : COMBAT_RANK_ORDER.length - idx;
}

export function isCombatRank(rank: Rank): boolean {
  return combatIndex(rank) !== -1;
}
