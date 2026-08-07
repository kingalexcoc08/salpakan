import type { CaptureMode, FlagVsFlagRule, PlayerColor } from "@salpakan/shared";
import type { DatabaseSync } from "node:sqlite";
import { generateSessionCode, generateSessionId, generateToken } from "../ids.js";
import type { SessionRow } from "../types.js";

export interface CreateSessionParams {
  captureMode: CaptureMode;
  flagVsFlagRule?: FlagVsFlagRule;
  /** Which color the creator claims. Ignored (both are claimed at once) for ONE_PHONE. */
  creatorColor?: PlayerColor;
  blueName?: string;
  redName?: string;
}

export interface CreatedSession {
  session: SessionRow;
  /** Tokens issued at creation time, keyed by color. */
  tokens: Partial<Record<PlayerColor, string>>;
}

const MAX_CODE_ATTEMPTS = 10;

export class SessionStore {
  constructor(private readonly db: DatabaseSync) {}

  createSession(params: CreateSessionParams): CreatedSession {
    const id = generateSessionId();
    const now = new Date().toISOString();
    const flagVsFlagRule = params.flagVsFlagRule ?? "challengerWins";

    let code = "";
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = generateSessionCode();
      if (!this.getSessionByCode(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error("Could not generate a unique session code, please retry.");
    }

    const tokens: Partial<Record<PlayerColor, string>> = {};
    let blueToken: string | null = null;
    let redToken: string | null = null;
    let status: SessionRow["status"];

    if (params.captureMode === "ONE_PHONE") {
      // A single shared device plays both colors — issue both tokens now.
      blueToken = generateToken();
      redToken = generateToken();
      tokens.BLUE = blueToken;
      tokens.RED = redToken;
      status = "ACTIVE";
    } else {
      const creatorColor = params.creatorColor ?? "BLUE";
      const token = generateToken();
      tokens[creatorColor] = token;
      if (creatorColor === "BLUE") blueToken = token;
      else redToken = token;
      status = "WAITING_FOR_OPPONENT";
    }

    this.db
      .prepare(
        `INSERT INTO sessions
          (id, code, capture_mode, flag_vs_flag_rule, status, blue_name, red_name, blue_token, red_token, created_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        code,
        params.captureMode,
        flagVsFlagRule,
        status,
        params.blueName ?? null,
        params.redName ?? null,
        blueToken,
        redToken,
        now,
      );

    return { session: this.getSessionById(id)!, tokens };
  }

  getSessionById(id: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  }

  getSessionByCode(code: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE code = ?").get(code) as SessionRow | undefined;
  }

  /** Assigns the remaining open color to a joining player and issues their token. */
  joinSession(code: string, name?: string): { session: SessionRow; color: PlayerColor; token: string } {
    const session = this.getSessionByCode(code);
    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }
    if (session.capture_mode !== "TWO_PHONE") {
      throw new Error("SESSION_NOT_JOINABLE");
    }
    if (session.blue_token && session.red_token) {
      throw new Error("SESSION_FULL");
    }

    const color: PlayerColor = session.blue_token ? "RED" : "BLUE";
    const token = generateToken();
    const nameColumn = color === "BLUE" ? "blue_name" : "red_name";
    const tokenColumn = color === "BLUE" ? "blue_token" : "red_token";

    this.db
      .prepare(`UPDATE sessions SET ${tokenColumn} = ?, ${nameColumn} = COALESCE(${nameColumn}, ?), status = 'ACTIVE' WHERE id = ?`)
      .run(token, name ?? null, session.id);

    return { session: this.getSessionById(session.id)!, color, token };
  }

  authenticate(sessionId: string, token: string): PlayerColor | null {
    const session = this.getSessionById(sessionId);
    if (!session) return null;
    if (session.blue_token && session.blue_token === token) return "BLUE";
    if (session.red_token && session.red_token === token) return "RED";
    return null;
  }

  markEnded(id: string): void {
    this.db.prepare("UPDATE sessions SET status = 'ENDED', ended_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }
}
