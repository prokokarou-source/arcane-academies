# Arcane Academies — Plan 3: Mobile Web Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first React web client (`packages/client`) that lets each player create or join a room, set up the lobby, play a full game against friends and bots on their own phone, survive reloads and network blips, and see Term duels and the final score breakdown.

**Architecture:** Three layers, each testable on its own.
- `src/net/` holds `GameClient`, a framework-free state machine over an injected `SocketLike` factory, `Storage` and timer functions. It owns the WebSocket, the rejoin token (in storage), automatic reconnect with backoff, close codes and the "solo vs bots" setup. React reads it through `useSyncExternalStore`.
- `src/game/derive.ts` holds pure functions that turn a `PlayerView` + `legal` into what the screens show (card options per hand card, trade cost, production, duel power, research, duel results of a Term). It uses only `@arcane/engine` data (`cardDef`, `academyDef`, `ACADEMIES`) and types.
- `src/ui/` holds the screens and components. They get state and a `GameClient` from context and call its methods; no screen talks to the socket.

**Tech Stack:** React 18.3, Vite 5.4 (already in the tree via Vitest 2.1), TypeScript 5 strict, Vitest + jsdom + React Testing Library, plain CSS with custom properties. No router library (the screen follows from client state) and no state library (one external store).

**Spec:** `docs/superpowers/specs/2026-11-13-arcane-academies-design.md` (sections 2, 3, 5, 6, 7). Builds on Plan 2 (`docs/superpowers/plans/2026-11-13-arcane-academies-server.md`) and its wire protocol in `packages/protocol/src/index.ts`.

## Global Constraints

- Mobile-first, portrait, one-handed use, 360px wide and up; iOS Safari and Android Chrome. No horizontal page scroll at 360px (the hand scrolls inside its own strip).
- The client never imports `@arcane/server` from `src/`. Only tests may (the end-to-end test starts the real server). Message types come from `@arcane/protocol`; card/academy data and types from `@arcane/engine`.
- The client sends intentions only. Every `act` sends an action object taken unchanged from the latest `legal` array (the server's auto-planned cheapest payment).
- Always identify yourself with `view.me`. In a 2-player game the second human is engine seat 2 (the Rival Archmage is seat 1).
- `legal: []` with `view.phase !== 'ended'` means "already submitted or not acting this phase" (bonus phase): show a waiting state, never an error.
- Rejoin token and room code live in `localStorage` under `arcane.session` as `{ code, token }`. Preferences under `arcane.prefs`.
- Close code `4001` (replaced: another device took the seat) and `4002` (expired) stop reconnecting and clear the session. A `{t:'closed', reason:'left'|'removed'}` clears the session but keeps the socket.
- Reconnect backoff: 500 ms, doubling, capped at 8 s; reset after a successful open.
- Server URL: `import.meta.env.VITE_SERVER_URL`, default `ws://<page hostname>:8787`.
- All UI text goes through the string table `src/i18n/strings.ts` (`en` complete; `el` typed as a partial table that falls back to `en`).
- Original content only: no 7 Wonders names, art or iconography. Placeholder art = family-colored frames (spec 5.4: basic white, rare black, lore gold, trade turquoise, duel orange, research magenta, patron silver) plus simple emoji/text icons. Purple accent, light theme.
- PWA-ready: `manifest.webmanifest`, theme color, icon, `viewport-fit=cover`, safe-area padding. Service worker and Capacitor are Plan 4.

## Review Focus

1. **Reload in the middle of a game.** The page must come back to the same seat and screen with no user action (stored token → `rejoin`). Tested in Task 3 (`rejoins with the stored token on open`) and Task 8 (end-to-end reload).
2. **Stale or dead session.** A stored token for a room that expired or a seat that was taken (`error` `no_room`/`bad_token` in reply to `rejoin`, or close 4001/4002) must drop the session and land on Home with a clear message, not loop. Tested in Task 3.
3. **Double tap on an action button.** Only one `act` per turn may be sent; the buttons stay disabled until a new `game` message arrives. Tested in Task 3 and Task 6 (`sends one act per turn`).
4. **Bonus phase and waiting seats.** A seat with `legal: []` sees "Waiting for…" with the names of seats that have not submitted, never an empty broken hand. Tested in Task 6.
5. **Narrow phones.** At 360px the hand, header and buttons fit; long names are truncated. Covered by CSS rules in Task 6 (`.hand` scrolls horizontally, names use `text-overflow: ellipsis`) and checked by hand at the end.

---

### Task 1: Package scaffold and string table

**Files:**
- Create: `packages/client/package.json` (`@arcane/client`, `"type": "module"`, private; deps `@arcane/engine`, `@arcane/protocol`, `react@^18.3.1`, `react-dom@^18.3.1`; devDeps `@vitejs/plugin-react@^4.3.4`, `@testing-library/react@^16.1.0`, `@testing-library/dom@^10.4.0`, `jsdom@^25.0.1`, `@types/react@^18.3.12`, `@types/react-dom@^18.3.1`, `@arcane/server`, `ws`, `@types/ws`)
- Create: `packages/client/tsconfig.json` (extends base; `lib: ["ES2022","DOM","DOM.Iterable"]`, `jsx: "react-jsx"`, `types: ["vite/client"]`), `vite.config.ts` (react plugin; `server.host: true`, port 5173; `test.environment: 'jsdom'`, `test.include: ['test/**/*.test.{ts,tsx}']`)
- Create: `packages/client/index.html`, `public/manifest.webmanifest`, `public/icon.svg`, `src/main.tsx`, `src/styles.css`
- Create: `packages/client/src/i18n/strings.ts`
- Modify: root `package.json` scripts: `test` and `typecheck` include the client; add `"client": "vite packages/client"`
- Test: `packages/client/test/strings.test.ts`

**Interfaces:**
- Produces: `type Lang = 'en' | 'el'`; `const en` (object of string templates, `{name}` placeholders); `type StringKey = keyof typeof en`; `const el: Partial<Record<StringKey, string>>`; `translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string`.

- [ ] **Step 1: Write the failing test** — `translate('en','waitingFor',{names:'Ana, Bob'})` returns `'Waiting for Ana, Bob…'`; `translate('el', key)` falls back to `en` for keys missing in `el`; an unknown placeholder stays as `{x}`.
- [ ] **Step 2: Run** `npx vitest run --root packages/client` — FAIL (module missing).
- [ ] **Step 3: Implement** the package files, `strings.ts` and the root scripts. `npm install` at the root.
- [ ] **Step 4: Run** `npx vitest run --root packages/client` and `npx tsc -p packages/client --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat(client): package scaffold, Vite config and string table`

### Task 2: View helpers (`derive.ts`)

**Files:**
- Create: `packages/client/src/game/derive.ts`
- Test: `packages/client/test/derive.test.ts` (builds real views with `createGame` + `viewFor` + `legalActions` from `@arcane/engine`)

**Interfaces:**
- Consumes: `PlayerView`, `PublicPlayer`, `Action`, `PaymentPlan`, `cardDef`, `academyDef`, `SeatStatus`.
- Produces:
  - `interface CardOptions { cardUid: string; defId: string; build?: Action; tower?: Action; sell?: Action; keep?: Action }`
  - `handOptions(view: PlayerView, legal: Action[]): CardOptions[]` — one entry per card in my hand, or only my `kept` card in the bonus phase, in hand order, with the matching legal actions (the same objects, not copies).
  - `tradeCost(plan: PaymentPlan): number` (= `coinsToLeft + coinsToRight`); `bankCost(plan: PaymentPlan): number` (= `coinsToBank`).
  - `neighbors(view: PlayerView): { left: number; right: number }` (left = `(me + n - 1) % n`, right = `(me + 1) % n`, matching the engine's `leftOf`/`rightOf`).
  - `duelPowerOf(p: PublicPlayer): number`, `researchOf(p: PublicPlayer): Record<Discipline, number>`, `productionOf(p: PublicPlayer): { options: Resource[]; amount: number }[]` (home resource + produce effects of built cards and built stages).
  - `towerOf(p: PublicPlayer): { built: number; total: number; next?: TowerStage }`.
  - `termDuels(prev: PlayerView | null, next: PlayerView): { seat: number; deltas: number[] }[] | null` — per seat, the duel tokens added between two views; null when none were added.
  - `waitingFor(view: PlayerView, seats: SeatStatus[]): string[] | null` — in the picking phase, names of seats with `hasSubmitted === false`, excluding the Archmage; in the bonus phase `null` (the view cannot tell which other seats hold a kept card, so the UI says "Waiting for the bonus turn…").

- [ ] **Step 1: Write the failing tests:** `handOptions` on a fresh 3-seat game returns 7 entries, each with `sell`; every `build` it returns is `===` an object in `legal`; `neighbors` for `me=0, n=3` is `{left:2,right:1}`; `duelPowerOf` of a player with no built cards is 0; `productionOf` of a fresh Pyromancy player is `[{options:['ore'],amount:1}]`; `termDuels` returns null for identical views and `[{seat:0, deltas:[1]}]` when one token was appended to seat 0; `tradeCost` sums both sides; `waitingFor` lists seats with `hasSubmitted === false` and skips the Archmage.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `derive.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): view helpers for hand options, neighbors and duels`

### Task 3: Connection and state (`GameClient`)

**Files:**
- Create: `packages/client/src/net/client.ts`, `packages/client/src/net/session.ts`
- Test: `packages/client/test/client.test.ts`, `packages/client/test/fakeSocket.ts`

**Interfaces:**
- Produces:
  - `interface SocketLike { readyState: number; send(data: string): void; close(): void; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: ((ev: { code: number }) => void) | null }`
  - `interface ClientDeps { url: string; createSocket(url: string): SocketLike; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void }`
  - `session.ts`: `loadSession(storage): { code: string; token: string } | null`, `saveSession(storage, s)`, `clearSession(storage)` (key `arcane.session`; corrupt JSON → null).
  - `type Notice = 'replaced' | 'expired' | 'left' | 'removed' | 'rejoinFailed'`
  - `type GameMsg = Extract<ServerMessage, { t: 'game' }>`
  - `interface ClientState { conn: 'connecting' | 'open' | 'reconnecting' | 'stopped'; seatId: string | null; code: string | null; hostId: SeatId | null; lobby: LobbyState | null; game: GameMsg | null; prevView: PlayerView | null; error: { code: ErrorCode; message: string } | null; notice: Notice | null; acting: boolean }`
  - `class GameClient { constructor(deps: ClientDeps); start(): void; stop(): void; getState(): ClientState; subscribe(fn: () => void): () => void; create(name: string); join(code: string, name: string); solo(name: string, bots: number, level: BotLevel); leave(); setSeat(patch: Omit<Extract<ClientMessage,{t:'setSeat'}>,'t'>); addBot(level: BotLevel); removeSeat(id: SeatId); setBotLevel(id: SeatId, level: BotLevel); updateSettings(patch: Partial<RoomSettings>); startGame(); act(action: Action); rematch(); clearError(); clearNotice() }`
- Behavior: messages sent while the socket is not open are queued and flushed on open. On open with a stored session → send `rejoin` before the queue. `joined` → save session, set `seatId`/`code`. `lobby` → set lobby and `hostId`, clear game and prevView. `game` → `prevView = old game?.view ?? null`, set game, `acting = false`. `error` while a rejoin is pending with `no_room`/`bad_token`/`not_in_room` → clear session, `notice = 'rejoinFailed'`, no error. Other errors → `error`, `acting = false`. `closed` → clear session, seatId, code, lobby, game; `notice = reason`. Socket close 4001/4002 → same (notice `replaced`/`expired`) and no reconnect, but a fresh socket is opened so Home can create/join again; any other close → `conn = 'reconnecting'`, reconnect after the backoff delay (500 ms ×2, max 8 s, reset on open). `act` sets `acting = true` and ignores further `act` calls until the next `game` or `error`. `solo`: send `create`; when the first `lobby` with me as host and 1 seat arrives, send `addBot(level)` `bots` times then `start`.

- [ ] **Step 1: Write the failing tests** with a `FakeSocket` (records sent frames; `open()`, `receive(msg)`, `serverClose(code)`) and a manual timer list:
  - `queues create until open, then sends it`
  - `saves the session on joined and rejoins with the stored token on open`
  - `clears the session and sets notice on close 4001 and does not rejoin` (same for 4002 → `expired`)
  - `reconnects with backoff after an unexpected close` (timers 500, then 1000; after an open the next drop waits 500 again)
  - `drops a dead session when rejoin is refused` (`error` `no_room` → session removed, `notice: 'rejoinFailed'`, `error: null`)
  - `closed left clears lobby and session but keeps the socket`
  - `sends one act per turn` (two `act` calls → one frame; after a new `game` message, `act` works again)
  - `solo adds bots and starts` (create → joined → lobby with 1 seat → frames `addBot`×N, `start`)
  - `keeps the previous view for duel results`
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `session.ts` and `client.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): GameClient with rejoin, reconnect, close codes and solo setup`

### Task 4: App shell, Home, Rules and Settings

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/context.tsx`, `src/ui/prefs.ts`, `src/ui/Home.tsx`, `src/ui/Rules.tsx`, `src/ui/Settings.tsx`; modify `src/main.tsx`
- Test: `packages/client/test/home.test.tsx`, `packages/client/test/render.tsx`

**Interfaces:**
- Consumes: `GameClient`, `translate`.
- Produces: `ClientProvider({ client, storage, children })`; `useClient(): GameClient`; `useClientState(): ClientState` (via `useSyncExternalStore`); `usePrefs(): [Prefs, (p: Prefs) => void]`; `useT(): (key: StringKey, vars?) => string`; `interface Prefs { name: string; lang: Lang; animations: boolean; sound: boolean; haptics: boolean }`, `loadPrefs(storage)`, `savePrefs(storage, p)` (key `arcane.prefs`, defaults name `''`, lang `'en'`, others true); `App({ initialRoom?: string })` chooses: `game` → `<Game/>`, `lobby` → `<Lobby/>`, else Home / Rules / Settings (local `page` state). A banner shows `notice` and `error` text with a dismiss button; a "Reconnecting…" bar shows while `conn === 'reconnecting'`.
- Home: name field (prefilled from prefs, saved on use), "Create game", code field + "Join" (code uppercased; prefilled from `?room=`), "Play solo" with bot count (1–6, default 3) and level (easy/normal/hard), links to Rules and Settings. Create/Join/Solo disabled until the name is 1–20 chars after trim (Join also needs a code).

- [ ] **Step 1: Write the failing tests** (`renderApp` helper renders `App` in a `ClientProvider` with a `GameClient` over a `FakeSocket` and in-memory storage):
  - `create sends the trimmed name`; `join uppercases the code and prefills it from initialRoom`; `solo sends create`; `buttons disabled without a name`; `shows the notice when the seat was replaced`; `settings saves name and language` (switching to `el` keeps rendering; missing keys fall back to English).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; `main.tsx` builds the real `GameClient` with `window.WebSocket`, `localStorage`, `window.setTimeout`, reads `?room=` and renders `<App initialRoom=…/>`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): app shell, home, rules and settings screens`

### Task 5: Lobby screen

**Files:**
- Create: `src/ui/Lobby.tsx`
- Test: `packages/client/test/lobby.test.tsx`

**Interfaces:**
- Consumes: `ClientState.lobby`, `seatId`; `ACADEMIES`.
- Behavior: shows the code large and a "Share link" button (`navigator.share({url: inviteUrl})` when available, else `navigator.clipboard.writeText`, then "Link copied"). Seat list: name, "You"/"Host" tags, human or bot with level, connected dot, academy select ("Random" = `null`, academies taken by others disabled) and side A/B select, editable for my seat and, for the host, for bot seats (`setSeat({seatId,…})`). Host only: "Add bot" with level, remove seat (not self), bot level select, grace select (10 s, 30 s, 60 s, 2 min, 5 min, 10 min), turn timer select (Off, 30 s, 60 s, 90 s, 2 min, 5 min), "Start" enabled with 2–7 seats. Everyone: "Leave". Non-hosts see "Waiting for the host to start".

- [ ] **Step 1: Write the failing tests:** `shows code and seats`; `host can add a bot and start` (frames `addBot` with chosen level, `start`); `non-host sees no host controls`; `picking an academy sends setSeat`; `academy taken by another seat is disabled`; `turn timer select sends settings with ms`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): lobby screen with seats, academies and host settings`

### Task 6: Game screen

**Files:**
- Create: `src/ui/Game.tsx`, `src/ui/CardView.tsx`, `src/ui/PlayerPanel.tsx`, `src/ui/Deadline.tsx`, `src/ui/icons.ts`
- Test: `packages/client/test/game.test.tsx` (real views from the engine, as in Task 2)

**Interfaces:**
- Consumes: `handOptions`, `neighbors`, `duelPowerOf`, `productionOf`, `researchOf`, `towerOf`, `tradeCost`, `bankCost`, `waitingFor`.
- `icons.ts`: `FAMILY_COLOR: Record<Family, string>` (white `#f4f1ea`, black `#2b2b33`, gold `#d9a520`, turquoise `#1fb5ad`, orange `#ef7d22`, magenta `#c2187f`, silver `#a9b0bb`), `RESOURCE_ICON: Record<Resource, string>`, `costLabel(c: Cost): string` and `effectLabel(e: Effect): string` (e.g. `+3 ★`, `⚔ 2`, `⚗ Alchemy`).
- Layout top to bottom: header (Term I/II/III, turn n/6, my coins, deadline countdown when `deadline` is set — `Deadline` shows whole seconds left from `deadline - Date.now()`, updated each second); neighbors row (left and right: name, coins, duel power, built count, bot/offline tags; tap opens `PlayerPanel` sheet with their built cards by family, tower stages and production; a "Table" button lists all seats); my area (production chips, duel power, research counts, tower `built/total`, built count, tap opens my panel); hand strip (`.hand`, horizontal scroll-snap, swipeable; each `CardView` shows name, family frame, cost, effects, and a status line: "Free (chain)" when `build.payment.free`, "Buy for N coins" when trade cost > 0, "Costs N coins" when bank cost > 0, "Can't build" when no `build`); tapping a card selects it; action bar for the selected card: Build (with trade cost), Tower, Sell (+3), Keep (Chronomancy, only when offered), each disabled unless the matching action exists or while `acting`. After acting, or when `legal` is empty and the game has not ended: "Waiting for {names}…".

- [ ] **Step 1: Write the failing tests:** `shows term, turn and coins`; `renders one card per hand card`; `build sends the legal action unchanged`; `sends one act per turn` (double click → one frame); `waiting seat with empty legal shows waiting names and no action bar` (bonus phase: "Waiting for the bonus turn…"); `bonus phase shows the kept card as the hand`; `tapping a neighbor opens their panel`; `shows the deadline countdown`; `uses view.me` (2-player game where `me = 2`: the hand is seat 2's and the neighbors are the Archmage and seat 0).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): game screen with hand, actions, neighbors and waiting status`

### Task 7: Term-end duels and game end

**Files:**
- Create: `src/ui/TermEnd.tsx`, `src/ui/GameEnd.tsx`; modify `src/ui/Game.tsx`
- Test: `packages/client/test/end.test.tsx`

**Interfaces:**
- Consumes: `termDuels(prevView, view)`; `game.result` (`scores: ScoreBreakdown[]`, `winners: number[]`); `SeatStatus`.
- TermEnd: a modal shown when `termDuels` is non-null, listing for me each new token as Win (+n) / Loss (−1) and each seat's total duel power, with a CSS entering animation (skipped when prefs `animations` is false), and "Continue". Ties add no token, so a neighbor with no token is shown as "Tie".
- GameEnd: shown instead of the hand when `game.result` exists: winner banner (the Archmage is listed but marked "can't win"), a table seats × categories (Duels, Coins, Tower, Lore, Trade, Research, Patrons, Total), my row highlighted; "Rematch" for the host (or anyone when the host is offline), others see "Waiting for the host"; "Leave" back to Home.
- The `GameMsg` has no host id: `ClientState.hostId` (Task 3) keeps `lobby.hostId` from the last lobby message through the game; I am host when `seatId === hostId`. If the server answers `rematch` with `not_host`, the error banner explains it.

- [ ] **Step 1: Write the failing tests:** `shows duel results after a Term` (prev view with no tokens, next with `[1,-1]` for me → "Win", "Loss"); `continue closes it`; `game end lists all categories and the winner`; `host sees rematch and sends it`; `non-host sees waiting text`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(client): term duel results and game end score breakdown`

### Task 8: End-to-end game, scripts and README

**Files:**
- Test: `packages/client/test/e2e.test.ts` (`// @vitest-environment node`)
- Modify: `README.md` (client section)

**Interfaces:**
- Consumes: `startServer({ port: 0, host: '127.0.0.1' })` from `@arcane/server` (test only), `GameClient` with `createSocket` wrapping `ws`'s `WebSocket` as `SocketLike`, an in-memory storage, real timers.

- [ ] **Step 1: Write the test** `plays a solo game against bots to the end`: `client.solo('Ana', 2, 'easy')`; on every state change, when `game.legal.length > 0` and not `acting`, `act(legal[0])`; finish when `game.result` exists; assert 3 scores and at least one winner. Second test `reloads mid-game and rejoins`: after the first `game` message, `stop()` the client, create a new `GameClient` with the same storage, `start()`, and expect a `game` message with the same `view.me` without sending `create`.
- [ ] **Step 2: Run** `npx vitest run --root packages/client test/e2e.test.ts` — PASS (it uses only finished parts; fix any integration bug it finds with its own failing unit test first).
- [ ] **Step 3: README** — section "Running the web client": `npm run server` and `npm run client` in two terminals, open `http://localhost:5173`, playing from phones on the same Wi-Fi (`http://<PC IP>:5173`; `VITE_SERVER_URL`; `CLIENT_URL` for invite links), screens overview.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` at the root — all green; `npx vite build packages/client` succeeds.
- [ ] **Step 5: Commit** `test(client): end-to-end game against the real server; README`

## Out of scope (Plan 4)

Editing the auto-planned trade split, the tutorial game, sound/music/haptics output (the settings are stored only), card animations beyond the duel modal, dark mode, service worker, Capacitor, final art, Greek translation text.
