interface Props {
  code: string;
  onCancel: () => void;
}

export function WaitingForOpponentScreen({ code, onCancel }: Props) {
  return (
    <div className="screen">
      <div className="card center-text stack">
        <h2>Share this code</h2>
        <div className="code-display">{code}</div>
        <p className="text-dim">
          Have your opponent choose "Join with a code" on their phone and enter this. <span className="spinner" /> Waiting
          for them to join…
        </p>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
