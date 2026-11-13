# Arcane Academies — Plan 2: Authoritative Game Server

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node WebSocket server that hosts Arcane Academies rooms: lobby with room codes, the authoritative game through `@arcane/engine`, bots, rejoin, bot takeover, an optional turn timer and room expiry, with a typed protocol shared with the future client.

**Architecture:** Three layers, each testable on its own.
- `packages/protocol` holds the message types and a hand-written validator (`parseClientMessage`). It depends only on the engine (types plus the `RESOURCES` list), so the Plan 3 client can import it without server code.
- `packages/server/src/room.ts` is a transport-agnostic `Room`: it talks to `Conn` objects (`send`, `close`) and a `Clock` (time and timers), so lobby, game, presence and timer rules are tested synchronously with fake connections and a manual clock.
- `RoomManager` creates rooms, routes messages and expires rooms; `server.ts` wires it to plain `ws` over an `http` server (`GET /health`).

**Tech Stack:** Node 20+, TypeScript 5 strict, `ws` 8, Vitest, tsx. Plain `ws` instead of Colyseus: the engine already owns state and per-seat views, so Colyseus' schema sync would duplicate it and make hidden-info filtering harder.

**Spec:** `docs/superpowers/specs/2026-11-13-arcane-academies-design.md` (sections 2, 6.1, 7). Builds on Plan 1 (`docs/superpowers/plans/2026-11-13-arcane-academies-engine.md`).

## Global Constraints

- The server is the only authority. Clients send intentions only; every action goes through `submitAction` (any valid payment plan is accepted).
- **No phone ever receives another player's hand.** Each connection only gets `viewFor(state, itsSeat)` and `legalActions(state, itsSeat)`. The seed, `rngState`, other seats' `hand`, `pending`, `towerCards` and `kept` never go over the wire.
- 2–7 seats in the lobby (humans + bots). With 2 seats the engine inserts the Rival Archmage at engine seat 1, so lobby seat 1 becomes engine seat 2.
- Bot levels: `easy | normal | hard`. A taken-over human seat plays at `normal`.
- Room codes look like `WAND-42`: a 4-letter magic word, a dash, two digits 10–99. Joining is case-insensitive.
- Rejoin token: 128 random bits as hex, issued per seat, kept by the phone.
- Defaults: grace period 60 s (host may set 10 s–10 min), turn timer off (host may set 15 s–5 min), room expiry after 30 min with no client message. Max message 16 KB. Names are trimmed, 1–20 chars.
- Academy ids must exist in `ACADEMIES` and be unique among seats (the engine does not check this; the lobby must).
- Original content only: no 7 Wonders names anywhere, including the room-code word list.

## Review Focus

1. **A player who reconnects before the server notices the old socket died** (phone switched Wi-Fi). Rejoin must take over the seat and close the stale socket, not reject or duplicate. Tested in Task 5 (`rejoin replaces a stale connection`).
2. **A human seat that is bot-controlled when the player comes back mid-turn.** If the bot already submitted for this turn, that pick stands; the player acts from the next turn. Tested in Task 5 (`comeback mid-turn`).
3. **Malformed or hostile messages** (non-JSON, unknown `t`, payment with negative or non-integer numbers, unknown resource keys, huge names or payloads). They must produce an `error` reply, never a crash or an exception escaping the socket handler. Tested in Task 1 and Task 7 (`garbage does not crash the server`).
4. **The host leaves the lobby.** Host passes to the next human; with no humans left the room closes. Tested in Task 5.
5. **The bonus phase** (Chronomancy kept card): only some seats act; others must get `legal: []`, and the turn timer and bot takeover must only wait on acting seats. Tested in Task 4 (full game where a Chronomancy human always keeps when offered).

---

### Task 1: Protocol package

**Files:**
- Create: `packages/protocol/package.json` (`@arcane/protocol`, `"type": "module"`, `"main": "src/index.ts"`), `tsconfig.json`, `vitest.config.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/protocol.test.ts`

**Interfaces (all exported from `@arcane/protocol`):**
- `type SeatId = string`
- `interface RoomSettings { graceMs: number; turnTimerMs: number | null }`; `SETTINGS_LIMITS = { graceMs: [10_000, 600_000], turnTimerMs: [15_000, 300_000] }`; `DEFAULT_SETTINGS: RoomSettings = { graceMs: 60_000, turnTimerMs: null }`
- `interface LobbySeat { id: SeatId; kind: 'human' | 'bot'; name: string; botLevel?: BotLevel; academyId: string | null; side: 'A' | 'B'; connected: boolean }`
- `interface LobbyState { code: string; inviteUrl: string; hostId: SeatId; seats: LobbySeat[]; settings: RoomSettings }`
- `interface SeatStatus { seat: number; name: string; kind: 'human' | 'bot' | 'archmage'; connected: boolean; botControlled: boolean }` (engine seat numbers)
- `type ClientMessage =`
  `{ t: 'create'; name }` | `{ t: 'join'; code; name }` | `{ t: 'rejoin'; code; token }` | `{ t: 'leave' }` |
  `{ t: 'setSeat'; seatId?; name?; academyId?: string | null; side?: 'A' | 'B' }` |
  `{ t: 'addBot'; level: BotLevel }` | `{ t: 'removeSeat'; seatId }` | `{ t: 'setBotLevel'; seatId; level }` |
  `{ t: 'settings'; settings: Partial<RoomSettings> }` | `{ t: 'start' }` | `{ t: 'act'; action: Action }` | `{ t: 'rematch' }`
- `type ServerMessage =`
  `{ t: 'joined'; code; seatId; token }` | `{ t: 'lobby'; lobby: LobbyState }` |
  `{ t: 'game'; view: PlayerView; legal: Action[]; seats: SeatStatus[]; deadline: number | null; result?: { scores: ScoreBreakdown[]; winners: number[] } }` |
  `{ t: 'error'; code: ErrorCode; message: string }` | `{ t: 'closed'; reason: CloseReason }`
- `type CloseReason = 'expired' | 'replaced' | 'left' | 'removed'`
- `type ErrorCode = 'bad_message' | 'no_room' | 'room_full' | 'not_in_room' | 'not_host' | 'bad_token' | 'bad_seat' | 'academy_taken' | 'unknown_academy' | 'bad_settings' | 'wrong_phase' | 'seat_count' | 'illegal_action'`
- `function parseClientMessage(raw: string): ClientMessage | null` — `null` for anything invalid
- `function encode(msg: ClientMessage | ServerMessage): string` (JSON)
- `MAX_NAME = 20`, `MAX_MESSAGE_BYTES = 16_384`

- [ ] **Step 1: Write the failing tests**
  - `round-trips every client message`: one sample of each of the 12 variants; `parseClientMessage(encode(m))` deep-equals `m`. Include an `act` with a full `PaymentPlan` (`buyLeft: { ink: 1 }`, `coinsToLeft: 2`, `free: false`).
  - `round-trips server messages through JSON`: `JSON.parse(encode(m))` deep-equals `m` for a `lobby` and an `error`.
  - `rejects malformed input` → `null` for: `'not json'`, `'[]'`, `'{"t":"nope"}'`, `join` without code, `join` with a 21-char name, `join` with name `'   '`, `addBot` level `'insane'`, `act` with `cardUid: 5`, `act` with `coinsToLeft: -1`, `act` with `coinsToBank: 1.5`, `act` with `buyLeft: { gold: 1 }`, `act` with `type: 'steal'`, `settings` with `graceMs: '60'`, a string longer than `MAX_MESSAGE_BYTES`.
  - `trims names`: `{t:'create', name:'  Ana  '}` parses to `'Ana'`.
- [ ] **Step 2: Run `npx vitest run --root packages/protocol`** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `packages/protocol/src/index.ts`.** Hand-written guards, no schema library; the parser rebuilds each message from validated fields only (unknown extra fields dropped). Settings values must be integers or `null`; range checks happen in the room (`bad_settings`).
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(protocol): typed client/server messages with validation`

### Task 2: Server scaffold, clock and room codes

**Files:**
- Create: `packages/server/package.json` (`@arcane/server`, deps `ws`, `@arcane/engine`, `@arcane/protocol`; devDep `@types/ws`), `tsconfig.json`, `vitest.config.ts`
- Create: `packages/server/src/clock.ts`, `packages/server/src/codes.ts`
- Test: `packages/server/test/codes.test.ts`, `packages/server/test/clock.test.ts`
- Modify: root `package.json` scripts: `test` runs engine, protocol and server suites; `typecheck` covers all three.

**Interfaces:**
- `interface Clock { now(): number; setTimer(ms: number, fn: () => void): unknown; clearTimer(h: unknown): void }`; `const realClock: Clock`
- `class ManualClock implements Clock { advance(ms: number): void }` — fires due timers in time order, including timers scheduled by fired callbacks that are already due.
- `function generateCode(taken: (code: string) => boolean, random?: () => number): string`; `function normalizeCode(input: string): string` (trim + upper case); `const CODE_WORDS: readonly string[]` — 24 original 4-letter magic words (e.g. WAND, RUNE, MAGE, SAGE, MYTH, STAR, MOON, TOME, ORBS, VEIL, MIST, HEXE).

- [ ] **Step 1: Failing tests:** codes match `/^[A-Z]{4}-[1-9]\d$/`; `generateCode` skips a taken code (inject `random` that first yields the taken one); `normalizeCode(' wand-42 ') === 'WAND-42'`. `ManualClock`: timers fire in order on `advance`, `clearTimer` cancels, a 0 ms timer set inside a callback fires within the same `advance`.
- [ ] **Step 2: Run** `npx vitest run --root packages/server` — FAIL.
- [ ] **Step 3: Implement**; `npm install` to link the workspace and install `ws`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): package scaffold, clock and room codes`

### Task 3: Room lobby

**Files:**
- Create: `packages/server/src/room.ts`
- Test: `packages/server/test/lobby.test.ts`, `packages/server/test/fakes.ts` (`FakeConn` recording sent messages; `last(conn, t)` helper)

**Interfaces:**
- `interface Conn { send(msg: ServerMessage): void; close(reason: CloseReason): void }`
- `interface RoomOptions { clientUrl: string; defaultSettings?: Partial<RoomSettings>; seed?: () => number }`
- `class Room`: `constructor(code: string, opts: RoomOptions, clock: Clock)`; `phase: 'lobby' | 'game'`; `lastActivity: number`; `closed: boolean`; `join(conn, name)` (sends `joined` then broadcasts `lobby`; errors `wrong_phase`, `room_full` at 7 seats); `rejoin(conn, token)` (Task 5); `handle(conn, msg)` for every message except create/join/rejoin; `disconnect(conn)` (Task 5); `close(reason)`; `hasMember(conn): boolean`.
- Lobby seat ids `s1`, `s2`, … never reused within a room. Bot names `Bot 1`, `Bot 2`, …
- `inviteUrl = ${clientUrl}/?room=${code}`.

- [ ] **Step 1: Failing tests** (`lobby.test.ts`):
  - first joiner is host; `joined.token` is 32 hex chars; every member gets the same `lobby` after each change.
  - `addBot`, `removeSeat`, `setBotLevel`, `settings`, `start` from a non-host → `error not_host`, lobby unchanged.
  - `setSeat` on another human's `seatId` → `bad_seat`; the host may `setSeat` a bot seat.
  - `academyId: 'nope'` → `unknown_academy`; a second seat picking `'pyromancy'` → `academy_taken`; `academyId: null` clears.
  - `settings { graceMs: 5000 }` → `bad_settings`; `{ turnTimerMs: 30000 }` and `{ turnTimerMs: null }` accepted.
  - 8th seat (join or addBot) → `room_full`.
  - `start` with 1 seat → `seat_count`; host + 1 human → each gets `game` with `view.players.length === 3`, `view.players[1].config.kind === 'archmage'`, host `view.me === 0`, other `view.me === 2`.
  - `join` after start → `wrong_phase`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement the lobby part of `Room`.** `start` builds `SeatConfig[]` from lobby seats and calls `createGame({ seed, seats })`, seed from `opts.seed ?? crypto.randomInt(2 ** 31)`. Lobby index → engine seat: `n === 2 ? [0, 2][i] : i`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): room lobby`

### Task 4: Room game loop and hidden information

**Files:**
- Modify: `packages/server/src/room.ts`
- Test: `packages/server/test/game.test.ts`

**Interfaces:**
- `Room.state: GameState | null` (read by tests)
- private `advance()`: repeat { submit `archmagePick` / `botPick(level)` for every acting seat with no `pending` that is a bot, the archmage, or bot-controlled; if `allSubmitted` → `resolveTurn`, else stop } until ended; then broadcast `game` to every member and (re)arm the turn timer.
- `game.result` set when `state.phase === 'ended'`, from `finalScores` and `winners`.

- [ ] **Step 1: Failing tests:**
  - `act` with a card not in hand → `illegal_action`; `act` in the lobby → `wrong_phase`; state unchanged.
  - a human acts while others are bots → the turn resolves at once (`view.turn` 1 → 2).
  - **full game, no leaks:** 3 humans (seat 0 `academyId: 'chronomancy'`); picker prefers `chronoKeep`, then `tower`, then `legal[0]`; each `FakeConn` acts whenever its latest `game` has non-empty `legal`. Loop until `result`. Assert: ended, 3 scores. Inside `FakeConn.send`, synchronously check every message against `room.state`: the JSON contains no `uid` from another engine seat's `hand`, `towerCards` or `kept`, and no keys `rngState`, `seed`, `pending`, `towerCards`.
  - **2 seats with a bot:** host + `addBot('hard')` → 3 engine seats; the host plays to `result`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `act`, `advance`, `broadcastGame` (per-seat `viewFor` + `legalActions`; `legal: []` when the seat already submitted). Every engine error becomes `illegal_action`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): authoritative game loop with per-seat views`

### Task 5: Presence — rejoin, grace bot takeover, turn timer, rematch

**Files:**
- Modify: `packages/server/src/room.ts`
- Test: `packages/server/test/presence.test.ts`

**Interfaces:**
- `SeatStatus.connected / botControlled` reflect presence. Taken-over seats play `botPick(..., 'normal')`.
- `game.deadline`: epoch ms when the turn timer fires, else `null`.

- [ ] **Step 1: Failing tests** (ManualClock):
  - **rejoin:** in game, `disconnect(a)`, `rejoin(a2, tokenA)` → `a2` gets `joined` with the same `seatId` and a `game` with the same `view.me` and hand. Wrong token → `bad_token`.
  - **rejoin replaces a stale connection:** `rejoin(a2, tokenA)` while `a` is connected → `a` gets `close('replaced')`; `a2` owns the seat; `a` is no longer a member.
  - **bot takeover:** 2 humans + 1 bot; `b` disconnects; after `graceMs - 1` and `a` acting, turn is still 1; after 1 more ms `b` is `botControlled` and the turn resolves; later turns proceed with only `a` acting. `b` rejoins → `botControlled: false`; the next turn waits for `b`.
  - **comeback mid-turn:** `b` taken over and rejoins after the bot submitted for the current turn → `b`'s `legal` is `[]` until the next turn.
  - **turn timer:** `settings { turnTimerMs: 30000 }`, start → `deadline === now + 30000`; nobody acts; advance 30 000 → the turn advanced and a new deadline is set. Timer off → `deadline === null`.
  - **lobby leave/disconnect:** non-host `leave` → seat removed, conn gets `closed('left')`. Host disconnects in the lobby and stays away `graceMs` → seat removed, host passes to the next human. Last human gone → `room.closed === true`.
  - **rematch:** after `result`, host `rematch` → everyone gets a `lobby` with the same seats; non-host → `not_host`; mid-game → `wrong_phase`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** One grace timer per disconnected human seat, cleared on rejoin. On expiry in game → `botControlled = true`, `advance()`; in the lobby → remove the seat (host passes, empty room closes). Turn timer: armed after each `advance()` when not ended and `turnTimerMs` set; on fire, `botPick(..., 'normal')` for every unsubmitted acting seat, then `advance()`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): rejoin, bot takeover, turn timer, rematch`

### Task 6: Room manager and expiry

**Files:**
- Create: `packages/server/src/manager.ts`
- Test: `packages/server/test/manager.test.ts`

**Interfaces:**
- `interface ManagerOptions extends RoomOptions { idleMs: number; sweepMs: number }` (defaults 30 min, 60 s)
- `class RoomManager`: `constructor(opts: Partial<ManagerOptions>, clock: Clock)`, `onMessage(conn, msg: ClientMessage)`, `onClose(conn)`, `room(code): Room | undefined`, `size(): number`, `sweep()`, `stop()`.
- Routing: `create` → new room, fresh code, `join(conn, name)`; `join`/`rejoin` → `normalizeCode`, `no_room` if missing. A conn already in a room that sends `create`/`join`/`rejoin` is detached from its old room first. Other messages go to the conn's room, else `not_in_room`.

- [ ] **Step 1: Failing tests:** `create` gives a code in the code format and `size() === 1`; `join` with a lower-case code works; unknown code → `no_room`; `start` from a conn in no room → `not_in_room`; idle room: advance `idleMs + sweepMs` → every conn gets `closed('expired')` and `size() === 0`; a message every 10 min keeps it alive past `idleMs`; a closed room (last human left) is removed at the next sweep.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(server): room manager with idle expiry`

### Task 7: WebSocket transport, entry point and README

**Files:**
- Create: `packages/server/src/server.ts`, `packages/server/src/main.ts`, `packages/server/src/index.ts`
- Test: `packages/server/test/ws.test.ts`, `packages/server/test/wsClient.ts` (test client with a message queue and `next(t, predicate?)` with timeout)
- Modify: root `package.json` (`"server": "tsx packages/server/src/main.ts"`), `README.md` (create: "Running the game server")

**Interfaces:**
- `function startServer(opts: { port: number; host?: string; manager?: Partial<ManagerOptions> }): Promise<{ port: number; manager: RoomManager; close(): Promise<void> }>`
- HTTP `GET /health` → `200 {"ok":true,"rooms":N}`; anything else 404. WebSocket on any path with `maxPayload: MAX_MESSAGE_BYTES`. Invalid message → `error bad_message`. No exception escapes a handler.
- `main.ts` env: `PORT` (8787), `HOST` (`0.0.0.0`), `CLIENT_URL` (`http://localhost:5173`), `GRACE_MS`, `IDLE_MS`.

- [ ] **Step 1: Failing tests** (real server on port 0, real `ws` clients):
  - **two clients play a full 2-player game over the wire** to `result`, acting with `legal[0]` whenever offered; both see the same `winners`.
  - **no hidden info over the wire:** for `game` messages with equal `(term, turn, phase)`, A's raw text contains none of B's hand `uid`s and vice versa; no raw message contains `"rngState"`, `"seed"`, `"pending"`, `"towerCards"`.
  - **rejoin over the wire:** B closes mid-game, reconnects, sends `rejoin` → `joined` + `game` with its hand; the game reaches `result`.
  - **bot takeover over the wire:** `startServer({ manager: { defaultSettings: { graceMs: 50 } } })` (server defaults may go below the host limit); B closes; A keeps acting; B becomes `botControlled` and the game reaches `result` with only A acting.
  - **garbage does not crash the server:** `'{{{'` → `error bad_message`; a 20 KB frame closes that socket; `/health` still returns 200.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5:** `npm run server` logs `Arcane Academies server listening on :8787`; `GET /health` → `{"ok":true,"rooms":0}`.
- [ ] **Step 6: Commit** `feat(server): websocket transport, npm run server, README`

### Task 8: Final review

- [ ] `npm test` and `npm run typecheck` — all green.
- [ ] Whole-branch review (superpowers:requesting-code-review); fix findings; commit.
