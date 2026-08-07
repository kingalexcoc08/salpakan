interface Props {
  onCreate: () => void;
  onJoin: () => void;
}

export function HomeScreen({ onCreate, onJoin }: Props) {
  return (
    <div className="screen">
      <div className="card stack">
        <h2>Start a match</h2>
        <p className="text-dim">
          Replaces the human arbiter for Salpakan (Game of the Generals). Photograph your piece when challenged — the
          app tells both players who won, never the opponent's rank.
        </p>
        <button className="btn btn-primary" onClick={onCreate}>
          Create a match
        </button>
        <button className="btn btn-secondary" onClick={onJoin}>
          Join with a code
        </button>
      </div>
      <div className="hint-banner">
        Two phones (recommended): each player keeps their own device so the opponent never sees your camera roll.
        One phone: pass a single device back and forth — the app locks the screen between hand-offs so no one peeks.
      </div>
    </div>
  );
}
