import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import { normalizeImage } from "../src/services/imageNormalize.js";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  const image = new Jimp({ width, height, color: 0x336699ff });
  return image.getBuffer("image/jpeg");
}

describe("normalizeImage (server-side safety-net resize)", () => {
  it("passes an already-small image through byte-identical (no-op)", async () => {
    const original = await makeJpeg(200, 100);
    const result = await normalizeImage(original, "image/jpeg");
    expect(result.buffer.equals(original)).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("downscales an oversized image so the longest side is capped, preserving aspect ratio", async () => {
    // 3000x1500 landscape, well over the 1600 default cap.
    const original = await makeJpeg(3000, 1500);
    const result = await normalizeImage(original, "image/jpeg");
    expect(result.buffer.equals(original)).toBe(false);

    const decoded = await Jimp.fromBuffer(result.buffer);
    expect(decoded.width).toBe(1600);
    expect(decoded.height).toBe(800); // 1500/3000 * 1600
  });

  it("caps a portrait image on its tallest side the same way", async () => {
    const original = await makeJpeg(1000, 4000);
    const result = await normalizeImage(original, "image/jpeg");
    const decoded = await Jimp.fromBuffer(result.buffer);
    expect(decoded.height).toBe(1600);
    expect(decoded.width).toBe(400); // 1000/4000 * 1600
  });

  it("re-encoding the same oversized bytes twice is deterministic (needed for the preview/confirm hash check)", async () => {
    const original = await makeJpeg(2400, 2400);
    const first = await normalizeImage(original, "image/jpeg");
    const second = await normalizeImage(original, "image/jpeg");
    expect(first.buffer.equals(second.buffer)).toBe(true);
  });

  it("passes through undecodable bytes untouched instead of throwing", async () => {
    const garbage = Buffer.from("not actually an image", "utf8");
    const result = await normalizeImage(garbage, "image/heic");
    expect(result.buffer.equals(garbage)).toBe(true);
    expect(result.mimeType).toBe("image/heic");
  });
});
