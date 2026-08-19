import { computeCropAndResize, type RelativeRect } from "./imagePreprocessing.js";

/**
 * Thin canvas-driven wrapper around computeCropAndResize() — actually
 * performs the crop/resize and exports a JPEG Blob. Kept separate from
 * imagePreprocessing.ts so the pure geometry math stays unit-testable
 * without a DOM/canvas environment.
 */
export async function cropAndResizeToBlob(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  guide: RelativeRect,
  maxDimension: number,
  quality = 0.9,
): Promise<Blob> {
  const plan = computeCropAndResize(sourceWidth, sourceHeight, guide, maxDimension);

  const canvas = document.createElement("canvas");
  canvas.width = plan.outW;
  canvas.height = plan.outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(source, plan.cropX, plan.cropY, plan.cropW, plan.cropH, 0, 0, plan.outW, plan.outH);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Failed to encode the captured photo.");
  return blob;
}

/**
 * Decodes a file picked via <input type="file"> to get pixel dimensions and
 * a drawable source for cropAndResizeToBlob(). `imageOrientation: "from-image"`
 * asks the browser to apply the file's own EXIF orientation while decoding
 * (spec §2.3's "correct obvious orientation issues if the device provides
 * them") where supported; unsupported browsers just decode as-is.
 */
export async function decodeImageFile(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}
