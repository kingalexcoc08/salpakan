import { RANK_LABELS, type PlayerColor } from "@salpakan/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.js";
import type { ChallengeSelfView, SubmissionPreview } from "../api.js";

interface Props {
  color: PlayerColor;
  preview: (file: Blob, filename: string) => Promise<SubmissionPreview>;
  confirm: (file: Blob, filename: string, token: string) => Promise<ChallengeSelfView>;
  onSubmitted: (view: ChallengeSelfView) => void;
}

/**
 * Photo capture, recognition preview, and confirm for one player's piece
 * (recognition-confirmation update). Two phases:
 *  - SELECT: pick a photo, then ask the server what rank it reads.
 *  - REVIEW: shown only after a successful recognition — the player sees
 *    the photo and recognized rank and must explicitly confirm before
 *    anything is locked in. "No, retake" discards the photo and result
 *    entirely and returns to SELECT; nothing was ever written server-side
 *    for a rejected recognition.
 * This never shows anything about the opponent's piece — it's scoped to
 * whichever color is currently capturing, same as before.
 */
export function CaptureView({ color, preview, confirm, onSubmitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<SubmissionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setMessage(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(picked);
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null);
  }

  async function handleRecognize() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await preview(file, file.name);
      setRecognized(result);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!file || !recognized) return;
    setBusy(true);
    setMessage(null);
    try {
      const view = await confirm(file, file.name, recognized.token);
      onSubmitted(view);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Could not lock in your submission — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleRetake() {
    // Discard this photo and its recognition result entirely. Nothing was
    // ever written to the server for it — the preview step never touches
    // the challenge record, so there is nothing to undo here, just local
    // state to reset before letting the player try again.
    setRecognized(null);
    setMessage(null);
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const sideClass = color === "BLUE" ? "pill-blue" : "pill-red";

  if (recognized) {
    return (
      <div className="card stack">
        <span className={`pill ${sideClass}`}>{color}</span>
        <h2>Confirm your piece</h2>

        {previewUrl && <img src={previewUrl} alt="Your piece" className="photo-preview" />}

        <p>
          We read this as: <strong>{RANK_LABELS[recognized.rank]}</strong>
        </p>

        {recognized.lowConfidence && (
          <div className="hint-banner">
            We're not fully confident in this read — blur, glare, or tilt can cause a misread. Double-check it matches
            your piece before confirming, or retake for a clearer photo.
          </div>
        )}

        {message && <div className="error-banner">{message}</div>}

        <button className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
          {busy ? <span className="spinner" /> : "Yes, that's correct"}
        </button>
        <button className="btn btn-secondary" onClick={handleRetake} disabled={busy}>
          No, retake
        </button>
      </div>
    );
  }

  return (
    <div className="card stack">
      <span className={`pill ${sideClass}`}>{color}</span>
      <h2>Photograph your piece</h2>
      <p className="text-dim">
        Take a clear, well-lit photo of the rank printed on your piece. Only you will see this photo and rank on this
        screen.
      </p>

      {previewUrl ? (
        <img src={previewUrl} alt="Selected piece" className="photo-preview" />
      ) : (
        <div className="hint-banner center-text">No photo selected yet</div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        style={{ color: "var(--text-dim)" }}
      />

      {message && <div className="error-banner">{message}</div>}

      <button className="btn btn-primary" onClick={handleRecognize} disabled={!file || busy}>
        {busy ? <span className="spinner" /> : "Read my piece"}
      </button>
    </div>
  );
}
