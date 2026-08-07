import type { PlayerColor } from "@salpakan/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.js";
import type { ChallengeSelfView } from "../api.js";

interface Props {
  color: PlayerColor;
  submit: (file: Blob, filename: string) => Promise<ChallengeSelfView>;
  onSubmitted: (view: ChallengeSelfView) => void;
}

/**
 * Photo capture + submit for one player's piece. Handles the low-confidence
 * "please retake" response (spec §5.1) by clearing the selection and asking
 * again rather than silently guessing.
 */
export function CaptureView({ color, submit, onSubmitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "retake"; text: string } | null>(null);
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

  async function handleSubmit() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const view = await submit(file, file.name);
      onSubmitted(view);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { message?: string } | null;
        setMessage({ kind: "retake", text: body?.message ?? "Could not confidently read the rank — please retake the photo." });
        setFile(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        if (inputRef.current) inputRef.current.value = "";
      } else {
        setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Upload failed — check your connection and try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  const sideClass = color === "BLUE" ? "pill-blue" : "pill-red";

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

      {message && <div className={message.kind === "retake" ? "hint-banner" : "error-banner"}>{message.text}</div>}

      <button className="btn btn-primary" onClick={handleSubmit} disabled={!file || busy}>
        {busy ? <span className="spinner" /> : "Submit my piece"}
      </button>
    </div>
  );
}
