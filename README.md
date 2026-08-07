# Salpakan Digital Arbiter

A phone-based replacement for the human arbiter in Salpakan (Game of the Generals):
players photograph their own piece when challenged, the app privately recognizes
the rank, applies the official rules, and announces only who won — never the
opponent's rank — until the game ends and the full log is revealed for dispute
resolution.

This is the MVP described in the project spec: arbitration logic first (trust-critical,
100% unit tested), then the recognition + session/log API, then the mobile-first PWA.

## Monorepo layout

```
packages/
  shared/   Pure, side-agnostic arbitration logic + hash-chain match-log utilities.
            No knowledge of HTTP, storage, or images. Fully unit tested (Vitest).
  server/   Express + TypeScript API: sessions, photo upload, Claude vision
            recognition, hash-chained match log (Postgres via `pg`, hosted on
            Supabase), post-game history. Integration-tested with Supertest
            against an in-memory Postgres-compatible engine (pg-mem).
  web/      React + Vite PWA: create/join a session, two-phone and one-phone
            capture flows, side-only result screens, post-game history.
```

## Requirements

- Node.js **>= 20**.
- A Postgres database — this project targets [Supabase](https://supabase.com)
  (a `sessions` + `challenges` schema needs to exist; see "Database" below).
  `DATABASE_URL` is required to run the server outside of tests.
- An `ANTHROPIC_API_KEY` for real rank recognition (optional for local dev/demo —
  see "Vision recognition" below).

## Quick start

```bash
npm install

# Terminal 1 — API server (defaults to :4000)
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
  npm run dev:server

# Terminal 2 — web app (defaults to :5173, proxies /api to :4000 in dev)
npm run dev:web
```

Open the web app, create a match on one device, and either share the session code
with a second device (two-phone mode) or hand a single device back and forth
(one-phone mode).

### Run the tests

```bash
npm test          # shared (arbitration + hash chain) + server (API integration)
npm run test:shared
npm run test:server
```

### Build everything

```bash
npm run build
```

## Database (Supabase / Postgres)

The server persists sessions and the hash-chained match log in Postgres via
the `pg` driver (`packages/server/src/db.ts`), not a local file — a
serverless host (e.g. Vercel Functions, the eventual target for this
project) has no durable local disk between invocations, so persistence has
to live in a real database from the start.

- **Get a connection string**: Supabase project → Settings → Database →
  Connection string → **Transaction pooler** (port 6543) is the right choice
  for a serverless/short-lived-connection host. Set it as `DATABASE_URL`.
  Treat it as a secret: set it as an environment variable on whatever
  actually runs the server (Vercel project settings, or a local `.env` —
  never commit it).
- **Schema**: `sessions` and `challenges` tables, mirroring the shape
  described in spec §5.3/§5.4. The server calls `ensureSchema()` on startup,
  which idempotently runs `CREATE TABLE IF NOT EXISTS` — safe to run
  against an already-migrated project, and enough to bootstrap a fresh one.
- **Timestamps are stored as `TEXT`, not a native Postgres timestamp type —
  deliberately.** The hash chain (spec §5.3) hashes each record's exact
  field values, including the timestamp string generated in JS at write
  time. Postgres's timestamp types reformat values on storage/read (different
  separator, timezone notation, precision); a value read back would not be
  byte-identical to what was written, which would silently break every hash
  recomputation from that point on. `TEXT` stores exactly the string handed
  to it and nothing else.
- **Tests never touch a real database.** `packages/server/test/testDb.ts`
  spins up [`pg-mem`](https://github.com/oguimbal/pg-mem), an in-memory
  Postgres-compatible engine, and runs the exact same schema/SQL the app
  runs in production — so the test suite exercises real query text with no
  network access or live credentials required.
- **Known gap**: raw challenge photos (spec §5.3's "keep for the duration of
  the game so a disputed result can be manually re-verified") are still
  stored on local disk (`UPLOAD_DIR`), which does not persist across
  invocations on a serverless host. This needs to move to object storage
  (e.g. a Supabase Storage bucket) before the server can actually run as
  Vercel Functions — tracked as a follow-up, not yet done.

## Architecture

### 1. Arbitration logic (`packages/shared/src/arbitration.ts`)

`resolveChallenge(rankA, rankB, whoInitiated, options?)` is a pure function with no
I/O — it's the trust-critical core described in spec §5.2, so it's the most
heavily tested part of the codebase (33 unit tests covering every rule in §1.2:
standard higher-rank-wins, equal-rank mutual destruction, the Spy-vs-Private
special case, Spy-vs-everything-else, Flag capture, and the configurable
Flag-vs-Flag house rule).

It's deliberately agnostic to player color ("A"/"B" sides) so it has zero
knowledge of sessions, images, or recognition — callers (the server) map their
own BLUE/RED colors onto A/B right at the call site. This keeps it trivially
testable and reusable if the recognition method ever changes.

### 2. Hash-chained match log (`packages/shared/src/hashChain.ts`)

Each resolved challenge becomes a `MatchRecord` containing both players' photo
hashes, recognized ranks, confidences, the resolution, and a `previousHash`
pointing at the prior record (`"GENESIS"` for the first). `recordHash` is a
SHA-256 over the canonicalized (key-sorted) record content. `verifyChain()`
walks the whole log and confirms every record's stored hash matches a fresh
recomputation, and that every `previousHash` link is intact — altering,
reordering, or deleting any past record breaks the chain from that point
forward. This is the anti-cheat mechanism from spec §5.3; the post-game history
endpoint runs it automatically and reports the result.

### 3. Server (`packages/server`)

- **Sessions** — two-player, no accounts. `TWO_PHONE` sessions are created by one
  player claiming a color, then paired via a 6-character code; `ONE_PHONE`
  sessions issue both colors' tokens immediately to the single device. Each
  color gets a bearer token that authenticates every request as that color —
  in two-phone mode this is a real secrecy boundary (the token only ever
  leaves the device it was issued to); in one-phone mode both tokens
  necessarily live on the same device, so the actual secrecy comes from the
  UI's hand-off gating, not the token.
- **Challenges** — `POST .../challenges` opens one (only one open at a time per
  session, mirroring one challenge happening on the physical board at a time).
  Each color submits a photo via `POST .../challenges/:id/submissions`; the
  response for that request is always a self-view (spec §5.0): your own rank,
  and — once both sides are in — the outcome by color, never the opponent's
  rank. Low-confidence recognition (below `CONFIDENCE_THRESHOLD`, default 0.75)
  is rejected with a "please retake" response instead of being silently
  guessed, and isn't stored.
- **History** — only available once the session is manually marked `ENDED`
  (full board-state win detection is out of scope for the MVP per spec §8/§4).
  Returns every resolved challenge with both ranks and a chain-integrity
  verdict.
- **Photo retention** — raw photos are kept on disk for the session's duration
  (so a disputed result can be manually re-verified) and deleted when the
  session ends; the hash, rank, and confidence already in the match log are
  kept permanently in Postgres. This is the retention policy the spec
  recommends for privacy/storage (§5.3) — see the "Database" section above
  for the serverless caveat on the disk part specifically.

### 4. Vision recognition (`packages/server/src/services/visionService.ts`)

`AnthropicVisionService` sends the photo to the Claude API as an image content
block and asks for strict JSON (`{"rank": "...", "confidence": 0..1}`) against
the 15 canonical rank codes. Set `ANTHROPIC_API_KEY` to use it; `ANTHROPIC_VISION_MODEL`
defaults to `claude-sonnet-5` and can be overridden (e.g. to a cheaper/faster
model) via env var.

Without an API key, the server automatically falls back to `StubVisionService`
— a clearly-labeled, deterministic offline stand-in (**not a real classifier**,
never use in production) so the rest of the app is fully exercisable without a
live key. This is what the server test suite uses.

### 5. Web PWA (`packages/web`)

- **Two-phone mode**: each device only ever holds its own color's token, so no
  in-app gating is needed — the server's self-view response is the only
  secrecy boundary, enforced per-request.
- **One-phone mode**: a local state machine enforces the hand-off discipline
  from spec §4 — "Pass to Blue" → Blue captures → immediately locks to "Pass to
  Red" (Blue's rank is never shown, even momentarily) → Red captures → the
  result is then revealed *twice*, once per hand-off ("Pass to Blue" → Blue's
  own result → "Pass to Red" → Red's own result), exactly matching the option
  the spec calls out for keeping the result screen consistent with the
  hand-off discipline.
- Installable as a PWA (manifest + app-shell precaching via `vite-plugin-pwa`);
  API calls always hit the network live so a stale cache can never serve a
  stale ruling.

## Configuration (server)

All optional; sensible defaults are used for local dev.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `DATABASE_URL` | — (required outside tests) | Postgres connection string — see "Database" above |
| `UPLOAD_DIR` | `./uploads` | Where raw challenge photos are stored until purge (local disk — see serverless caveat above) |
| `CONFIDENCE_THRESHOLD` | `0.75` | Below this, recognition is rejected and the player is asked to retake |
| `MAX_PHOTO_BYTES` | `8388608` (8MB) | Upload size cap |
| `ANTHROPIC_API_KEY` | — | Enables real recognition via the Claude API |
| `ANTHROPIC_VISION_MODEL` | `claude-sonnet-5` | Vision model to use |
| `VISION_PROVIDER` | `anthropic` if a key is set, else `stub` | Force `anthropic` or `stub` explicitly |
| `CORS_ORIGIN` | `*` | Restrict in production |

## Open questions carried over from the spec (§9)

- **One-phone vs two-phone as MVP scope**: both are implemented. Two-phone is
  the stronger secrecy guarantee (separate devices); one-phone relies on UI
  discipline since both tokens necessarily live on one device.
- **Physical set / rank label language**: the recognition prompt accepts
  English or Filipino-language labels on a best-effort basis, but hasn't been
  tuned against real sample photos of a specific manufacturer's set yet — do
  that before relying on this for a real tournament.
- **Flag vs Flag house rule**: implemented as configurable
  (`flagVsFlagRule: "challengerWins" | "mutualDestruction"`, default
  `"challengerWins"` per the tournament-standard default the spec calls out),
  set per-session at creation time.
- **Monetization/distribution**: out of scope; this MVP assumes personal/community
  use (e.g. sportsfest-style events).

## Known gaps / fast-follows

- Full board/move tracking and automatic win-condition detection (flag reaches
  home row, no legal moves) are explicitly out of scope per spec §8 — ending a
  game is a manual action by either player.
- No accounts/auth beyond the per-session color tokens — by design for MVP
  (spec §5.4).
- Raw photo storage is still local disk, incompatible with serverless hosting
  — see the "Database" section above.
- The live Supabase project's `sessions`/`challenges` tables were originally
  migrated with `uuid`/`timestamptz` columns for `id`/`session_id` and the
  timestamp fields; the app code now expects plain `TEXT` for all of these
  (see "Database" above for why, on timestamps specifically). The `id`/
  `session_id` mismatch is harmless (Postgres accepts UUID-formatted text
  transparently into a `uuid` column and hands it back as a plain string), but
  the `timestamptz` columns need to be fixed — via `apply_migration` — to
  `TEXT` before this app is pointed at that live project, or hash
  verification will break on every record. Both tables are currently empty,
  so the simplest fix is dropping and recreating them with the schema in
  `packages/server/src/db.ts`.
- The vitest/esbuild dev-dependency chain has known moderate/high advisories
  that only affect the local dev server (not exploitable in the shipped
  server or web build); harmless for this MVP but worth revisiting via
  `npm audit` before scaling the project.
