import { useState } from "react";
import { ApiError, joinSession } from "../api.js";
import type { MatchCredentials } from "../storage.js";

interface Props {
  onJoined: (match: MatchCredentials) => void;
  onBack: () => void;
}

export function JoinMatchScreen({ onJoined, onBack }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (!code.trim()) {
      setError("Enter the session code your opponent shared with you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await joinSession(code.trim().toUpperCase(), name || undefined);
      const match: MatchCredentials = {
        sessionId: res.sessionId,
        code: res.code,
        captureMode: res.captureMode,
        myColor: res.yourColor,
        tokens: { [res.yourColor]: res.token },
        blueName: res.yourColor === "BLUE" ? name || undefined : undefined,
        redName: res.yourColor === "RED" ? name || undefined : undefined,
      };
      onJoined(match);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError("No match found with that code — double-check it with your opponent.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("That match is already full or not joinable.");
      } else {
        setError("Could not join the match. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="card stack">
        <h2>Join a match</h2>
        <div className="field">
          <label>Session code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. 7K4QXZ"
            autoCapitalize="characters"
            maxLength={8}
          />
        </div>
        <div className="field">
          <label>Your name (optional)</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" />
        </div>
        {error && <div className="error-banner">{error}</div>}
        <button className="btn btn-primary" onClick={handleJoin} disabled={busy}>
          {busy ? <span className="spinner" /> : "Join match"}
        </button>
        <button className="btn btn-secondary" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </div>
  );
}
