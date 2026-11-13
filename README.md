# Arcane Academies

An original card-drafting game for 2–7 players: rival schools of magic, each player on their own phone.

| Package | What it is |
|---|---|
| `packages/engine` | Pure rules engine, card data, bots |
| `packages/sim` | Bot-vs-bot balance simulator (`npm run sim`) |
| `packages/protocol` | Typed WebSocket messages shared by server and client |
| `packages/server` | Authoritative multiplayer game server |
| `packages/client` | Mobile web client (React + Vite) |

Requires Node 20+. Install once with `npm install`.

```bash
npm test           # all test suites
npm run typecheck  # TypeScript, all packages
```

## Running the game server

```bash
npm run server
```

It listens on port 8787. Check it with `curl http://localhost:8787/health` (answers `{"ok":true,"rooms":0}`). Clients connect over WebSocket to `ws://localhost:8787`.

Settings (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port for HTTP and WebSocket |
| `HOST` | `0.0.0.0` | Interface to listen on |
| `CLIENT_URL` | `http://localhost:5173` | Web client address, used for invite links (`CLIENT_URL/?room=WAND-42`) |
| `GRACE_MS` | `60000` | Default wait before a bot takes over a disconnected player's seat (hosts can change it per room, 10 s–10 min) |
| `IDLE_MS` | `1800000` | A room with no messages for this long is closed |

### How a game runs

1. A player sends `{ "t": "create", "name": "Ana" }` and gets a room code like `WAND-42` and a rejoin token. The phone keeps the token.
2. Friends send `{ "t": "join", "code": "WAND-42", "name": "Bob" }`. The host can add bots, pick academies and sides, set a turn timer, then `start`.
3. During the game every phone only receives its own view (`viewFor`) and its own legal actions. It answers with `{ "t": "act", "action": … }`.
4. If a phone drops, it reconnects with `{ "t": "rejoin", "code", "token" }`. After the grace period a bot plays the seat until the player returns.

All message types are in `packages/protocol/src/index.ts`.

## Running the web client

Start the server and the client in two terminals:

```bash
npm run server
```

```bash
npm run client
```

Open http://localhost:5173. The client connects to `ws://<page host>:8787`; set `VITE_SERVER_URL` to use another server.

**Playing from phones on the same Wi-Fi:** open `http://<your PC's IP>:5173` on each phone (Vite listens on all interfaces). Start the server with `CLIENT_URL=http://<your PC's IP>:5173` so the lobby's share link points at the client.

Screens:

- **Home:** your name, create a game, join with a room code (or open an invite link `?room=WAND-42`), play solo against 1–6 bots, rules, settings (name, language, animations, sound, haptics).
- **Lobby:** room code and share link, seats (person or bot with level), academy (or random) and side A/B. The host adds and removes bots, sets the bot takeover time and an optional turn timer, and starts.
- **Game:** Term, turn, coins and turn countdown; both neighbors (tap to inspect, or open the whole table); your production, duel power, research and tower; your hand as swipeable cards that show whether each card is free by chain, affordable, or needs trading and for how much; Build / Tower / Sell (and Keep for Chronomancy). The payment is the server's cheapest plan.
- **Term end:** your duels against both neighbors. **Game end:** score breakdown per category, the winner, rematch.

The phone keeps its seat token, so reloading the page or losing the connection rejoins the same game automatically.

Production build (into `packages/client/dist`):

```bash
npx vite build packages/client
```
