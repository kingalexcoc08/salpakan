import type { CaptureMode, FlagVsFlagRule, PlayerColor, Rank } from "@salpakan/shared";

// In dev, an empty API_BASE means requests go to a relative "/api/..." path,
// which the Vite dev server proxies to a local API (see vite.config.ts).
// In a production build, fall back to the deployed API's origin if
// VITE_API_BASE_URL wasn't set at build time (e.g. a dotenv file not making
// it through a given deploy pipeline) — a build-time env var always wins
// when it IS present.
const PRODUCTION_API_BASE = "https://salpakan-api.vercel.app";
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? PRODUCTION_API_BASE : "");

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, init);
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export interface CreateSessionResponse {
  sessionId: string;
  code: string;
  captureMode: CaptureMode;
  flagVsFlagRule: FlagVsFlagRule;
  status: "WAITING_FOR_OPPONENT" | "ACTIVE" | "ENDED";
  tokens: Partial<Record<PlayerColor, string>>;
}

export function createSession(params: {
  captureMode: CaptureMode;
  creatorColor?: PlayerColor;
  flagVsFlagRule?: FlagVsFlagRule;
  blueName?: string;
  redName?: string;
}): Promise<CreateSessionResponse> {
  return request("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export interface JoinSessionResponse {
  sessionId: string;
  code: string;
  captureMode: CaptureMode;
  status: "ACTIVE";
  yourColor: PlayerColor;
  token: string;
}

export function joinSession(code: string, name?: string): Promise<JoinSessionResponse> {
  return request("/sessions/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
}

export interface SessionStatus {
  sessionId: string;
  code: string;
  captureMode: CaptureMode;
  flagVsFlagRule: FlagVsFlagRule;
  status: "WAITING_FOR_OPPONENT" | "ACTIVE" | "ENDED";
  blueName: string | null;
  redName: string | null;
  blueJoined: boolean;
  redJoined: boolean;
  challengeCount: number;
}

export function getSessionStatus(sessionId: string): Promise<SessionStatus> {
  return request(`/sessions/${sessionId}`);
}

export function endSession(sessionId: string, token: string): Promise<{ status: "ENDED" }> {
  return request(`/sessions/${sessionId}/end`, { method: "POST", headers: authHeaders(token) });
}

export interface CreateChallengeResponse {
  challengeId: string;
  challengeNumber: number;
  initiator: PlayerColor;
}

export function createChallenge(sessionId: string, token: string, initiator: PlayerColor): Promise<CreateChallengeResponse> {
  return request(`/sessions/${sessionId}/challenges`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ initiator }),
  });
}

/**
 * Recovery valve for a challenge stuck OPEN with nobody able/willing to
 * finish it — without this there'd be no way out (can't start a new
 * challenge, can't end the game) since something was left permanently open.
 */
export function abandonChallenge(sessionId: string, token: string, challengeId: string): Promise<void> {
  return request(`/sessions/${sessionId}/challenges/${challengeId}/abandon`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

interface ChallengeSelfViewOpenBase {
  challengeId: string;
  challengeNumber: number;
  yourSubmitted: boolean;
  yourRank: Rank | null;
  yourConfidence: number | null;
}

export type ChallengeSelfView =
  | { status: "NONE" }
  | (ChallengeSelfViewOpenBase & { status: "OPEN" })
  | (ChallengeSelfViewOpenBase & { status: "WAITING_FOR_OPPONENT" })
  | {
      challengeId: string;
      challengeNumber: number;
      status: "RESOLVED";
      yourRank: Rank;
      yourConfidence: number;
      outcome: "WIN" | "LOSE" | "MUTUAL_DESTRUCTION";
    };

export function getCurrentChallenge(sessionId: string, token: string): Promise<ChallengeSelfView> {
  return request(`/sessions/${sessionId}/challenges/current`, { headers: authHeaders(token) });
}

export function getChallenge(sessionId: string, token: string, challengeId: string): Promise<ChallengeSelfView> {
  return request(`/sessions/${sessionId}/challenges/${challengeId}`, { headers: authHeaders(token) });
}

export interface SubmissionPreview {
  rank: Rank;
  confidence: number;
  /** True when confidence is below the server's retake threshold — shown as a warning, not an auto-block (see CaptureView). */
  lowConfidence: boolean;
  /** Opaque, signed — hand this back unchanged to confirmSubmission(). */
  token: string;
}

/**
 * Step 1 of the recognition-confirmation flow: runs recognition on the
 * photo and returns what was read, without locking anything in yet. Call
 * confirmSubmission() to actually submit it, or just discard the result to
 * retake — nothing is written server-side until confirmSubmission().
 */
export function previewSubmission(
  sessionId: string,
  token: string,
  challengeId: string,
  photo: Blob,
  filename: string,
): Promise<SubmissionPreview> {
  const form = new FormData();
  form.append("photo", photo, filename);
  return request(`/sessions/${sessionId}/challenges/${challengeId}/submissions/preview`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
}

/**
 * Step 2: locks in a previously previewed recognition. Must be called with
 * the exact same photo and the token returned by previewSubmission() — the
 * server re-derives the rank from the token, never from anything sent here
 * directly, so this can only ever confirm what was actually recognized.
 */
export function confirmSubmission(
  sessionId: string,
  token: string,
  challengeId: string,
  photo: Blob,
  filename: string,
  submissionToken: string,
): Promise<ChallengeSelfView> {
  const form = new FormData();
  form.append("photo", photo, filename);
  form.append("token", submissionToken);
  return request(`/sessions/${sessionId}/challenges/${challengeId}/submissions/confirm`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
}

/**
 * Best-effort accuracy-feedback log (spec update "Fix Low Recognition
 * Accuracy" §2.5) for a rejected recognition ("No, retake") — fire-and-
 * forget from the caller's perspective; a failure here must never block
 * the player from retaking, so this deliberately doesn't throw.
 */
export async function reportRejectedRecognition(sessionId: string, token: string, challengeId: string, submissionToken: string): Promise<void> {
  try {
    await request(`/sessions/${sessionId}/challenges/${challengeId}/submissions/feedback`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ token: submissionToken }),
    });
  } catch {
    // Logging accuracy feedback is not part of the game flow — swallow.
  }
}

export interface HistoryResponse {
  sessionId: string;
  blueName: string | null;
  redName: string | null;
  endedAt: string | null;
  integrity: { valid: boolean; brokenAtIndex?: number; reason?: string };
  challenges: Array<{
    challengeNumber: number;
    timestamp: string;
    initiator: PlayerColor;
    blue: { rank: Rank; confidence: number; photoHash: string };
    red: { rank: Rank; confidence: number; photoHash: string };
    result:
      | { type: "win"; winner: PlayerColor; loser: PlayerColor; reason: string }
      | { type: "mutualDestruction"; reason: string };
  }>;
}

export function getHistory(sessionId: string, token: string): Promise<HistoryResponse> {
  return request(`/sessions/${sessionId}/history`, { headers: authHeaders(token) });
}
