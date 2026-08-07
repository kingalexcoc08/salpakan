import type { PlayerColor } from "@salpakan/shared";

interface Props {
  color: PlayerColor;
  name?: string;
  subtitle: string;
  onReady: () => void;
}

/**
 * One-phone mode turn gate (spec §4): shown between every capture and every
 * result reveal so the device never displays anything belonging to the
 * other player. Deliberately shows nothing about the challenge.
 */
export function HandoffScreen({ color, name, subtitle, onReady }: Props) {
  const sideClass = color === "BLUE" ? "side-blue" : "side-red";
  return (
    <div className={`handoff-screen ${sideClass}`}>
      <div className="handoff-icon">🤝</div>
      <div>
        <h2 style={{ margin: 0 }}>Pass the phone to {name ? name : color}</h2>
        <p className="text-dim">{subtitle}</p>
      </div>
      <button className={`btn ${color === "BLUE" ? "btn-blue" : "btn-red"}`} onClick={onReady} style={{ maxWidth: 220 }}>
        I'm {name ? name : color} — Ready
      </button>
    </div>
  );
}
