import type { CaptureMode, PlayerColor } from "@salpakan/shared";

const STORAGE_KEY = "salpakan.match.v1";

export interface MatchCredentials {
  sessionId: string;
  code: string;
  captureMode: CaptureMode;
  /** The color THIS device plays. Undefined only transiently for TWO_PHONE while creating. */
  myColor?: PlayerColor;
  /** TWO_PHONE: only this device's own token. ONE_PHONE: both, since one device plays both colors. */
  tokens: Partial<Record<PlayerColor, string>>;
  blueName?: string;
  redName?: string;
}

export function saveMatch(match: MatchCredentials): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
}

export function loadMatch(): MatchCredentials | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MatchCredentials;
  } catch {
    return null;
  }
}

export function clearMatch(): void {
  localStorage.removeItem(STORAGE_KEY);
}
