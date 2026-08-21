import type { Rank } from "@salpakan/shared";
import { Rank as R } from "@salpakan/shared";

/**
 * Set-specific visual grounding for the recognition prompt (spec updates:
 * "Fix Low Recognition Accuracy" and "Reference Rank Manifest"). All 15
 * ranks below are now confirmed, gathered directly from the actual physical
 * set in use — not generic conventions, and not the earlier hedged reading
 * of a compressed reference-sheet photo.
 *
 * Every piece follows the same pattern: a diagonal banner with the rank
 * name printed in English (except Flag, which has no banner/text), plus a
 * rank-specific icon. Each rank exists in two color variants — "light" and
 * "dark" backgrounds, full color scheme inverted between them, same text
 * and icon either way. ("light"/"dark" naming per the spec's explicit
 * instruction: use this unless/until confirmed to map onto different
 * existing team terminology — do not rename without that confirmation.)
 */
export const RANK_VISUAL_HINTS: Record<Rank, string> = {
  [R.FiveStarGeneral]: 'Banner reads "GENERAL". Icon: 5 stars, arranged in a curved/arc formation.',
  [R.FourStarGeneral]: 'Banner reads "GENERAL". Icon: 4 stars, roughly a square/2×2 grouping.',
  [R.ThreeStarGeneral]: 'Banner reads "GENERAL". Icon: 3 stars, slight arc/row.',
  [R.TwoStarGeneral]: 'Banner reads "GENERAL". Icon: 2 stars, side by side.',
  [R.OneStarGeneral]: 'Banner reads "GENERAL". Icon: 1 star, centered.',
  [R.Colonel]: 'Banner reads "COLONEL". Icon: 3 wheel/gear emblems, each with the letter "I" in its center.',
  [R.LieutenantColonel]: 'Banner reads "LT. COL.". Icon: 2 wheel/gear emblems, each with the letter "I" in its center.',
  [R.Major]: 'Banner reads "MAJOR". Icon: 1 wheel/gear emblem with the letter "I" in its center.',
  [R.Captain]: 'Banner reads "CAPTAIN". Icon: 3 triangle shapes, each containing the number "1".',
  [R.FirstLieutenant]: 'Banner reads "1st LIEUT.". Icon: 2 triangle shapes, each containing the number "1".',
  [R.SecondLieutenant]: 'Banner reads "2nd LIEUT.". Icon: 1 triangle shape, containing the number "1".',
  [R.Sergeant]: 'Banner reads "SERGEANT". Icon: a stacked chevron/arrow shape — 3 bars forming a peak, no numbers.',
  [R.Private]: 'Banner reads "PRIVATE". Icon: a single chevron — one inverted-V bar, no numbers.',
  [R.Spy]: 'Banner reads "SPY". Icon: a stylized pair of narrowed eyes, no numbers.',
  [R.Flag]: "No banner/text at all — this is the one piece without printed rank text. Icon: a curved pennant/scarf shape with two small star-burst marks.",
};

/**
 * The three rank clusters that share near-identical banner text/icon shape
 * and are distinguished ONLY by a count — the highest-risk spots for a
 * miscount under real capture conditions (glare, tilt, blur). Surfaced both
 * in the per-rank hints above (implicitly, via the shared wording) and as
 * an explicit prompt instruction in visionService.ts — see buildPrompt().
 */
export const AMBIGUOUS_COUNT_CLUSTERS: ReadonlyArray<{ ranks: Rank[]; description: string }> = [
  {
    ranks: [R.FiveStarGeneral, R.FourStarGeneral, R.ThreeStarGeneral, R.TwoStarGeneral, R.OneStarGeneral],
    description: 'All five General ranks share identical banner text ("GENERAL") and are distinguished purely by star count (5/4/3/2/1) — count the stars carefully, do not pattern-match on the word "GENERAL" alone.',
  },
  {
    ranks: [R.Colonel, R.LieutenantColonel, R.Major],
    description: "Colonel/Lt. Colonel/Major share the same wheel-with-\"I\" icon, distinguished purely by count (3/2/1) — count the wheel emblems carefully.",
  },
  {
    ranks: [R.Captain, R.FirstLieutenant, R.SecondLieutenant],
    description: 'Captain/1st Lieutenant/2nd Lieutenant share the same triangle-with-"1" icon, distinguished purely by count (3/2/1) — count the triangles carefully.',
  },
];

/** Broad encoding family per rank — used to pick "grouped" (cheaper) few-shot examples, and to group the counting-care instruction above. */
export type RankEncoding = "general-stars" | "field-grade-wheel" | "company-grade-triangle" | "chevron" | "special";

export const RANK_ENCODING: Record<Rank, RankEncoding> = {
  [R.FiveStarGeneral]: "general-stars",
  [R.FourStarGeneral]: "general-stars",
  [R.ThreeStarGeneral]: "general-stars",
  [R.TwoStarGeneral]: "general-stars",
  [R.OneStarGeneral]: "general-stars",
  [R.Colonel]: "field-grade-wheel",
  [R.LieutenantColonel]: "field-grade-wheel",
  [R.Major]: "field-grade-wheel",
  [R.Captain]: "company-grade-triangle",
  [R.FirstLieutenant]: "company-grade-triangle",
  [R.SecondLieutenant]: "company-grade-triangle",
  [R.Sergeant]: "chevron",
  [R.Private]: "chevron",
  [R.Spy]: "special",
  [R.Flag]: "special",
};

/** Per-set color variant — full color scheme inverted between the two, same text/icon either way. See file header re: naming. */
export type PieceVariant = "light" | "dark";

export interface ReferenceImage {
  rank: Rank;
  variant: PieceVariant;
  /** Raw base64-encoded image bytes (no data: URL prefix). */
  base64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

/**
 * True few-shot reference photos, ideally one clean close-up per rank per
 * variant (light + dark — up to 30 entries). Empty until real individual
 * photos are supplied. Populate this array once photos are available;
 * nothing else needs to change — pickReferenceImages() below picks them up
 * automatically, and buildPrompt() in visionService.ts already labels each
 * attached reference with its rank when embedding it.
 */
export const REFERENCE_IMAGES: ReferenceImage[] = [];

export type ReferenceImageMode = "none" | "grouped" | "full";

/**
 * Selects which reference images to attach to a recognition call.
 * - "none": never attach any (cheapest/fastest).
 * - "grouped": at most one representative image per RankEncoding family
 *   (the suggested fallback if attaching everything is too expensive/slow)
 *   — picks whichever variant appears first for that family, not both.
 * - "full": every available reference image (every rank, every variant on file).
 * Gracefully returns [] regardless of mode while REFERENCE_IMAGES is empty.
 */
export function pickReferenceImages(mode: ReferenceImageMode): ReferenceImage[] {
  if (mode === "none" || REFERENCE_IMAGES.length === 0) return [];
  if (mode === "full") return REFERENCE_IMAGES;

  const seen = new Set<RankEncoding>();
  const picked: ReferenceImage[] = [];
  for (const img of REFERENCE_IMAGES) {
    const family = RANK_ENCODING[img.rank];
    if (seen.has(family)) continue;
    seen.add(family);
    picked.push(img);
  }
  return picked;
}
