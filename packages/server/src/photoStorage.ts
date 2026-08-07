import { sha256HexBytes } from "@salpakan/shared";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface StoredPhoto {
  path: string;
  hash: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function extensionForMimeType(mimeType: string): string {
  return EXT_BY_MIME[mimeType] ?? "bin";
}

/**
 * Persists an uploaded piece photo to disk (kept for the duration of the
 * session so a disputed result can be manually re-verified, per §5.3) and
 * returns its SHA-256 hash for the match record.
 */
export async function savePhoto(
  sessionId: string,
  challengeId: string,
  color: string,
  bytes: Buffer,
  mimeType: string,
): Promise<StoredPhoto> {
  const hash = await sha256HexBytes(bytes);
  const dir = path.join(config.uploadDir, sessionId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${challengeId}-${color}.${extensionForMimeType(mimeType)}`);
  await writeFile(filePath, bytes);
  return { path: filePath, hash };
}

/** Deletes every stored photo for a session — called when the game ends,
 * leaving only the hashes + ranks already persisted in the match log. */
export async function purgeSessionPhotos(sessionId: string): Promise<void> {
  const dir = path.join(config.uploadDir, sessionId);
  await rm(dir, { recursive: true, force: true });
}
