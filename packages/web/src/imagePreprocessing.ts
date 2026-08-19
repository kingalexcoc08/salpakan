/**
 * Client-side image preprocessing (spec update "Fix Low Recognition
 * Accuracy" §2.3/§2.4): crop to the on-screen guide frame and resize to a
 * consistent max dimension before upload, so the server (and the vision
 * model) always sees a standardized, tightly-cropped photo of just the
 * piece instead of whatever raw dimensions/framing the device happened to
 * produce.
 *
 * Split deliberately into a pure geometry function (this file, DOM-free and
 * unit-testable) and a thin canvas-driven wrapper that actually performs
 * the crop/resize — see CaptureView.tsx / CameraCapture.tsx for the DOM
 * side.
 */

export interface RelativeRect {
  /** 0..1, fraction of the source width/height, from the top-left. */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** The guide frame CameraCapture shows on-screen: a centered square, 70% of the shorter side. */
export const CAPTURE_GUIDE_RECT: RelativeRect = { xPct: 0.15, yPct: 0.15, wPct: 0.7, hPct: 0.7 };

/** No cropping — used for the file-picker fallback path, where there was no on-screen guide frame to crop to. */
export const FULL_FRAME_RECT: RelativeRect = { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };

/** Matches the server's default MAX_UPLOAD_DIMENSION — keeping client output under this means the server-side safety-net resize (§2.3) is normally a no-op. */
export const MAX_CAPTURE_DIMENSION = 1600;

export interface CropResizePlan {
  /** Crop rectangle in source pixel coordinates. */
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  /** Output pixel dimensions after resizing the crop to fit maxDimension. */
  outW: number;
  outH: number;
}

/**
 * Computes the pixel crop rectangle (from a relative guide rect) and the
 * output size (longest side capped at maxDimension, aspect ratio
 * preserved) — pure arithmetic, no canvas/DOM involved, so it's directly
 * unit-testable.
 */
export function computeCropAndResize(sourceWidth: number, sourceHeight: number, guide: RelativeRect, maxDimension: number): CropResizePlan {
  const cropX = Math.round(guide.xPct * sourceWidth);
  const cropY = Math.round(guide.yPct * sourceHeight);
  const cropW = Math.max(1, Math.round(guide.wPct * sourceWidth));
  const cropH = Math.max(1, Math.round(guide.hPct * sourceHeight));

  const longestSide = Math.max(cropW, cropH);
  const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;

  return {
    cropX,
    cropY,
    cropW,
    cropH,
    outW: Math.max(1, Math.round(cropW * scale)),
    outH: Math.max(1, Math.round(cropH * scale)),
  };
}
