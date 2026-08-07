import { randomBytes, randomUUID } from "node:crypto";

export function generateSessionId(): string {
  return randomUUID();
}

export function generateChallengeId(): string {
  return randomUUID();
}

/** Bearer token handed to a joined player, scoped to their color. */
export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

/** Short human-shareable session code (for the "share a code" pairing flow). */
export function generateSessionCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}
