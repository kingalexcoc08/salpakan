import type { CaptureMode, FlagVsFlagRule, PlayerColor } from "@salpakan/shared";
import type { Queryable } from "../db.js";
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
  constructor(private readonly db: Queryable) {}

  async createSession(params: CreateSessionParams): Promise<CreatedSession> {
    const id = generateSessionId();
    const now = new Date().toISOString();
    const flagVsFlagRule = params.flagVsFlagRule ?? "challengerWins";

    let code = "";
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = generateSessionCode();
      if (!(await this.getSessionByCode(candidate))) {
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

    await this.db.query(
      `INSERT INTO sessions
        (id, code, capture_mode, flag_vs_flag_rule, status, blue_name, red_name, blue_token, red_token, created_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`,
      [
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
      ],
    );

    return { session: (await this.getSessionById(id))!, tokens };
  }

  async getSessionById(id: string): Promise<SessionRow | undefined> {
    const result = await this.db.query<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
    return result.rows[0];
  }

  async getSessionByCode(code: string): Promise<SessionRow | undefined> {
    const result = await this.db.query<SessionRow>("SELECT * FROM sessions WHERE code = $1", [code]);
    return result.rows[0];
  }

  /** Assigns the remaining open color to a joining player and issues their token. */
  async joinSession(code: string, name?: string): Promise<{ session: SessionRow; color: PlayerColor; token: string }> {
    const session = await this.getSessionByCode(code);
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

    await this.db.query(
      `UPDATE sessions SET ${tokenColumn} = $1, ${nameColumn} = COALESCE(${nameColumn}, $2), status = 'ACTIVE' WHERE id = $3`,
      [token, name ?? null, session.id],
    );

    return { session: (await this.getSessionById(session.id))!, color, token };
  }

  async authenticate(sessionId: string, token: string): Promise<PlayerColor | null> {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    if (session.blue_token && session.blue_token === token) return "BLUE";
    if (session.red_token && session.red_token === token) return "RED";
    return null;
  }

  async markEnded(id: string): Promise<void> {
    await this.db.query("UPDATE sessions SET status = 'ENDED', ended_at = $1 WHERE id = $2", [new Date().toISOString(), id]);
  }
}
