import { Rank } from "@salpakan/shared";
import { describe, expect, it } from "vitest";
import { parseModelResponse } from "../src/services/visionService.js";

describe("parseModelResponse (structured output enforcement)", () => {
  it("parses a valid response with rank/confidence/reasoning", () => {
    const result = parseModelResponse('{"rank": "MAJOR", "confidence": 0.92, "reasoning": "read text MAJOR"}');
    expect(result).toEqual({ rank: Rank.Major, confidence: 0.92, reasoning: "read text MAJOR" });
  });

  it("tolerates extra prose around the JSON object", () => {
    const result = parseModelResponse('Sure, here it is:\n{"rank": "SPY", "confidence": 0.8}\nHope that helps!');
    expect(result.rank).toBe(Rank.Spy);
  });

  it("clamps out-of-range confidence into [0, 1]", () => {
    expect(parseModelResponse('{"rank": "PRIVATE", "confidence": 1.5}').confidence).toBe(1);
    expect(parseModelResponse('{"rank": "PRIVATE", "confidence": -0.2}').confidence).toBe(0);
  });

  it("defaults confidence to 0 when missing or not a number", () => {
    expect(parseModelResponse('{"rank": "PRIVATE"}').confidence).toBe(0);
    expect(parseModelResponse('{"rank": "PRIVATE", "confidence": "high"}').confidence).toBe(0);
  });

  it("rejects a rank outside the closed 15-value set", () => {
    expect(() => parseModelResponse('{"rank": "GENERALISSIMO", "confidence": 0.9}')).toThrow();
    expect(() => parseModelResponse('{"rank": "major", "confidence": 0.9}')).toThrow(); // case-sensitive, not a valid RANK_CODE
  });

  it("rejects malformed JSON and responses with no JSON object at all", () => {
    expect(() => parseModelResponse("not json at all")).toThrow();
    expect(() => parseModelResponse('{"rank": "MAJOR", "confidence":')).toThrow();
  });
});
