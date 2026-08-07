import { RANK_LABELS, type PlayerColor, type Rank } from "@salpakan/shared";

interface Props {
  color: PlayerColor;
  yourRank: Rank;
  outcome: "WIN" | "LOSE" | "MUTUAL_DESTRUCTION";
  onContinue: () => void;
  continueLabel: string;
}

const OUTCOME_COPY: Record<Props["outcome"], { headline: string; className: string; emoji: string }> = {
  WIN: { headline: "You win this challenge", className: "win", emoji: "🏆" },
  LOSE: { headline: "You lose this challenge", className: "lose", emoji: "💥" },
  MUTUAL_DESTRUCTION: { headline: "Mutual destruction", className: "mutual", emoji: "⚔️" },
};

/**
 * Shows exactly what spec §5.0 allows: this player's own rank (they
 * already know it) plus the outcome by side — never the opponent's rank.
 */
export function ResultView({ color, yourRank, outcome, onContinue, continueLabel }: Props) {
  const copy = OUTCOME_COPY[outcome];
  const sideClass = color === "BLUE" ? "pill-blue" : "pill-red";

  return (
    <div className="card stack center-text">
      <span className={`pill ${sideClass}`}>{color}</span>
      <div style={{ fontSize: "2.5rem" }}>{copy.emoji}</div>
      <div className={`result-outcome ${copy.className}`}>{copy.headline}</div>
      <p className="text-dim">
        Your piece was a <strong>{RANK_LABELS[yourRank]}</strong>.
      </p>
      {outcome === "MUTUAL_DESTRUCTION" && <p className="text-dim">Both pieces are removed from the board.</p>}
      {outcome === "LOSE" && <p className="text-dim">Flip your piece face-up on the board so your opponent can see it.</p>}
      <button className="btn btn-primary" onClick={onContinue}>
        {continueLabel}
      </button>
    </div>
  );
}
