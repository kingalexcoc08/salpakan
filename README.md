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
  Submitting a piece is a two-step, player-confirmed flow (recognition
  confirmation update):
  1. `POST .../challenges/:id/submissions/preview` — recognizes the photo and
     returns `{rank, confidence, lowConfidence, token}` **without writing
     anything**. `lowConfidence` flags recognition below
     `CONFIDENCE_THRESHOLD` (default 0.75) as a warning for the player to
     weigh themselves, rather than auto-blocking the photo outright — an
     auto-flag can itself be a false positive.
  2. `POST .../challenges/:id/submissions/confirm` — locks it in. Must be
     called with the *same* photo bytes plus the `token` from step 1; the
     rank/confidence that get written always come from inside that signed
     token, never from anything the client sends directly, so a player can
     only ever confirm what the server actually recognized. If the player
     rejects the preview instead ("No, retake"), the client simply never
     calls `/confirm` — nothing was written in step 1, so a rejected
     recognition leaves no trace at all.

  The response for `/confirm` (and every other challenge-status read) is
  always a self-view (spec §5.0): your own rank, and — once both sides are
  in — the outcome by color, never the opponent's rank.
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

`AnthropicVisionService` sends the photo (plus any configured few-shot
reference images) to the Claude API as image content blocks and asks for
strict, structured JSON — `{"rank": "...", "confidence": 0..1, "reasoning":
"..."}` — against the 15 canonical rank codes. If the model's first response
doesn't parse into a valid rank from that closed set, it's retried once with
a sharper reminder before giving up (rather than silently guessing). Set
`ANTHROPIC_API_KEY` to use it; `ANTHROPIC_VISION_MODEL` defaults to
`claude-sonnet-5` and can be overridden (e.g. to a cheaper/faster model) via
env var.

Without an API key, the server automatically falls back to `StubVisionService`
— a clearly-labeled, deterministic offline stand-in (**not a real classifier**,
never use in production) so the rest of the app is fully exercisable without a
live key. This is what the server test suite uses.

**Recognition accuracy (`packages/server/src/services/rankReferences.ts`)** —
spec update "Fix Low Recognition Accuracy":
- `RANK_VISUAL_HINTS` gives each of the 15 ranks a set-specific visual
  description (text + icon, grounded from the physical set actually in use)
  baked into the prompt, instead of a single generic "what rank is this"
  ask.
- `REFERENCE_IMAGES` is the slot for true few-shot reference photos (one
  clean close-up per rank) — currently empty; populate it (rank + base64 +
  mimeType per entry) once individual photos are available and every
  recognition call picks them up automatically, no other code changes
  needed. `VISION_REFERENCE_MODE` controls how many get attached per call:
  `none` (cheapest), `grouped` (default — at most one per rank-encoding
  family, the spec's suggested fallback if attaching all 15 is too
  expensive/slow), or `full` (one per rank). Every mode is a no-op while
  `REFERENCE_IMAGES` is empty.
- `normalizeImage()` (`imageNormalize.ts`) is a server-side safety net:
  downscales anything over `MAX_UPLOAD_DIMENSION` (longest side, default
  1600px) before it reaches the vision API or disk, independent of whatever
  the client already did. Uses `jimp` (pure JS, no native bindings — safe on
  Vercel's serverless runtime). A no-op for images already within bounds,
  and deterministic for oversized ones, so it never breaks the recognition-
  confirmation flow's preview/confirm photo-hash check.
- **Recognition feedback** (`recognition_feedback` table /
  `RecognitionFeedbackStore`): every time a player rejects a recognition
  (the confirmation screen's "No, retake") the guessed rank/confidence and
  the photo's hash are logged; if they then confirm a different rank for
  that same challenge, the row is backfilled with what was actually
  confirmed — a labeled (guessed → confirmed) example of a misread. This is
  a deliberately separate, non-chained table (no `previous_hash`/
  `record_hash` columns, never read by arbitration/history/integrity
  verification) purely for measuring and later tuning recognition accuracy —
  not part of the tamper-evident match log.

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
- **Recognition confirmation** (`CaptureView`): after a photo is read, the
  capturing player sees a review screen — the photo, the recognized rank in
  plain text, and (if applicable) a low-confidence warning — before anything
  is locked in. "Yes, that's correct" confirms; "No, retake" discards the
  photo and result entirely and returns to the camera, with no attempt limit.
  This review screen is always a sub-state of the current capture step, so in
  one-phone mode it necessarily happens within the current player's hand-off
  turn, before control passes to the other player.
- **Capture guide + client-side preprocessing** (`CameraCapture.tsx`,
  `imagePreprocessing.ts`, `imageCanvasOps.ts`) — spec update "Fix Low
  Recognition Accuracy" §2.3/§2.4: the capture screen uses a live in-app
  camera feed (`getUserMedia`) with an on-screen alignment frame and the
  instruction "Fill the frame with just the piece, avoid glare" — this is
  what makes auto-cropping possible at all, since there's no way to overlay
  a guide frame on top of the OS's native camera app. On capture, the photo
  is cropped to that guide frame and resized to a consistent max dimension
  (1600px) client-side, before upload. If the camera is unavailable/denied
  (permissions, unsupported browser, non-HTTPS), it falls back to a plain
  file picker — in that path there's no guide frame to crop to, so the
  chosen photo is just resized to the same max dimension. The crop/resize
  math (`computeCropAndResize` in `imagePreprocessing.ts`) is a pure,
  DOM-free function so it's directly unit-tested; the actual canvas
  drawing/encoding lives in the separate `imageCanvasOps.ts`.
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
| `CONFIDENCE_THRESHOLD` | `0.75` | Below this, the confirmation screen shows a low-confidence warning (not an auto-block) |
| `VISION_REFERENCE_MODE` | `grouped` | Few-shot reference images attached per recognition call: `none` / `grouped` / `full` — see "Recognition accuracy" above |
| `MAX_UPLOAD_DIMENSION` | `1600` | Server-side safety-net cap (longest side, px) for images sent to the vision API / saved to disk |
| `MAX_PHOTO_BYTES` | `8388608` (8MB) | Upload size cap |
| `ANTHROPIC_API_KEY` | — | Enables real recognition via the Claude API |
| `ANTHROPIC_VISION_MODEL` | `claude-sonnet-5` | Vision model to use |
| `VISION_PROVIDER` | `anthropic` if a key is set, else `stub` | Force `anthropic` or `stub` explicitly |
| `CORS_ORIGIN` | `*` | Restrict in production |
| `SUBMISSION_TOKEN_SECRET` | falls back to `DATABASE_URL` | Signs the recognition-confirmation token (preview → confirm); no need to set explicitly since it already falls back to a secret production requires anyway |

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
- The vitest/esbuild dev-dependency chain has known moderate/high advisories
  that only affect the local dev server (not exploitable in the shipped
  server or web build); harmless for this MVP but worth revisiting via
  `npm audit` before scaling the project.
