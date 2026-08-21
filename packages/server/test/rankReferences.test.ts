import { ALL_RANKS, Rank } from "@salpakan/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  AMBIGUOUS_COUNT_CLUSTERS,
  pickReferenceImages,
  RANK_ENCODING,
  RANK_VISUAL_HINTS,
  REFERENCE_IMAGES,
  type ReferenceImage,
} from "../src/services/rankReferences.js";

describe("rankReferences (Reference Rank Manifest)", () => {
  it("has a visual hint and an encoding family for every one of the 15 ranks", () => {
    for (const rank of ALL_RANKS) {
      expect(RANK_VISUAL_HINTS[rank]).toBeTruthy();
      expect(RANK_ENCODING[rank]).toBeTruthy();
    }
  });

  it("Flag is the only rank whose hint says it has no banner text", () => {
    for (const rank of ALL_RANKS) {
      const mentionsNoBanner = /no banner/i.test(RANK_VISUAL_HINTS[rank]);
      expect(mentionsNoBanner).toBe(rank === Rank.Flag);
    }
  });

  it("covers exactly the three known ambiguous count clusters (Generals, field-grade, company-grade)", () => {
    const clusteredRanks = new Set(AMBIGUOUS_COUNT_CLUSTERS.flatMap((c) => c.ranks));
    const expected = new Set([
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
    ]);
    expect(clusteredRanks).toEqual(expected);

    // The visually-unique ranks must NOT appear in any cluster.
    for (const unique of [Rank.Sergeant, Rank.Private, Rank.Spy, Rank.Flag]) {
      expect(clusteredRanks.has(unique)).toBe(false);
    }
  });

  it("each cluster's ranks all share the same encoding family", () => {
    for (const cluster of AMBIGUOUS_COUNT_CLUSTERS) {
      const families = new Set(cluster.ranks.map((r) => RANK_ENCODING[r]));
      expect(families.size).toBe(1);
    }
  });
});

describe("pickReferenceImages", () => {
  it("returns [] for every mode while REFERENCE_IMAGES is empty (current state — no real photos supplied yet)", () => {
    expect(REFERENCE_IMAGES).toHaveLength(0);
    expect(pickReferenceImages("none")).toEqual([]);
    expect(pickReferenceImages("grouped")).toEqual([]);
    expect(pickReferenceImages("full")).toEqual([]);
  });

  describe("once populated", () => {
    const sample: ReferenceImage[] = [
      { rank: Rank.FiveStarGeneral, variant: "light", base64: "AAA", mimeType: "image/jpeg" }, // general-stars
      { rank: Rank.FiveStarGeneral, variant: "dark", base64: "BBB", mimeType: "image/jpeg" }, // general-stars (2nd variant, same family)
      { rank: Rank.Major, variant: "light", base64: "CCC", mimeType: "image/jpeg" }, // field-grade-wheel
      { rank: Rank.Spy, variant: "dark", base64: "DDD", mimeType: "image/jpeg" }, // special
    ];

    afterEach(() => {
      REFERENCE_IMAGES.length = 0; // reset the shared module-level array so other tests see it empty again
    });

    it("'none' still returns [] even with images available", () => {
      REFERENCE_IMAGES.push(...sample);
      expect(pickReferenceImages("none")).toEqual([]);
    });

    it("'full' returns every entry, including both variants of the same rank", () => {
      REFERENCE_IMAGES.push(...sample);
      expect(pickReferenceImages("full")).toEqual(sample);
    });

    it("'grouped' returns at most one image per encoding family, keeping the first one seen", () => {
      REFERENCE_IMAGES.push(...sample);
      const grouped = pickReferenceImages("grouped");
      // 3 distinct families present (general-stars, field-grade-wheel, special) -> exactly 3 picked, not 4.
      expect(grouped).toHaveLength(3);
      const families = grouped.map((img) => RANK_ENCODING[img.rank]);
      expect(new Set(families).size).toBe(families.length); // no family repeated
      // The first FiveStarGeneral entry (light) wins over the second (dark) for its family.
      expect(grouped.find((img) => img.rank === Rank.FiveStarGeneral)?.variant).toBe("light");
    });
  });
});
