import { Jimp, JimpMime } from "jimp";
import { config } from "../config.js";

type JimpMimeType = (typeof JimpMime)[keyof typeof JimpMime];

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: string;
}

const SUPPORTED_OUTPUT_MIME = new Set(["image/jpeg", "image/png"]);

/**
 * Server-side safety net (spec update "Fix Low Recognition Accuracy" §2.3):
 * downscales an image if its longest side exceeds config.maxUploadDimension,
 * independent of whatever preprocessing the client already did — this
 * bounds both the payload sent to the vision API and what gets written to
 * disk, regardless of client behavior.
 *
 * A no-op (returns the original buffer/mimeType untouched) when the image
 * is already within bounds or isn't a format jimp can decode (e.g. HEIC —
 * recognition still runs on the original bytes rather than failing the
 * request). This matters for the recognition-confirmation flow's
 * preview/confirm hash check, which needs the *same* bytes to hash
 * identically across both requests: only oversized, decodable images get
 * re-encoded, and jimp's encoder is deterministic for identical input, so
 * running this twice on the same original upload (once at preview, once at
 * confirm) always produces byte-identical output.
 */
export async function normalizeImage(buffer: Buffer, mimeType: string): Promise<NormalizedImage> {
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(buffer);
  } catch {
    return { buffer, mimeType };
  }

  const longestSide = Math.max(image.width, image.height);
  if (longestSide <= config.maxUploadDimension) {
    return { buffer, mimeType };
  }

  const resized = image.width >= image.height ? image.resize({ w: config.maxUploadDimension }) : image.resize({ h: config.maxUploadDimension });

  const outputMime = (SUPPORTED_OUTPUT_MIME.has(mimeType) ? mimeType : "image/jpeg") as JimpMimeType;
  const outBuffer = await resized.getBuffer(outputMime);
  return { buffer: outBuffer, mimeType: outputMime };
}
