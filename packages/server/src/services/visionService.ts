import Anthropic from "@anthropic-ai/sdk";
import { ALL_RANKS, RANK_LABELS, Rank } from "@salpakan/shared";
import { config } from "../config.js";
import { AMBIGUOUS_COUNT_CLUSTERS, pickReferenceImages, RANK_VISUAL_HINTS, type ReferenceImageMode } from "./rankReferences.js";

export interface RecognitionResult {
  rank: Rank;
  confidence: number;
  /** Short model-supplied justification (e.g. "read text MAJOR"). Not shown to players — kept for debugging misreads and for the recognition-feedback log. */
  reasoning?: string;
}

export interface VisionService {
  recognizeRank(imageBytes: Buffer, mimeType: string): Promise<RecognitionResult>;
}

const RANK_LIST_FOR_PROMPT = ALL_RANKS.map((r) => `- ${r} ("${RANK_LABELS[r]}"): ${RANK_VISUAL_HINTS[r]}`).join("\n");

// Reference Rank Manifest update: three rank clusters share near-identical
// banner text/icon shape and differ ONLY by a count — the highest-risk spots
// for a miscount under glare/tilt/blur. Called out explicitly (on top of the
// per-rank hints above) so the model treats these counts with extra care.
const AMBIGUOUS_COUNT_WARNING = [
  "Pay extra care with counting for these look-alike clusters — each one shares the same banner text or icon shape across multiple ranks and is told apart ONLY by how many stars/wheels/triangles are present:",
  ...AMBIGUOUS_COUNT_CLUSTERS.map((cluster) => `- ${cluster.description}`),
  'When your answer is any rank in one of these clusters, make your `reasoning` state the exact count you saw (e.g. "counted 3 wheel emblems").',
].join("\n");

const RETRY_REMINDER =
  'Your previous response could not be used — it must be ONLY the JSON object below, with "rank" set to exactly one of the 15 RANK_CODE values listed (not a label, not free text). Try again.';

/**
 * Vision/OCR classification backed by the Claude API. Sends the photo (plus
 * any configured few-shot reference images) as image content blocks and
 * asks for strict, structured JSON so the response is trivial to parse
 * deterministically — see the "Fix Low Recognition Accuracy" spec update:
 *  - §2.1: the prompt enumerates all 15 ranks with a set-specific visual
 *    description each (rankReferences.ts), and requires rank/confidence/
 *    reasoning as structured output.
 *  - §2.2: few-shot reference images (if any are configured) are attached
 *    ahead of the submitted photo, each labeled with which rank it shows.
 */
export class AnthropicVisionService implements VisionService {
  private readonly client: Anthropic;

  constructor(
    apiKey: string = config.anthropicApiKey,
    private readonly model: string = config.anthropicVisionModel,
    private readonly referenceMode: ReferenceImageMode = config.visionReferenceMode,
  ) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required to use AnthropicVisionService.");
    }
    this.client = new Anthropic({ apiKey });
  }

  async recognizeRank(imageBytes: Buffer, mimeType: string): Promise<RecognitionResult> {
    const content = this.buildContent(imageBytes, mimeType);

    const first = await this.call(content);
    const parsed = tryParseModelResponse(first);
    if (parsed) return parsed;

    // Closed-set structured output enforcement: retry once with a sharper
    // reminder before giving up, rather than silently accepting/guessing an
    // out-of-set value.
    const retryContent = [...content, { type: "text" as const, text: RETRY_REMINDER }];
    const second = await this.call(retryContent);
    const retried = tryParseModelResponse(second);
    if (retried) return retried;

    throw new Error(`Vision model did not return a valid rank after retry. Last response: ${second}`);
  }

  private buildContent(imageBytes: Buffer, mimeType: string): Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> {
    const content: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [];

    for (const ref of pickReferenceImages(this.referenceMode)) {
      content.push({
        type: "text",
        text: `Reference photo — this is what a ${ref.rank} ("${RANK_LABELS[ref.rank]}", ${ref.variant} variant) piece looks like on this exact set:`,
      });
      content.push({ type: "image", source: { type: "base64", media_type: ref.mimeType, data: ref.base64 } });
    }

    content.push({ type: "text", text: "Now identify the rank of THIS piece:" });
    content.push({
      type: "image",
      source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data: imageBytes.toString("base64") },
    });
    content.push({ type: "text", text: buildPrompt() });
    return content;
  }

  private async call(content: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam>): Promise<string> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [{ role: "user", content }],
    });
    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Vision model returned no text content.");
    }
    return textBlock.text;
  }
}

function buildPrompt(): string {
  return [
    "You are identifying the rank printed on a single Salpakan (Game of the Generals) game piece from a photo, for this specific physical set.",
    "Every piece on this set carries a diagonal banner with the rank name printed in English (except the Flag, which has no banner/text) plus a rank-specific icon — use whichever is clearer if one is glared, blurred, or tilted.",
    "Classify it into exactly one of these 15 ranks (respond with the RANK_CODE, not the label). Each entry below describes how that rank looks on this set:",
    RANK_LIST_FOR_PROMPT,
    "",
    AMBIGUOUS_COUNT_WARNING,
    "",
    "Respond with ONLY a JSON object, no other text, in this exact shape:",
    '{"rank": "<RANK_CODE>", "confidence": <number between 0 and 1>, "reasoning": "<short phrase, e.g. \'read banner MAJOR\' or \'counted 3 wheel emblems\'>"}',
    "`confidence` should reflect how certain you are overall — lower it for glare, blur, tilt, or ambiguous wear, or if banner text and icon seem to disagree.",
  ].join("\n");
}

/** Non-throwing variant of the old parseModelResponse — used internally so a bad first attempt can trigger a retry instead of failing outright. */
function tryParseModelResponse(text: string): RecognitionResult | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed: { rank?: string; confidence?: number; reasoning?: string };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (!parsed.rank || !ALL_RANKS.includes(parsed.rank as Rank)) return null;
  const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  return { rank: parsed.rank as Rank, confidence, reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined };
}

/** Throwing variant kept for compatibility with existing direct callers/tests of parsing logic. */
export function parseModelResponse(text: string): RecognitionResult {
  const result = tryParseModelResponse(text);
  if (!result) {
    throw new Error(`Could not parse a valid rank from vision model response: ${text}`);
  }
  return result;
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
    return { rank: ALL_RANKS[index], confidence: 0.9, reasoning: "stub: derived from byte length, not a real read" };
  }
}

export function createVisionService(): VisionService {
  if (config.visionProvider === "anthropic") {
    return new AnthropicVisionService();
  }
  return new StubVisionService();
}
