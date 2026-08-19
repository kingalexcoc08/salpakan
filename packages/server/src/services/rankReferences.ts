import type { Rank } from "@salpakan/shared";
import { Rank as R } from "@salpakan/shared";

/**
 * Set-specific visual grounding for the recognition prompt (spec update:
 * "Fix Low Recognition Accuracy" §2.1). Derived from a photo of the actual
 * physical set's piece-face reference sheet the user provided, NOT 15
 * individual clean close-up photos — so this is real, set-specific
 * information (a solid step up from generic conventions), but a few details
 * are hedged where the reference sheet's resolution made an exact count
 * hard to verify (see inline notes). Replace/tighten any of these once
 * clearer individual photos are available — nothing else needs to change,
 * this file is the single place that grounds the prompt.
 *
 * Confirmed from the reference sheet: every piece carries BOTH printed
 * English rank text AND a symbolic icon (not a strict text-only vs.
 * icon-only split) — recognition can and should use whichever is clearer.
 */
export const RANK_VISUAL_HINTS: Record<Rank, string> = {
  [R.FiveStarGeneral]: 'Printed text "GENERAL" plus a row of 5 plain five-pointed stars.',
  [R.FourStarGeneral]: 'Printed text "GENERAL" plus a row of 4 plain five-pointed stars.',
  [R.ThreeStarGeneral]: 'Printed text "GENERAL" plus a row of 3 plain five-pointed stars.',
  [R.TwoStarGeneral]: 'Printed text "GENERAL" plus a row of 2 plain five-pointed stars.',
  [R.OneStarGeneral]: 'Printed text "GENERAL" plus 1 plain five-pointed star. The star shape itself is plain/simple — contrast with the different sunburst-style glyph used by Major/Lt. Colonel/Colonel below.',
  [R.Colonel]:
    'Printed text "COLONEL" plus a cluster of sunburst/starburst-style insignia (a different, more elaborate glyph than the plain stars Generals use) — this rank has the most of that cluster among Major/Lt. Colonel/Colonel.',
  [R.LieutenantColonel]:
    'Printed text "LT. COL." (or "LIEUTENANT COLONEL") plus a sunburst/starburst cluster — fewer than Colonel, more than Major. If the exact count is unclear from the photo, weigh the text more heavily than the icon count for this rank.',
  [R.Major]: 'Printed text "MAJOR" plus a single sunburst/starburst insignia (the same glyph family as Lt. Colonel/Colonel, but only one).',
  [R.Captain]:
    'Printed text "CAPTAIN" plus triangle icon(s). Captain and 1st Lieutenant use visually similar triangle insignia on this set — the printed text is the more reliable signal for telling these two apart specifically.',
  [R.FirstLieutenant]:
    'Printed text "1ST LIEUT." (or "FIRST LIEUTENANT") plus triangle icon(s), visually similar to Captain\'s — rely on the text to disambiguate from Captain.',
  [R.SecondLieutenant]: 'Printed text "2ND LIEUT." (or "SECOND LIEUTENANT") plus a single triangle — fewer triangles than Captain/1st Lieutenant.',
  [R.Sergeant]: 'Printed text "SERGEANT" plus a chevron/stripe icon that is visually fancier/thicker than Private\'s plain chevron below.',
  [R.Private]: 'Printed text "PRIVATE" plus one plain, simple chevron ("∧" shape) — the plainest-looking insignia of any rank piece, and the lowest combat rank.',
  [R.Spy]:
    'Printed text "SPY" plus a distinctive cartoon icon of an eye peeking out from a hood/hat shape — visually unique and easy to distinguish from every rank piece; not a star, sunburst, triangle, or chevron.',
  [R.Flag]:
    "A distinctive flag/banner-like swirl icon. Unlike every other piece, the Flag typically carries little or no rank text — its icon alone is visually unique from all 14 rank pieces.",
};

/** Broad encoding family per rank — used to pick "grouped" (cheaper) few-shot examples in §2.2, and available for future prompt tuning. */
export type RankEncoding = "general-stars" | "field-grade-sunburst" | "company-grade-triangle" | "chevron" | "special";

export const RANK_ENCODING: Record<Rank, RankEncoding> = {
  [R.FiveStarGeneral]: "general-stars",
  [R.FourStarGeneral]: "general-stars",
  [R.ThreeStarGeneral]: "general-stars",
  [R.TwoStarGeneral]: "general-stars",
  [R.OneStarGeneral]: "general-stars",
  [R.Colonel]: "field-grade-sunburst",
  [R.LieutenantColonel]: "field-grade-sunburst",
  [R.Major]: "field-grade-sunburst",
  [R.Captain]: "company-grade-triangle",
  [R.FirstLieutenant]: "company-grade-triangle",
  [R.SecondLieutenant]: "company-grade-triangle",
  [R.Sergeant]: "chevron",
  [R.Private]: "chevron",
  [R.Spy]: "special",
  [R.Flag]: "special",
};

export interface ReferenceImage {
  rank: Rank;
  /** Raw base64-encoded image bytes (no data: URL prefix). */
  base64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

/**
 * True few-shot reference photos (spec §2.2), one clean close-up per rank.
 * Empty until real individual photos are supplied — the reference sheet
 * photo received so far is one composite image, not 15 separably-croppable
 * clean shots, so it grounded RANK_VISUAL_HINTS above but isn't embeddable
 * here directly. Populate this array (rank + base64 + mimeType per entry)
 * once individual photos are available; nothing else needs to change —
 * pickReferenceImages() below picks them up automatically.
 */
export const REFERENCE_IMAGES: ReferenceImage[] = [];

export type ReferenceImageMode = "none" | "grouped" | "full";

/**
 * Selects which reference images to attach to a recognition call.
 * - "none": never attach any (cheapest/fastest).
 * - "grouped": at most one representative image per RankEncoding family
 *   (spec §2.2's fallback if attaching all 15 is too expensive/slow).
 * - "full": every available reference image, one per rank.
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
