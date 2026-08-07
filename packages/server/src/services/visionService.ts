import Anthropic from "@anthropic-ai/sdk";
import { ALL_RANKS, RANK_LABELS, Rank } from "@salpakan/shared";
import { config } from "../config.js";

export interface RecognitionResult {
  rank: Rank;
  confidence: number;
}

export interface VisionService {
  recognizeRank(imageBytes: Buffer, mimeType: string): Promise<RecognitionResult>;
}

const RANK_LIST_FOR_PROMPT = ALL_RANKS.map((r) => `- ${r}: "${RANK_LABELS[r]}"`).join("\n");

/**
 * Vision/OCR classification backed by the Claude API (spec §5.1). Sends the
 * photo as an image content block and asks for strict JSON so the response
 * is trivial to parse deterministically.
 *
 * Rank labels vary by physical set (English vs. Filipino-language sets —
 * spec §9 open question). The prompt is deliberately permissive about the
 * printed text and asks the model to map whatever it reads to the closest
 * of the 15 canonical ranks below; this should be tightened once real
 * sample photos of the specific set(s) in use are available.
 */
export class AnthropicVisionService implements VisionService {
  private readonly client: Anthropic;

  constructor(apiKey: string = config.anthropicApiKey, private readonly model: string = config.anthropicVisionModel) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required to use AnthropicVisionService.");
    }
    this.client = new Anthropic({ apiKey });
  }

  async recognizeRank(imageBytes: Buffer, mimeType: string): Promise<RecognitionResult> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: imageBytes.toString("base64"),
              },
            },
            {
              type: "text",
              text: buildPrompt(),
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Vision model returned no text content.");
    }
    return parseModelResponse(textBlock.text);
  }
}

function buildPrompt(): string {
  return [
    "You are identifying the rank printed on a single Salpakan (Game of the Generals) game piece from a photo.",
    "The label may be printed in English or Filipino, and the piece may be tilted, glared, or worn.",
    "Classify it into exactly one of these 15 ranks (respond with the RANK_CODE, not the label):",
    RANK_LIST_FOR_PROMPT,
    "",
    "Respond with ONLY a JSON object, no other text, in this exact shape:",
    '{"rank": "<RANK_CODE>", "confidence": <number between 0 and 1>}',
    "`confidence` should reflect how certain you are of the printed text — lower it for glare, blur, tilt, or ambiguous wear.",
  ].join("\n");
}

export function parseModelResponse(text: string): RecognitionResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not find JSON in vision model response: ${text}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as { rank?: string; confidence?: number };
  if (!parsed.rank || !ALL_RANKS.includes(parsed.rank as Rank)) {
    throw new Error(`Vision model returned an unrecognized rank: ${parsed.rank}`);
  }
  const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  return { rank: parsed.rank as Rank, confidence };
}

/**
 * Deterministic offline fallback used when no ANTHROPIC_API_KEY is
 * configured (local dev/demo/tests). NOT a real classifier — it derives a
 * rank from the image byte length so repeated calls with the same photo are
 * stable, purely so the rest of the app is exercisable without a live API
 * key. Must never be used in production.
 */
export class StubVisionService implements VisionService {
  async recognizeRank(imageBytes: Buffer): Promise<RecognitionResult> {
    const index = imageBytes.length % ALL_RANKS.length;
    return { rank: ALL_RANKS[index], confidence: 0.9 };
  }
}

export function createVisionService(): VisionService {
  if (config.visionProvider === "anthropic") {
    return new AnthropicVisionService();
  }
  return new StubVisionService();
}
