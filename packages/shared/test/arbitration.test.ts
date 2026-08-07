import { describe, expect, it } from "vitest";
import { resolveChallenge } from "../src/arbitration.js";
import { Rank } from "../src/ranks.js";

describe("resolveChallenge — standard rule (higher rank wins)", () => {
  it("higher-ranked General beats lower-ranked General", () => {
    const result = resolveChallenge(Rank.FiveStarGeneral, Rank.OneStarGeneral, "A");
    expect(result).toMatchObject({ type: "win", winner: "A", loser: "B" });
  });

  it("is symmetric regardless of argument order", () => {
    const result = resolveChallenge(Rank.OneStarGeneral, Rank.FiveStarGeneral, "A");
    expect(result).toMatchObject({ type: "win", winner: "B", loser: "A" });
  });

  it("Colonel beats Lieutenant Colonel", () => {
    const result = resolveChallenge(Rank.Colonel, Rank.LieutenantColonel, "B");
    expect(result).toMatchObject({ type: "win", winner: "A" });
  });

  it("Sergeant beats Private (Private is the lowest combat rank)", () => {
    const result = resolveChallenge(Rank.Sergeant, Rank.Private, "A");
    expect(result).toMatchObject({ type: "win", winner: "A" });
  });

  it("a full adjacency sweep of the 13-rank combat hierarchy always favors the higher rank", () => {
    const order = [
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
    for (let i = 0; i < order.length - 1; i++) {
      const higher = order[i];
      const lower = order[i + 1];
      expect(resolveChallenge(higher, lower, "A")).toMatchObject({ type: "win", winner: "A" });
      expect(resolveChallenge(lower, higher, "A")).toMatchObject({ type: "win", winner: "B" });
    }
  });

  it("initiator does not affect the standard-rule outcome", () => {
    const asInitiatorA = resolveChallenge(Rank.Major, Rank.Captain, "A");
    const asInitiatorB = resolveChallenge(Rank.Major, Rank.Captain, "B");
    expect(asInitiatorA).toMatchObject({ winner: "A" });
    expect(asInitiatorB).toMatchObject({ winner: "A" });
  });
});

describe("resolveChallenge — equal rank (mutual destruction)", () => {
  it("two Privates mutually destroy", () => {
    const result = resolveChallenge(Rank.Private, Rank.Private, "A");
    expect(result.type).toBe("mutualDestruction");
  });

  it("two Spies mutually destroy", () => {
    const result = resolveChallenge(Rank.Spy, Rank.Spy, "B");
    expect(result.type).toBe("mutualDestruction");
  });

  it("two same-rank Generals mutually destroy", () => {
    const result = resolveChallenge(Rank.ThreeStarGeneral, Rank.ThreeStarGeneral, "A");
    expect(result.type).toBe("mutualDestruction");
  });

  it("two Sergeants mutually destroy", () => {
    const result = resolveChallenge(Rank.Sergeant, Rank.Sergeant, "A");
    expect(result.type).toBe("mutualDestruction");
  });
});

describe("resolveChallenge — Spy vs Private special case", () => {
  it("Private defeats Spy when Private is side A", () => {
    const result = resolveChallenge(Rank.Private, Rank.Spy, "A");
    expect(result).toMatchObject({ type: "win", winner: "A", loser: "B" });
  });

  it("Private defeats Spy when Private is side B", () => {
    const result = resolveChallenge(Rank.Spy, Rank.Private, "A");
    expect(result).toMatchObject({ type: "win", winner: "B", loser: "A" });
  });

  it("Private defeats Spy regardless of who initiated the challenge", () => {
    const spyInitiates = resolveChallenge(Rank.Spy, Rank.Private, "A"); // A=Spy initiates
    const privateInitiates = resolveChallenge(Rank.Spy, Rank.Private, "B"); // B=Private initiates
    expect(spyInitiates).toMatchObject({ winner: "B" }); // Private (B) still wins
    expect(privateInitiates).toMatchObject({ winner: "B" }); // Private (B) still wins
  });
});

describe("resolveChallenge — Spy vs other combat ranks", () => {
  it("Spy defeats a 5-Star General", () => {
    const result = resolveChallenge(Rank.Spy, Rank.FiveStarGeneral, "A");
    expect(result).toMatchObject({ type: "win", winner: "A" });
  });

  it("Spy defeats a Sergeant", () => {
    const result = resolveChallenge(Rank.Sergeant, Rank.Spy, "A");
    expect(result).toMatchObject({ type: "win", winner: "B" });
  });

  it("Spy defeats every combat rank except Private", () => {
    const combatRanksExceptPrivate = [
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
    ];
    for (const rank of combatRanksExceptPrivate) {
      expect(resolveChallenge(Rank.Spy, rank, "A")).toMatchObject({ winner: "A" });
      expect(resolveChallenge(rank, Rank.Spy, "A")).toMatchObject({ winner: "B" });
    }
  });
});

describe("resolveChallenge — Flag", () => {
  it("Flag is captured by any challenging combat piece, regardless of that piece's rank", () => {
    const ranksToTest = [Rank.FiveStarGeneral, Rank.Private, Rank.Spy, Rank.Sergeant];
    for (const rank of ranksToTest) {
      // Flag is A, other piece is B
      expect(resolveChallenge(Rank.Flag, rank, "A")).toMatchObject({ type: "win", winner: "B", loser: "A" });
      // Flag is B, other piece is A
      expect(resolveChallenge(rank, Rank.Flag, "A")).toMatchObject({ type: "win", winner: "A", loser: "B" });
    }
  });

  it("Flag vs Flag: default rule is the challenger wins", () => {
    const aInitiates = resolveChallenge(Rank.Flag, Rank.Flag, "A");
    expect(aInitiates).toMatchObject({ type: "win", winner: "A", loser: "B" });

    const bInitiates = resolveChallenge(Rank.Flag, Rank.Flag, "B");
    expect(bInitiates).toMatchObject({ type: "win", winner: "B", loser: "A" });
  });

  it("Flag vs Flag: configurable to mutual destruction house rule", () => {
    const result = resolveChallenge(Rank.Flag, Rank.Flag, "A", { flagVsFlagRule: "mutualDestruction" });
    expect(result.type).toBe("mutualDestruction");
  });

  it("does not apply the Flag rule to non-Flag equal-rank pairs", () => {
    // Sanity check: equal-rank mutual destruction still fires for non-Flag pairs
    // even when using a Flag-vs-Flag override option (option should be a no-op here).
    const result = resolveChallenge(Rank.Private, Rank.Private, "A", { flagVsFlagRule: "challengerWins" });
    expect(result.type).toBe("mutualDestruction");
  });
});

describe("resolveChallenge — purity and totality", () => {
  it("never throws for any pair drawn from the full rank set", () => {
    const allRanks = Object.values(Rank);
    for (const a of allRanks) {
      for (const b of allRanks) {
        expect(() => resolveChallenge(a, b, "A")).not.toThrow();
        expect(() => resolveChallenge(a, b, "B")).not.toThrow();
      }
    }
  });

  it("is deterministic — same inputs always produce the same result", () => {
    const r1 = resolveChallenge(Rank.Captain, Rank.Major, "A");
    const r2 = resolveChallenge(Rank.Captain, Rank.Major, "A");
    expect(r1).toEqual(r2);
  });
});
