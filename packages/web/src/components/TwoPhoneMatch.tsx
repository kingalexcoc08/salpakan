import type { PlayerColor } from "@salpakan/shared";
import { useState } from "react";
import { createChallenge, getCurrentChallenge, submitPiece, type ChallengeSelfView } from "../api.js";
import { useInterval } from "../useInterval.js";
import { CaptureView } from "./CaptureView.js";
import { ResultView } from "./ResultView.js";

interface Props {
  sessionId: string;
  token: string;
  myColor: PlayerColor;
}

const POLL_MS = 2000;

/**
 * Gameplay loop for two-phone mode. Each device only ever holds its own
 * color's token, so there is no gating UI needed here — the server-side
 * self-view (spec §5.0) is the only secrecy boundary, and it's already
 * enforced per-request.
 */
export function TwoPhoneMatch({ sessionId, token, myColor }: Props) {
  const [challenge, setChallenge] = useState<ChallengeSelfView>({ status: "NONE" });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInterval(() => {
    getCurrentChallenge(sessionId, token)
      .then(setChallenge)
      .catch(() => {
        /* transient network hiccup — next poll retries */
      });
  }, POLL_MS);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await createChallenge(sessionId, token, myColor);
      setChallenge({
        challengeId: res.challengeId,
        challengeNumber: res.challengeNumber,
        status: "OPEN",
        yourSubmitted: false,
        yourRank: null,
        yourConfidence: null,
      });
    } catch {
      setError("Could not start a new challenge. It may already be your opponent's turn to start one.");
    } finally {
      setStarting(false);
    }
  }

  if (challenge.status === "NONE") {
    return (
      <div className="card stack">
        <h2>Ready for the next challenge</h2>
        <p className="text-dim">When two pieces challenge on the board, either player taps below.</p>
        {error && <div className="error-banner">{error}</div>}
        <button className="btn btn-primary" onClick={handleStart} disabled={starting}>
          {starting ? <span className="spinner" /> : "New challenge"}
        </button>
      </div>
    );
  }

  if (challenge.status === "OPEN") {
    return (
      <CaptureView
        color={myColor}
        submit={(file, filename) => submitPiece(sessionId, token, challenge.challengeId, file, filename)}
        onSubmitted={setChallenge}
      />
    );
  }

  if (challenge.status === "WAITING_FOR_OPPONENT") {
    return (
      <div className="card center-text stack">
        <span className="spinner" />
        <p className="text-dim">Waiting for your opponent to submit their piece…</p>
      </div>
    );
  }

  return (
    <ResultView
      color={myColor}
      yourRank={challenge.yourRank}
      outcome={challenge.outcome}
      continueLabel="Next challenge"
      onContinue={() => setChallenge({ status: "NONE" })}
    />
  );
}
