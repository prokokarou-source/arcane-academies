# Arcane Academies — Design

*Working title. Date: 2026-11-13.*

## 1. Intent and the why

The user wants to play a card-drafting game in the style of 7 Wonders **remotely with friends, each on their own phone**. If it turns out well, they want to **publish it on the Apple App Store and Google Play**. So the result has to be a complete, polished, original game, not a quick prototype.

It must be **original**. It uses the general drafting mechanics of the genre (simultaneous pick-and-pass, building with resources, buying from neighbors, scoring across rounds), but its theme, names, card list, numbers, art and scoring rules are our own. It must not copy 7 Wonders' or 7 Wonders Duel's names, card set, wonders, art or trade dress.

**Theme (chosen by the user):** rival schools of magic. Each player runs an academy, builds its facilities, raises a wizard tower and duels the neighboring academies.

**Classic feel (user's revision):** the user wants the game to play as close to the familiar genre as possible, with no extra twists. So the core loop is the standard one players of drafting games expect: a hand of 7, pick and pass, build / tower / sell, chains, buying from neighbors, duels at the end of each round. What stays our own: the theme, names, art, the full card list and its numbers, the academies and their powers, the exact scoring values, and the 2-player mode. The game is not a rule-for-rule or card-for-card copy of 7 Wonders.

## 2. Goals, non-goals, anti-goals

**Goals**
- 3–7 players, plus a dedicated 2-player mode.
- Remote play: every player on their own phone, joined by a short room code or invite link.
- Computer opponents (bots) to fill seats or play solo. This is also needed for app store review.
- Survives disconnects: a player can close the app and rejoin the same game.
- A complete product: tutorial, rules reference, settings, sound, animations, end-of-game score breakdown, rematch.
- One TypeScript codebase that runs in phone browsers (v1) and is packaged later as native iOS and Android apps.

**Non-goals (for now)**
- User accounts, friends lists, public matchmaking with strangers, rankings.
- In-app purchases, ads.
- Chat. Quick emotes are allowed.
- Expansions.

**Anti-goals** (a failure even if it works)
- Anything recognizably copied from 7 Wonders: names, card list, wonder boards, iconography, art.
- Hidden information leaking: no phone ever receives another player's hand.
- Feeling like a website in a wrapper: slow, janky, or broken when the network blips.
- Rules a new player can't learn in one game with the tutorial.

## 3. Constraints

- Mobile-first, portrait, one-handed use, 360px wide and up. Works on iOS Safari and Android Chrome.
- A turn should take a few seconds. Games run about 20–30 minutes.
- The store releases need accounts in the user's name: Apple Developer ($99/year) and Google Play ($25 once). The user creates these themselves.
- Hosting must start free or cheap.

## 4. Approaches (how the phones connect)

| Approach | Trade-off | Decision |
|---|---|---|
| One phone hosts, peer-to-peer (WebRTC/PeerJS), static page | No server. But it depends on a public broker, and the game dies if the host leaves. Not store-grade. | Rejected once the store goal came in |
| **Authoritative game server + web client packaged with Capacitor** | One small server to deploy. The server holds the true state, hides hands, validates moves and handles rejoin. | **Chosen** (user approved) |
| Hosted database (Firebase) as shared state | Reliable, but clients would see all the data, so hidden hands need extra rules. Ties the game to a vendor and needs key setup. | Rejected |

## 5. The game

### 5.1 Overview
Three **Terms** (rounds). In each Term every player gets a hand of 7 cards. Everyone secretly picks one card at the same time, all picks are revealed and resolved, then the remaining hands are passed to the next player. After 6 picks, the 7th card of each hand goes to the **Archive** (a shared discard pile). Passing goes left in Terms I and III and right in Term II. After Term III, the player with the most **Renown** wins.

### 5.2 What you can do with a picked card (one per turn)
1. **Build it** by paying its cost in resources and/or coins. It joins your academy. It is free if you already own its **prerequisite** card (chains).
2. **Raise a tower stage** by tucking the card face-down under your tower and paying that stage's cost.
3. **Sell it** to the Archive for 3 coins.

You can't build two copies of the same card.

### 5.3 Resources and trading
- **Basic (4):** Herbs, Ore, Ink, Moonstone.
- **Rare (3):** Essence, Starglass, Dragonscale.
- Each academy produces 1 of its **home resource** at the start. Each of the 7 academies has a different home resource.
- Resources aren't spent. Production is a per-turn capacity: what you produce is available to you on every turn. A card that shows "A / B" produces one of the two each turn, your choice.
- **Trading:** you may buy a resource from a neighbor (left or right player) for 2 coins per unit. The coins go to that neighbor, who can't refuse and doesn't lose anything. You can buy what comes from any of their cards (Trade cards included) and their academy's home resource, but not from tower stages. Trade cards lower the price to 1 coin for some resources or one side.
- Coins: everyone starts with 3.

### 5.4 Card families (each family has a color)
Each family also has its own glyph and short label on every card, so colour is never the only cue. Seven families with the same roles and the same per-Term logic as the genre standard, in our own colors (user's request):

| Family | Color | Role | Terms |
|---|---|---|---|
| Basic resources | brown | Produce basic resources (1 type, or "A / B"; doubles in Term II) | I, II |
| Rare resources | silver-white | Produce rare resources | I, II |
| Lore | blue | Straight Renown | I, II, III |
| Trade | yellow | Coins, cheaper trading, flexible production; in Term III coins plus end-game Renown | I, II, III |
| Dueling | red | Duel power, which carries over between Terms | I, II, III |
| Research | green | Symbols in three disciplines: Alchemy, Astronomy, Runes | I, II, III |
| Patrons | purple | Term III only, drawn at random. End-game scoring based on your academy and your neighbors' | III |

### 5.5 Duels
At the end of each Term, compare your total duel power with each neighbor separately. Duel power carries over from Term to Term.
- Win: gain 1 / 3 / 5 Renown in Terms I / II / III.
- Lose: lose 1 Renown.
- Tie: nothing.

### 5.6 Research scoring
Kept simple, with our own values:
- 2 Renown per Research symbol.
- Plus 6 Renown for each full set of all three disciplines.
- Plus 5 Renown for each discipline where you have 3 or more symbols.

The exact values may move during balancing (5.11).

### 5.7 Academies and towers
Seven academies, each with a home resource and a 3-stage tower. Every stage costs resources and gives Renown and/or a unique power. Each academy also has an alternate "B side" tower with different powers, picked at setup.

| Academy | Home resource |
|---|---|
| Pyromancy | Ore |
| Hydromancy | Moonstone |
| Verdant Circle | Herbs |
| Shadow Conservatory | Ink |
| Astral Observatory | Starglass |
| Chronomancy | Essence |
| Runeforge | Dragonscale |

Tower powers must be our own and must not mirror any 7 Wonders board power. That means none of these: building from the discard pile, one free building per age, playing the 7th card, a free science symbol, copying a neighbor's guild, or flat 1-coin trading on everything.

Example middle-stage powers (A side):
- **Pyromancy:** each duel you win gives +1 extra Renown.
- **Hydromancy:** whenever a neighbor buys a resource from you, take 1 extra coin from the bank.
- **Verdant Circle:** at game end, +1 Renown per white card you own.
- **Shadow Conservatory:** when this stage is built, take 2 coins from each neighbor (as many as they have).
- **Astral Observatory:** each full Research set scores +3 extra.
- **Chronomancy:** once per game, keep one card from your hand into the next Term and play it there as an extra turn.
- **Runeforge:** each time you build a card for free through a chain, gain 2 coins.

### 5.8 Final scoring (Renown)
1. Duel results
2. Coins: 1 Renown per 3 coins
3. Tower stages
4. Lore cards
5. Trade cards (Term III ones score)
6. Research
7. Patrons

Ties are broken by most coins, then shared.

### 5.9 Player-count scaling
Each card carries a minimum player count (3+ to 7+). The deck for a Term uses the cards whose minimum is at or below the number of seats, so every player gets exactly 7 cards. Term III also adds a random set of Patrons equal to players + 2.

### 5.10 Two-player mode: the Rival Archmage
The table seats 3: the two players plus the **Rival Archmage**, a rules-driven seat between them. The Archmage drafts, builds, trades and duels like a player. Its picks follow a fixed, public priority:
1. A Dueling card if it is behind either neighbor in duel power.
2. Otherwise, the most expensive card it can afford.
3. Otherwise, sell.

The Archmage's Renown is scored and shown, but it can't win and can't make anyone lose. It's there so that each player has two neighbors to trade with and duel, and it takes cards out of the draft. The higher-scoring of the two players wins.

### 5.11 Card list
The full card list (≈ 150 cards across three Terms plus Patrons). Every card is original: its own name, cost, effect and value, not a renamed copy of another game's card. is written as a data file with the families, costs, chains and player-count tags above. It's then tuned by running thousands of bot-vs-bot games to check balance, so that no family or academy wins much more than its share. The user reviews the card list before v1 is called done.

## 6. The app

### 6.1 Screens
1. **Home:** create game, join with code, play solo vs bots, tutorial, rules, settings.
2. **Lobby:**
   - The room code and a share-link button.
   - The seats, each showing a name, an avatar, and whether it's a person or a bot (easy / normal / hard).
   - Academy choice (pick or random, side A/B).
   - The host starts the game.
3. **Game (main screen, portrait), as shown in the mockup:**
   - Header: Term, turn, coins.
   - The neighbors left and right with their scores. Tap to inspect their academy.
   - Your resources, your built cards, tower progress and duel power.
   - Your hand as cards you can swipe. Tap a card for details.
   - Action buttons: Build / Tower / Sell. Each card shows whether it is affordable, free by chain, or needs trading, and what trading costs. Trades are auto-planned with the cheapest option and can be edited.
   - "Waiting for…" status.
4. **Term end:** an animated duel result.
5. **Game end:** a score breakdown per category per player, the winner, rematch.
6. **Rules and tutorial:** a guided first game against bots with prompts.
7. **Settings:** name, avatar, sound, music, haptics, animation speed, language (English first, structure ready for translation).

### 6.2 Feel
- Smooth card animations: pick, reveal, pass. The waiting time between turns should feel short and alive.
- Haptics on picks and wins (native build).
- Original illustrated art for cards, academies and towers. In v1 these are clear icons and colored frames, then replaced with final art in v2. Art source (commissioned, AI-generated, or the user's own) is left open until v2.
- Light theme first. Dark mode in v2.

## 7. Technical design

### 7.1 Parts
1. **`engine`:** a pure TypeScript game rules library.
   - Deterministic, with a seeded random generator.
   - No network or user-interface code.
   - Takes a state and an action and returns a new state, or rejects the action as illegal.
   - Gives each player a filtered view of the state with hidden hands removed.
   - The bots live here too, with easy, normal and hard levels.
   - Heavily unit-tested.
2. **`server`:** Node with WebSocket rooms (Colyseus or plain `ws`, builder's choice).
   - Holds the authoritative state per room.
   - Validates every action through `engine`.
   - Sends each player only their own view.
   - Runs the bots.
   - Supports rejoin by a per-seat token kept on the phone.
   - Rooms expire after inactivity.
   - Deployable to a free or cheap host (Fly.io, Render or similar).
3. **`client`:** a React + Vite single-page app, installable as a PWA, and packaged later with Capacitor for iOS and Android.
4. **`sim`:** a command-line bot-vs-bot simulator for balancing.

### 7.2 Rules for correctness
- The server is the only authority. Clients only send intentions ("build card X, buy Ink from left").
- Turn resolution is simultaneous. A turn resolves when all seats have locked a pick. An optional turn timer auto-picks for absent players (host setting).
- If a person disconnects: the game waits a configurable time, then a bot takes over the seat until they rejoin.

### 7.3 Release stages
- **v1:** complete rules for 2–7 players, bots, lobby and codes, rejoin, the core screens, placeholder art, deployed to the web for the user and friends to test.
- **v2:** polish: final art, sound, animations, tutorial, dark mode, balance pass.
- **v3:** Capacitor native builds, app icons, splash screens, privacy policy, store listings, TestFlight and Play internal testing.

## 8. What's left to the builder
- Exact card list, numbers and balance (constrained by section 5, verified by simulation and user review).
- Library choices inside the stack (Colyseus vs `ws`, state management, animation library).
- Hosting provider.
- Bot strategy details per difficulty.
- Visual design details within the mockup direction (purple accent, card families colored as in 5.4).
