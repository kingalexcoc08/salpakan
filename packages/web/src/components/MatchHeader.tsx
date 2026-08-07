interface Props {
  code: string;
  blueName?: string | null;
  redName?: string | null;
  challengeCount: number;
  onEnd: () => void;
  ending: boolean;
}

export function MatchHeader({ code, blueName, redName, challengeCount, onEnd, ending }: Props) {
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="text-dim" style={{ fontSize: "0.75rem" }}>
            SESSION {code}
          </div>
          <div>
            <span className="pill pill-blue">{blueName || "Blue"}</span> vs <span className="pill pill-red">{redName || "Red"}</span>
          </div>
        </div>
        <div className="text-dim" style={{ fontSize: "0.8rem", textAlign: "right" }}>
          {challengeCount} challenge{challengeCount === 1 ? "" : "s"} logged
        </div>
      </div>
      <button className="btn btn-danger-outline" style={{ marginTop: 14 }} onClick={onEnd} disabled={ending}>
        {ending ? <span className="spinner" /> : "End game"}
      </button>
    </div>
  );
}
