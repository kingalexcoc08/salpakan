import { describe, expect, it } from "vitest";
import { CAPTURE_GUIDE_RECT, computeCropAndResize, FULL_FRAME_RECT } from "../src/imagePreprocessing.js";

describe("computeCropAndResize", () => {
  it("crops to the guide rect in source pixel coordinates", () => {
    const plan = computeCropAndResize(1000, 1000, CAPTURE_GUIDE_RECT, 10_000);
    // CAPTURE_GUIDE_RECT is a centered 70% box (15%..85%).
    expect(plan.cropX).toBe(150);
    expect(plan.cropY).toBe(150);
    expect(plan.cropW).toBe(700);
    expect(plan.cropH).toBe(700);
  });

  it("does not upscale beyond the crop size when under maxDimension", () => {
    const plan = computeCropAndResize(1000, 1000, CAPTURE_GUIDE_RECT, 10_000);
    expect(plan.outW).toBe(700);
    expect(plan.outH).toBe(700);
  });

  it("downscales so the longest output side never exceeds maxDimension, preserving aspect ratio", () => {
    // 2000x1000 source, full-frame crop (2000x1000), cap at 800 -> longest side (2000) scales to 800, other side scales proportionally (400).
    const plan = computeCropAndResize(2000, 1000, FULL_FRAME_RECT, 800);
    expect(plan.outW).toBe(800);
    expect(plan.outH).toBe(400);
  });

  it("handles a portrait source the same way (tallest side capped)", () => {
    const plan = computeCropAndResize(1000, 2000, FULL_FRAME_RECT, 800);
    expect(plan.outW).toBe(400);
    expect(plan.outH).toBe(800);
  });

  it("full-frame crop covers the entire source with no cropping", () => {
    const plan = computeCropAndResize(640, 480, FULL_FRAME_RECT, 10_000);
    expect(plan).toMatchObject({ cropX: 0, cropY: 0, cropW: 640, cropH: 480, outW: 640, outH: 480 });
  });

  it("never produces a zero-sized crop or output even for a tiny source", () => {
    const plan = computeCropAndResize(1, 1, CAPTURE_GUIDE_RECT, 100);
    expect(plan.cropW).toBeGreaterThan(0);
    expect(plan.cropH).toBeGreaterThan(0);
    expect(plan.outW).toBeGreaterThan(0);
    expect(plan.outH).toBeGreaterThan(0);
  });
});
