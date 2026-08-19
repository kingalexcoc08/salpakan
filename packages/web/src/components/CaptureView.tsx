import { RANK_LABELS, type PlayerColor } from "@salpakan/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.js";
import type { ChallengeSelfView, SubmissionPreview } from "../api.js";
import { cropAndResizeToBlob, decodeImageFile } from "../imageCanvasOps.js";
import { FULL_FRAME_RECT, MAX_CAPTURE_DIMENSION } from "../imagePreprocessing.js";
import { CameraCapture } from "./CameraCapture.js";

interface Props {
  color: PlayerColor;
  preview: (file: Blob, filename: string) => Promise<SubmissionPreview>;
  confirm: (file: Blob, filename: string, token: string) => Promise<ChallengeSelfView>;
  /** Best-effort accuracy-feedback log for a rejected recognition (spec §2.5) — never blocks the retake UI on failure. */
  reportRejected: (token: string) => void;
  onSubmitted: (view: ChallengeSelfView) => void;
}

/**
 * Photo capture, recognition preview, and confirm for one player's piece.
 * Three phases:
 *  - CAMERA: live in-app camera with an on-screen guide frame (spec §2.4);
 *    falls back to a plain file picker if the camera is unavailable/denied.
 *  - Once a photo is picked (either way), it's cropped-to-guide (camera
 *    path) or just resized (file-picker path) client-side (spec §2.3),
 *    then sent to the server to recognize.
 *  - REVIEW: shown after a successful recognition — the player sees the
 *    photo and recognized rank and must explicitly confirm before anything
 *    is locked in. "No, retake" discards the photo and result entirely,
 *    logs it as accuracy feedback, and returns to CAMERA; nothing is ever
 *    written to the challenge for a rejected recognition.
 * This never shows anything about the opponent's piece — it's scoped to
 * whichever color is currently capturing, same as before.
 */
export function CaptureView({ color, preview, confirm, reportRejected, onSubmitted }: Props) {
  const [cameraAvailable, setCameraAvailable] = useState(true);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<SubmissionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function runPreview(blob: Blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhotoBlob(blob);
    setPreviewUrl(URL.createObjectURL(blob));
    setBusy(true);
    setMessage(null);
    try {
      const result = await preview(blob, "piece.jpg");
      setRecognized(result);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCameraCaptured(blob: Blob) {
    await runPreview(blob);
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      // No on-screen guide was shown for a picked file, so there's nothing
      // sensible to crop to — just resize to the same max dimension.
      const bitmap = await decodeImageFile(file);
      const resized = await cropAndResizeToBlob(bitmap, bitmap.width, bitmap.height, FULL_FRAME_RECT, MAX_CAPTURE_DIMENSION);
      await runPreview(resized);
    } catch {
      setMessage("Could not read that photo — please try a different one.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!photoBlob || !recognized) return;
    setBusy(true);
    setMessage(null);
    try {
      const view = await confirm(photoBlob, "piece.jpg", recognized.token);
      onSubmitted(view);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Could not lock in your submission — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleRetake() {
    // Discard this photo and its recognition result entirely — nothing was
    // ever written to the challenge for it. Log it as a labeled misread for
    // accuracy tuning (spec §2.5); best-effort, never blocks the retake.
    if (recognized) reportRejected(recognized.token);
    setRecognized(null);
    setMessage(null);
    setPhotoBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
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
      <p className="text-dim">Only you will see this photo and rank on this screen.</p>

      {busy && !recognized ? (
        <div className="hint-banner center-text">
          <span className="spinner" /> Reading your piece…
        </div>
      ) : cameraAvailable ? (
        <CameraCapture onCaptured={handleCameraCaptured} onUnavailable={() => setCameraAvailable(false)} />
      ) : (
        <>
          {previewUrl && <img src={previewUrl} alt="Selected piece" className="photo-preview" />}
          <p className="text-dim">Camera not available — choose a photo instead. Fill the frame with just the piece, avoid glare.</p>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFilePicked} style={{ color: "var(--text-dim)" }} />
        </>
      )}

      {message && <div className="error-banner">{message}</div>}
    </div>
  );
}
