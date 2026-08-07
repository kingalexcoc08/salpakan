import { useState } from "react";
import { ApiError, endSession, getSessionStatus, type SessionStatus } from "../api.js";
import type { MatchCredentials } from "../storage.js";
import { useInterval } from "../useInterval.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { MatchHeader } from "./MatchHeader.js";
import { OnePhoneMatch } from "./OnePhoneMatch.js";
import { TwoPhoneMatch } from "./TwoPhoneMatch.js";
import { WaitingForOpponentScreen } from "./WaitingForOpponentScreen.js";

interface Props {
  match: MatchCredentials;
  onExit: () => void;
}

const STATUS_POLL_MS = 3000;

export function MatchContainer({ match, onExit }: Props) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInterval(() => {
    getSessionStatus(match.sessionId)
      .then(setSession)
      .catch(() => {
        /* transient — next poll retries */
      });
  }, STATUS_POLL_MS);

  const myToken = match.myColor ? match.tokens[match.myColor] : (match.tokens.BLUE ?? match.tokens.RED);

  async function handleEnd() {
    if (!myToken) return;
    setEnding(true);
    setError(null);
    try {
      await endSession(match.sessionId, myToken);
      const updated = await getSessionStatus(match.sessionId);
      setSession(updated);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Finish the current challenge before ending the game."
          : "Could not end the game — try again.",
      );
    } finally {
      setEnding(false);
    }
  }

  if (!session) {
    return (
      <div className="screen">
        <div className="card center-text">
          <span className="spinner" /> Loading match…
        </div>
      </div>
    );
  }

  if (session.status === "WAITING_FOR_OPPONENT") {
    return <WaitingForOpponentScreen code={session.code} onCancel={onExit} />;
  }

  if (session.status === "ENDED") {
    return <HistoryScreen sessionId={match.sessionId} token={myToken!} onDone={onExit} />;
  }

  return (
    <div className="screen">
      <MatchHeader
        code={session.code}
        blueName={session.blueName}
        redName={session.redName}
        challengeCount={session.challengeCount}
        onEnd={handleEnd}
        ending={ending}
      />
      {error && <div className="error-banner">{error}</div>}

      {match.captureMode === "ONE_PHONE" ? (
        <OnePhoneMatch sessionId={match.sessionId} tokens={match.tokens} blueName={session.blueName} redName={session.redName} />
      ) : (
        <TwoPhoneMatch sessionId={match.sessionId} token={myToken!} myColor={match.myColor!} />
      )}
    </div>
  );
}
