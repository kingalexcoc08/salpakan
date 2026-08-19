import { useEffect, useRef, useState } from "react";
import { cropAndResizeToBlob } from "../imageCanvasOps.js";
import { CAPTURE_GUIDE_RECT, MAX_CAPTURE_DIMENSION } from "../imagePreprocessing.js";

interface Props {
  onCaptured: (blob: Blob) => void;
  /** Camera unavailable/denied/unsupported — parent should fall back to the file picker. */
  onUnavailable: () => void;
}

/**
 * Live in-app camera view with an on-screen alignment guide (spec update
 * "Fix Low Recognition Accuracy" §2.4) — this is what makes §2.3's
 * client-side auto-crop possible: only an in-app camera feed can show a
 * guide frame overlay and crop exactly to it, unlike the OS's native camera
 * app (which a plain `<input type="file" capture>` would hand off to, with
 * no way to overlay anything on top of it).
 */
export function CameraCapture({ onCaptured, onUnavailable }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailable();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (!cancelled) setReady(true);
      } catch {
        // Permission denied, no camera, insecure context, etc. — the
        // file-picker fallback covers all of these.
        if (!cancelled) onUnavailable();
      }
    }

    start();
    return () => {
      cancelled = true;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUnavailable is a stable callback from the parent's render; re-running this effect on every render would re-request the camera.
  }, []);

  async function handleCapture() {
    const video = videoRef.current;
    if (!video || !ready) return;
    setBusy(true);
    try {
      const blob = await cropAndResizeToBlob(video, video.videoWidth, video.videoHeight, CAPTURE_GUIDE_RECT, MAX_CAPTURE_DIMENSION);
      onCaptured(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="camera-capture">
      <div className="camera-frame">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a live self-facing camera preview, not media content */}
        <video ref={videoRef} className="camera-video" muted playsInline />
        <div className="camera-guide" aria-hidden="true" />
      </div>
      <p className="text-dim center-text">Fill the frame with just the piece — avoid glare, keep it flat and well-lit.</p>
      <button className="btn btn-primary" onClick={handleCapture} disabled={!ready || busy}>
        {busy ? <span className="spinner" /> : "Capture"}
      </button>
    </div>
  );
}
