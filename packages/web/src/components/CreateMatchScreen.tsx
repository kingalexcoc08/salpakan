import type { CaptureMode, PlayerColor } from "@salpakan/shared";
import { useState } from "react";
import { ApiError, createSession } from "../api.js";
import type { MatchCredentials } from "../storage.js";

interface Props {
  onCreated: (match: MatchCredentials) => void;
  onBack: () => void;
}

export function CreateMatchScreen({ onCreated, onBack }: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>("TWO_PHONE");
  const [myColor, setMyColor] = useState<PlayerColor>("BLUE");
  const [myName, setMyName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const params =
        captureMode === "ONE_PHONE"
          ? { captureMode, blueName: myName || undefined, redName: opponentName || undefined }
          : {
              captureMode,
              creatorColor: myColor,
              ...(myColor === "BLUE" ? { blueName: myName || undefined } : { redName: myName || undefined }),
            };

      const res = await createSession(params);

      const match: MatchCredentials = {
        sessionId: res.sessionId,
        code: res.code,
        captureMode: res.captureMode,
        myColor: captureMode === "ONE_PHONE" ? undefined : myColor,
        tokens: res.tokens,
        blueName: captureMode === "ONE_PHONE" ? myName || undefined : myColor === "BLUE" ? myName || undefined : undefined,
        redName: captureMode === "ONE_PHONE" ? opponentName || undefined : myColor === "RED" ? myName || undefined : undefined,
      };
      onCreated(match);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the match. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="card stack">
        <h2>Create a match</h2>

        <div className="field">
          <label>How will you play?</label>
          <div className="stack">
            <button
              className={`btn ${captureMode === "TWO_PHONE" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCaptureMode("TWO_PHONE")}
            >
              Two phones — each player has their own
            </button>
            <button
              className={`btn ${captureMode === "ONE_PHONE" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCaptureMode("ONE_PHONE")}
            >
              One phone — passed back and forth
            </button>
          </div>
        </div>

        {captureMode === "TWO_PHONE" && (
          <div className="field">
            <label>Which color are you?</label>
            <div className="stack" style={{ flexDirection: "row" }}>
              <button className={`btn ${myColor === "BLUE" ? "btn-blue" : "btn-secondary"}`} onClick={() => setMyColor("BLUE")}>
                Blue
              </button>
              <button className={`btn ${myColor === "RED" ? "btn-red" : "btn-secondary"}`} onClick={() => setMyColor("RED")}>
                Red
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label>{captureMode === "ONE_PHONE" ? "Blue player's name (optional)" : "Your name (optional)"}</label>
          <input type="text" value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="e.g. Alex" />
        </div>

        {captureMode === "ONE_PHONE" && (
          <div className="field">
            <label>Red player's name (optional)</label>
            <input type="text" value={opponentName} onChange={(e) => setOpponentName(e.target.value)} placeholder="e.g. Sam" />
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}

        <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
          {busy ? <span className="spinner" /> : "Create match"}
        </button>
        <button className="btn btn-secondary" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
    </div>
  );
}
