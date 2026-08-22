import type { PlayerColor, Rank } from "@salpakan/shared";
import { useState } from "react";
import {
  abandonChallenge,
  ApiError,
  confirmSubmission,
  createChallenge,
  getChallenge,
  getCurrentChallenge,
  previewSubmission,
  reportRejectedRecognition,
} from "../api.js";
import { CaptureView } from "./CaptureView.js";
import { HandoffScreen } from "./HandoffScreen.js";
import { ResultView } from "./ResultView.js";

interface Props {
  sessionId: string;
  tokens: Partial<Record<PlayerColor, string>>;
  blueName?: string | null;
  redName?: string | null;
}

type Phase =
  | { step: "IDLE" }
  | { step: "HANDOFF_CAPTURE"; color: PlayerColor; challengeId: string }
  | { step: "CAPTURE"; color: PlayerColor; challengeId: string }
  | { step: "HANDOFF_RESULT"; color: PlayerColor; challengeId: string }
  | { step: "RESULT"; color: PlayerColor; challengeId: string; yourRank: Rank; outcome: "WIN" | "LOSE" | "MUTUAL_DESTRUCTION" };

/**
 * Gameplay loop for one-phone mode (spec §4): a single shared device, so
 * the app itself must enforce the hand-off discipline — nothing belonging
 * to one player is ever left on screen when the phone passes to the other.
 * Order is always BLUE captures, then RED captures, then BLUE sees their
 * own result, then RED sees theirs — capture order never depends on who
 * physically moved the piece, so it can't leak anything.
 */
export function OnePhoneMatch({ sessionId, tokens, blueName, redName }: Props) {
  const [phase, setPhase] = useState<Phase>({ step: "IDLE" });
  const [initiator, setInitiator] = useState<PlayerColor>("BLUE");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recovery for a challenge stuck OPEN (e.g. the app was closed mid-capture) — set when a create attempt fails because one is already open.
  const [stuckChallengeId, setStuckChallengeId] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);

  const nameFor = (color: PlayerColor) => (color === "BLUE" ? blueName : redName) || undefined;
  const anyToken = () => tokens.BLUE ?? tokens.RED!;

  async function handleStart() {
    setStarting(true);
    setError(null);
    setStuckChallengeId(null);
    try {
      // Either token can create the challenge — it's the same device, and
      // creation itself reveals nothing.
      const res = await createChallenge(sessionId, anyToken(), initiator);
      setPhase({ step: "HANDOFF_CAPTURE", color: "BLUE", challengeId: res.challengeId });
    } catch (err) {
      const isAlreadyOpen =
        err instanceof ApiError && err.status === 409 && (err.body as { error?: string } | null)?.error === "CHALLENGE_ALREADY_OPEN";
      if (isAlreadyOpen) {
        setError("A challenge is already open for this match — it may be stuck if a capture was never finished.");
        try {
          const current = await getCurrentChallenge(sessionId, anyToken());
          if (current.status === "OPEN" || current.status === "WAITING_FOR_OPPONENT") {
            setStuckChallengeId(current.challengeId);
          }
        } catch {
          /* best-effort — the plain error message above still stands */
        }
      } else {
        setError("Could not start a new challenge — check the connection and try again.");
      }
    } finally {
      setStarting(false);
    }
  }

  async function handleAbandonStuck() {
    if (!stuckChallengeId) return;
    setAbandoning(true);
    try {
      await abandonChallenge(sessionId, anyToken(), stuckChallengeId);
      setStuckChallengeId(null);
      setError(null);
    } catch {
      setError("Could not abandon the stuck challenge — try again.");
    } finally {
      setAbandoning(false);
    }
  }

  async function revealResult(color: PlayerColor, challengeId: string) {
    try {
      const view = await getChallenge(sessionId, tokens[color]!, challengeId);
      if (view.status === "RESOLVED") {
        setPhase({ step: "RESULT", color, challengeId, yourRank: view.yourRank, outcome: view.outcome });
      }
    } catch {
      setError("Could not load the result — try again.");
    }
  }

  if (phase.step === "IDLE") {
    return (
      <div className="card stack">
        <h2>Ready for the next challenge</h2>
        <div className="field">
          <label>Who is challenging?</label>
          <div className="stack" style={{ flexDirection: "row" }}>
            <button className={`btn ${initiator === "BLUE" ? "btn-blue" : "btn-secondary"}`} onClick={() => setInitiator("BLUE")}>
              Blue
            </button>
            <button className={`btn ${initiator === "RED" ? "btn-red" : "btn-secondary"}`} onClick={() => setInitiator("RED")}>
              Red
            </button>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {stuckChallengeId && (
          <button className="btn btn-secondary" onClick={handleAbandonStuck} disabled={abandoning}>
            {abandoning ? <span className="spinner" /> : "Abandon the stuck challenge and start fresh"}
          </button>
        )}
        <button className="btn btn-primary" onClick={handleStart} disabled={starting}>
          {starting ? <span className="spinner" /> : "New challenge"}
        </button>
      </div>
    );
  }

  if (phase.step === "HANDOFF_CAPTURE") {
    const next = phase.color;
    return (
      <HandoffScreen
        color={next}
        name={nameFor(next)}
        subtitle="Photograph your piece — the other player won't see it."
        onReady={() => setPhase({ step: "CAPTURE", color: next, challengeId: phase.challengeId })}
      />
    );
  }

  if (phase.step === "CAPTURE") {
    return (
      <CaptureView
        color={phase.color}
        preview={(file, filename) => previewSubmission(sessionId, tokens[phase.color]!, phase.challengeId, file, filename)}
        confirm={(file, filename, submissionToken) =>
          confirmSubmission(sessionId, tokens[phase.color]!, phase.challengeId, file, filename, submissionToken)
        }
        reportRejected={(submissionToken) => reportRejectedRecognition(sessionId, tokens[phase.color]!, phase.challengeId, submissionToken)}
        onSubmitted={() => {
          // Never surface this player's rank/result here — lock straight to
          // the next hand-off (spec §4: "not shown on screen at all after capture").
          if (phase.color === "BLUE") {
            setPhase({ step: "HANDOFF_CAPTURE", color: "RED", challengeId: phase.challengeId });
          } else {
            setPhase({ step: "HANDOFF_RESULT", color: "BLUE", challengeId: phase.challengeId });
          }
        }}
      />
    );
  }

  if (phase.step === "HANDOFF_RESULT") {
    const who = phase.color;
    return (
      <HandoffScreen
        color={who}
        name={nameFor(who)}
        subtitle="See your result — the other player won't see it."
        onReady={() => revealResult(who, phase.challengeId)}
      />
    );
  }

  // RESULT
  return (
    <ResultView
      color={phase.color}
      yourRank={phase.yourRank}
      outcome={phase.outcome}
      continueLabel={phase.color === "BLUE" ? "Done — pass to Red" : "Done"}
      onContinue={() => {
        if (phase.color === "BLUE") {
          setPhase({ step: "HANDOFF_RESULT", color: "RED", challengeId: phase.challengeId });
        } else {
          setPhase({ step: "IDLE" });
        }
      }}
    />
  );
}
