import { ALL_RANKS, Rank } from "@salpakan/shared";
import type { RecognitionResult, VisionService } from "../src/services/visionService.js";

/**
 * Test double for VisionService: reads the intended rank/confidence back
 * out of the uploaded bytes instead of doing real recognition, so API tests
 * can deterministically script "the photo shows a Major at 0.95 confidence"
 * without needing a real image or a live Claude API call.
 *
 * Pair with `fixturePhoto()` below, which encodes the same format.
 */
export class ScriptedVisionService implements VisionService {
  async recognizeRank(imageBytes: Buffer): Promise<RecognitionResult> {
    const text = imageBytes.toString("utf8");
    const match = text.match(/^RANK:([A-Z_]+):([0-9.]+)$/);
    if (!match || !ALL_RANKS.includes(match[1] as Rank)) {
      throw new Error(`Test fixture buffer not in expected 'RANK:<rank>:<confidence>' format: ${text}`);
    }
    return { rank: match[1] as Rank, confidence: Number.parseFloat(match[2]) };
  }
}

export function fixturePhoto(rank: Rank, confidence: number): Buffer {
  return Buffer.from(`RANK:${rank}:${confidence}`, "utf8");
}
