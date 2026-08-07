import { RANK_LABELS } from "@salpakan/shared";
import { useEffect, useState } from "react";
import { ApiError, getHistory, type HistoryResponse } from "../api.js";

interface Props {
  sessionId: string;
  token: string;
  onDone: () => void;
}

function outcomeLabel(result: HistoryResponse["challenges"][number]["result"]): string {
  if (result.type === "mutualDestruction") return "Mutual destruction";
  return `${result.winner} wins`;
}

export function HistoryScreen({ sessionId, token, onDone }: Props) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHistory(sessionId, token)
      .then((res) => {
        if (!cancelled) setHistory(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load match history.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, token]);

  return (
    <div className="screen">
      <div className="card stack">
        <h2>Match history</h2>
        <p className="text-dim">
          Both ranks are only ever shown together here, after the game has ended — this is your dispute-resolution
          record.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {!history && !error && <div className="center-text">Loading…</div>}

        {history && (
          <>
            <div className={history.integrity.valid ? "integrity-ok" : "integrity-bad"}>
              {history.integrity.valid
                ? "✓ Match log verified — no tampering detected."
                : `⚠ Match log integrity check FAILED (${history.integrity.reason ?? "chain broken"}). This game may be compromised.`}
            </div>

            {history.challenges.length === 0 ? (
              <p className="text-dim">No challenges were recorded this game.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Time</th>
                      <th>Blue</th>
                      <th>Red</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.challenges.map((c) => (
                      <tr key={c.challengeNumber}>
                        <td>{c.challengeNumber}</td>
                        <td>{new Date(c.timestamp).toLocaleTimeString()}</td>
                        <td>{RANK_LABELS[c.blue.rank]}</td>
                        <td>{RANK_LABELS[c.red.rank]}</td>
                        <td>{outcomeLabel(c.result)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <button className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
