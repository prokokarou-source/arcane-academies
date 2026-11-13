# Arcane Academies — Plan 1: Rules Engine, Bots and Simulator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pure, deterministic TypeScript rules engine for Arcane Academies (2–7 players), with the original card data, bots and a bot-vs-bot balance simulator.

**Architecture:** An npm-workspaces monorepo.
- `packages/engine` is a pure library: game state in, action in, new state out, with a seeded random generator. It has no I/O, network or UI code.
- `packages/sim` is a command-line tool that plays bot games through the engine and reports balance stats.

The server (Plan 2), the client (Plan 3) and store packaging (Plan 4) are later plans that consume this engine.

**Tech Stack:** Node 20+, TypeScript 5 (strict), Vitest, tsx (for the sim CLI).

**Spec:** `docs/superpowers/specs/2026-11-13-arcane-academies-design.md`

## Global Constraints

- **All names must be original.** Card, academy, patron and resource names must not reuse 7 Wonders names. No "Lumber Yard", "Glassworks", "Guild", "Wonder", "Age" and so on. Use the spec's terms: Term, Renown, Archive, Patron, academy, tower.
- **Resources:** Basic = `herbs`, `ore`, `ink`, `moonstone`. Rare = `essence`, `starglass`, `dragonscale`.
- **Start of game:** 3 coins and 1 home resource per academy.
- **Selling** a card gives 3 coins.
- **Trading:** 2 coins per unit from a neighbor, and 1 coin with a matching discount.
  - You can only buy from the neighbor's Basic and Rare resource cards and their academy's home resource.
  - You can't buy from Trade cards or tower stages.
- **Term structure:**
  - The hand is 7 cards. 6 are played, and the 7th goes to the Archive with no coins.
  - Passing direction: Term I left, Term II right, Term III left.
- **Duels:** win +1 / +3 / +5 Renown (Terms I / II / III), loss −1, tie 0. Duel power is cumulative.
- **Research:** 2 Renown per symbol, +6 per full set of the three disciplines, and +5 per discipline with at least 3 symbols.
- **Coins:** 1 Renown per 3 coins at game end. Ties are broken by most coins, then shared.
- **No duplicates:** a player can't own two cards with the same name.
- **2 players:** add a Rival Archmage seat between the two players (3 seats). The Archmage can never win.
- **Determinism:** the same seed and the same actions always give identical states. The engine never calls `Math.random` or `Date`.
- **State is immutable:** every engine function returns new objects and never mutates its input.

## Review Focus

1. A card whose cost can be paid in several ways (choice cards like "herbs/ore", or buying from either side). The engine must find the cheapest legal payment, and it must accept every affordable card. Tested in Task 4.
2. A player who has too few coins to trade, or whose neighbor doesn't produce the resource. The card must show as unaffordable and must not be buildable. Tested in Task 4.
3. Two players paying each other in the same turn. All coin transfers happen after every pick of that turn resolves, so a coin received this turn can't fund a purchase this turn. Tested in Task 5.
4. The hidden-information filter. A player's view must not contain any other seat's hand, even nested inside the state. Tested in Task 7.
5. Player counts 2, 3 and 7 at the edges. Every term must deal exactly 7 cards per seat, and the game must always reach its end. Tested in Tasks 3 and 9.

---

## File structure

```
package.json                     workspaces root, scripts: test, sim
tsconfig.base.json
packages/engine/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                   public exports
  src/types.ts                   all shared types
  src/rng.ts                     seeded random generator + shuffle
  src/data/cards.ts              Term I/II/III cards + patrons (original)
  src/data/academies.ts          7 academies, towers A and B
  src/setup.ts                   createGame, deal
  src/payment.ts                 production, cheapest payment plan
  src/actions.ts                 legalActions, submitAction, resolveTurn
  src/duels.ts                   end-of-term duels
  src/scoring.ts                 research + final scoring
  src/powers.ts                  academy tower powers hooks
  src/view.ts                    per-seat filtered view
  src/bots/archmage.ts           Rival Archmage rule bot
  src/bots/bot.ts                easy / normal / hard bots
  test/*.test.ts
packages/sim/
  package.json
  src/cli.ts                     run N games, print stats
```

---

### Task 1: Monorepo scaffold, core types and random generator

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `packages/engine/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/engine/src/types.ts`, `packages/engine/src/rng.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  - `type BasicResource = 'herbs'|'ore'|'ink'|'moonstone'`
  - `type RareResource = 'essence'|'starglass'|'dragonscale'`
  - `type Resource = BasicResource|RareResource`
  - `type Family = 'basic'|'rare'|'lore'|'trade'|'duel'|'research'|'patron'`. Display colors: white, black, gold, turquoise, orange, magenta, silver.
  - `type Discipline = 'alchemy'|'astronomy'|'runes'`
  - `type Term = 1|2|3`
  - `type Cost = { coins?: number; resources?: Partial<Record<Resource, number>> }`
  - `type Effect`, a union of:
    - `{kind:'produce'; options: Resource[]; amount: number}`. Options with 2 entries mean "A / B".
    - `{kind:'renown'; amount}`
    - `{kind:'duel'; amount}`
    - `{kind:'research'; discipline}`
    - `{kind:'coins'; amount}`
    - `{kind:'tradeDiscount'; group:'basic'|'rare'; sides:('left'|'right')[]}`
    - `{kind:'coinsPer'; what: CountTarget; per: number; scope: 'self'|'selfAndNeighbors'}`
    - `{kind:'renownPer'; what: CountTarget; per: number; scope: 'self'|'neighbors'|'selfAndNeighbors'}`
  - `type CountTarget = Family | 'towerStage'`
  - `interface CardDef { id: string; name: string; term: Term; family: Family; cost: Cost; effects: Effect[]; chainFrom?: string[]; minPlayers: number[] }`. Here `minPlayers` has one entry per physical copy, for example `[3,5]`. `chainFrom` lists card names.
  - `interface Card { uid: string; defId: string }`, one physical copy.
  - `interface SeatConfig { kind:'human'|'bot'|'archmage'; name: string; academyId?: string; side?: 'A'|'B'; botLevel?: 'easy'|'normal'|'hard' }`
  - `interface PlayerState { seat: number; config: SeatConfig; academyId: string; side:'A'|'B'; coins: number; built: Card[]; towerStages: number; hand: Card[]; pending?: Action; flags: Record<string, number> }`
  - `interface GameState { seed: number; rngState: number; term: Term; turn: number; phase:'picking'|'ended'; players: PlayerState[]; archive: Card[]; log: LogEntry[]; duelTokens: number[][] }`. `duelTokens[seat]` holds that seat's Renown deltas.
  - `type Action`, a union of:
    - `{type:'build'; cardUid; payment: PaymentPlan}`
    - `{type:'tower'; cardUid; payment: PaymentPlan}`
    - `{type:'sell'; cardUid}`
    - `{type:'chronoKeep'; cardUid}`
  - `interface PaymentPlan { buyLeft: Partial<Record<Resource,number>>; buyRight: Partial<Record<Resource,number>>; coinsToLeft: number; coinsToRight: number; coinsToBank: number; free: boolean }`
  - `type LogEntry = { term: Term; turn: number; seat: number; text: string }`
- Produces (in `rng.ts`):
  - `nextRandom(state: number): [value: number, nextState: number]` (mulberry32)
  - `shuffle<T>(items: readonly T[], state: number): [T[], number]`

- [ ] **Step 1:** Run `git init`, create the workspace files, and install `typescript vitest tsx` as root dev dependencies. Root `package.json` scripts: `"test": "vitest run --root packages/engine"`, `"sim": "tsx packages/sim/src/cli.ts"`.
- [ ] **Step 2: Write the failing tests** in `rng.test.ts`:
  - `shuffle is deterministic`: `shuffle([1..10], 42)` called twice gives deep-equal arrays and equal next states.
  - `shuffle is a permutation`: the sorted result equals the input.
  - `different seeds differ`: `shuffle([1..10], 1)[0]` doesn't equal `shuffle([1..10], 2)[0]`.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (module not found).
- [ ] **Step 4:** Write `types.ts` and implement `rng.ts` (mulberry32 and Fisher–Yates using `nextRandom`).
- [ ] **Step 5:** Run `npm test`. Expected: 3 passing.
- [ ] **Step 6:** Commit `feat(engine): scaffold, core types, seeded rng`.

---

### Task 2: Original card data and academies

**Files:**
- Create: `packages/engine/src/data/cards.ts`, `packages/engine/src/data/academies.ts`
- Test: `packages/engine/test/data.test.ts`

**Interfaces:**
- Produces:
  - `CARDS: readonly CardDef[]` for Terms 1–3.
  - `PATRONS: readonly CardDef[]`: 10 cards, family `patron`, term 3, `minPlayers: [3]`.
  - `ACADEMIES: readonly AcademyDef[]`, where `AcademyDef = { id; name; home: Resource; sides: Record<'A'|'B', TowerStage[]> }` and `TowerStage = { cost: Cost; effects: Effect[]; power?: PowerId }`.
  - `type PowerId = 'pyroDuelBonus'|'hydroTradeBonus'|'verdantWhiteRenown'|'shadowTax'|'astralSetBonus'|'chronoKeep'|'runeChainCoins'`

**Deck composition.** Count physical copies, meaning entries in `minPlayers`.
- **Term I:**
  - Copies with min ≤ n must total exactly 7n for n = 3..7: 21, 28, 35, 42, 49.
  - Families at 7 players: basic 13, rare 7, lore 8, trade 8, duel 6, research 7.
- **Term II:**
  - Same totals per n as Term I.
  - Families at 7 players: basic 8 (all double producers, `amount: 2`), rare 7, lore 8, trade 9, duel 9, research 8.
- **Term III:**
  - Non-patron copies with min ≤ n must total 6n − 2: 16, 22, 28, 34, 40.
  - Families: lore 10, trade 10, duel 10, research 10. No basic or rare cards.
  - At setup, n + 2 patrons are drawn, so the term deals 7n cards.
- **Values:**
  - Lore Renown: Term I 2–3, Term II 3–5, Term III 5–8.
  - Duel power: Term I 1, Term II 2, Term III 3.
  - Term I cards cost 0–1 resources or 1 coin. Term II cards cost 2–3, Term III cards cost 3–5.
  - Rare resources appear in costs from Term II on.
  - Every research card has one discipline. Each discipline gets at least 2 copies per term.
  - At least 8 chains from Term I to II and 6 from Term II to III.
- **Patrons:** 10 original end-game scoring cards, each built from `renownPer` effects over various `CountTarget`s and scopes. None may copy a 7 Wonders guild one to one, so vary the targets, multipliers and combinations.
- **Academies:** names, home resources and A-side middle-stage powers exactly as in spec §5.7.
  - Each side has 3 stages. Stage 1 gives Renown 3. Stage 2 gives the side's power. Stage 3 gives Renown 7.
  - B sides use the same `PowerId`s on different stages with different Renown. Each academy has 2 or 3 stages on its B side.
  - Stage costs: 2 resources, then 3, then 4, mixing basic and rare resources.
- **Names:** all card and patron names are original, arcane-themed and unique, for example "Mandrake Bed", "Scrying Pool" or "Wand Workshop".

- [ ] **Step 1: Write the failing tests** in `data.test.ts`:
  - `term totals`: for n in 3..7, the sum of copies with min ≤ n in Term I equals 7n, in Term II equals 7n, and in Term III non-patrons equals 6n − 2.
  - `family counts at 7 players` match the table above.
  - `unique ids and names`: no duplicate `id`s or `name`s across `CARDS` and `PATRONS`.
  - `chains resolve`: every `chainFrom` name exists in an earlier term.
  - `no basic or rare in Term III`.
  - `forbidden names`: no name, lowercased, contains any of `["lumber","quarry","glass","loom","press","guild","wonder","pantheon","aqueduct","scriptorium","apothecary","stockade","barracks","caravansery","forum","bazar","lighthouse","arena"]`.
  - `academies`: 7 academies with distinct home resources, the ids and homes listed in §5.7, and every A side's stage 2 has its `power`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Author `cards.ts` and `academies.ts` to the composition above.
- [ ] **Step 4:** Run `npm test`. Expected: all data tests pass.
- [ ] **Step 5:** Commit `feat(engine): original card and academy data`.

---

### Task 3: Game setup and dealing (including 2-player Archmage)

**Files:**
- Create: `packages/engine/src/setup.ts`
- Test: `packages/engine/test/setup.test.ts`

**Interfaces:**
- Consumes: the Task 1 types, `shuffle`, and `CARDS`, `PATRONS`, `ACADEMIES`.
- Produces:
  - `createGame(opts: { seed: number; seats: SeatConfig[] }): GameState`. Valid lengths for `seats` are 2–7 humans or bots. With length 2, it inserts an `archmage` seat at index 1.
  - `dealTerm(state: GameState, term: Term): GameState`

- [ ] **Step 1: Write the failing tests:**
  - `deals 7 cards per seat` for 2, 3 and 7 players in every term. Advance terms with `dealTerm` directly.
  - `two players get an archmage at seat 1`: `players.length === 3` and `players[1].config.kind === 'archmage'`.
  - `start state`: every player has 3 coins, distinct academies (random when unset), and `term === 1`, `turn === 1`.
  - `deterministic`: the same seed gives a deep-equal state.
  - `term 3 includes n+2 patrons` for n seats, counting the Archmage seat as a seat.
  - `rejects 1 or 8 seats` by throwing an `Error`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `createGame` and `dealTerm`. Card `uid` is `${defId}#${copyIndex}`. Deal by shuffling the eligible copies and splitting them into 7-card hands.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): game setup and dealing`.

---

### Task 4: Production and cheapest payment

**Files:**
- Create: `packages/engine/src/payment.ts`
- Test: `packages/engine/test/payment.test.ts`

**Interfaces:**
- Produces:
  - `productionOf(state, seat, forTrade: boolean): Effect[]` returns the produce effects from the home resource and from basic/rare cards. When `forTrade` is false, it also includes trade cards and tower stages.
  - `planPayment(state, seat, cost: Cost, cardName?: string): PaymentPlan | null` returns the cheapest plan in total coins spent, or `null` if no plan exists.
    - It returns `{free:true, ...zeros}` when the player owns a card listed in `chainFrom`. Callers pass the chain check by giving `cardName`.
  - `tradePrice(state, seat, side, resource): 1 | 2`

**Algorithm:**
1. Expand each choice producer of your own into a single pick.
2. Cover what you can from your own production.
3. For each remaining unit, buy from the left or right neighbor's trade-eligible production, minimizing total coins.
4. Do a DFS over the choice producers and assignments. The search is bounded because costs are 5 units or fewer and choice cards are few.
5. Ties prefer the left neighbor. A plan is valid only if total coins ≤ the player's coins.

- [ ] **Step 1: Write the failing tests:**
  - `own production covers cost`: the plan costs 0 coins.
  - `choice card used correctly`: a "herbs/ore" card can't pay herbs + ore alone.
  - `buys missing unit from neighbor for 2`.
  - `discount makes it 1`: with a turquoise discount on the left for basic resources, the left purchase costs 1.
  - `cannot buy from neighbor trade card production`.
  - `unaffordable returns null` when the player has 1 coin and needs a purchase.
  - `chain makes it free`.
  - `picks cheapest side`: the left price is 2 and the right is 1, so the plan buys right.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement as described.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): production and payment planning`.

---

### Task 5: Actions, simultaneous turn resolution and term flow

**Files:**
- Create: `packages/engine/src/actions.ts`, `packages/engine/src/duels.ts`, `packages/engine/src/powers.ts`
- Test: `packages/engine/test/actions.test.ts`, `packages/engine/test/duels.test.ts`

**Interfaces:**
- Produces:
  - `legalActions(state, seat): Action[]` returns every build, tower and sell option for each card in the hand, with the payment plans from `planPayment`. It excludes duplicate names. It adds `chronoKeep` when that power is available and unused.
  - `submitAction(state, seat, action): GameState` validates the action against `legalActions` (it throws `IllegalActionError` otherwise) and sets `pending`.
  - `allSubmitted(state): boolean`
  - `resolveTurn(state): GameState`
    1. Apply every pending action at once.
    2. After all actions, transfer the trade coins and pay the bank.
    3. Apply immediate `coins`/`coinsPer` effects.
    4. Pass the hands in the term's direction.
    5. After turn 6, archive the remaining card, run the duels, and then either deal the next term or end the game.
  - `resolveDuels(state, term): GameState`
  - `export class IllegalActionError extends Error`
  - In `powers.ts`: `applyPowerOnBuild(state, seat, power)`, `powerModifiers(state, seat)`

- [ ] **Step 1: Write the failing tests:**
  - `sell gives 3 coins and archives the card`.
  - `build moves the card to built and pays the neighbor`: the neighbor gains 2 only after `resolveTurn`.
  - `coins received this turn cannot fund this turn`: covered by both players submitting purchases that each depend on the other's payment. Each player's plan is validated against their coins at the start of the turn.
  - `duplicate name not offered`.
  - `tower stage increments towerStages, applies effects, and the card is hidden`. Tower cards are not in `built`.
  - `hands pass left in Term 1 and right in Term 2`: check the uids after one turn.
  - `after turn 6 the 7th card goes to the archive and the next term deals`.
  - `illegal action throws IllegalActionError`.
  - Duels:
    - `win +1/+3/+5, loss −1, tie 0` against each neighbor separately.
    - `duel power is cumulative across terms`.
    - `pyroDuelBonus adds +1 per win`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Powers follow §5.7 exactly:
  - `chronoKeep`: once per game, the kept card goes into `flags`. At the start of the next term that player gets one extra turn, played before turn 1 of that term, with only the kept card.
  - `shadowTax`: takes `min(2, coins)` from each neighbor when the stage is built.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): actions, turn resolution, duels, powers`.

---

### Task 6: Scoring

**Files:**
- Create: `packages/engine/src/scoring.ts`
- Test: `packages/engine/test/scoring.test.ts`

**Interfaces:**
- Produces:
  - `scoreResearch(counts: Record<Discipline, number>, astralBonus: boolean): number`
  - `type ScoreBreakdown = { seat; duels; coins; tower; lore; trade; research; patrons; total }`
  - `finalScores(state): ScoreBreakdown[]`
  - `winners(state): number[]`. It excludes the Archmage, breaks ties by coins, and returns several seats if they're still tied.

- [ ] **Step 1: Write the failing tests:**
  - `research`:
    - `{alchemy:3, astronomy:2, runes:1}` scores 2·6 + 6·1 + 5·1 = 23.
    - `{3,3,3}` scores 18 + 18 + 15 = 51.
    - `{0,0,0}` scores 0.
    - With the astral bonus, `{1,1,1}` scores 6 + 6 + 3 = 15.
  - `coins`: 8 coins give 2.
  - `renownPer` with scope `neighbors` counts only the neighbors' cards.
  - `archmage never wins` even with the highest total.
  - `tie broken by coins`, and `full tie shared`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): scoring`.

---

### Task 7: Per-seat view (hidden information)

**Files:**
- Create: `packages/engine/src/view.ts`
- Test: `packages/engine/test/view.test.ts`

**Interfaces:**
- Produces:
  - `type PlayerView = Omit<GameState,'players'|'rngState'|'seed'> & { me: number; players: (Omit<PlayerState,'hand'|'pending'> & { handSize: number; hasSubmitted: boolean; hand?: Card[] })[] }`. `hand` is present only for `me`.
  - `viewFor(state, seat): PlayerView`

- [ ] **Step 1: Write the failing tests:**
  - `own hand visible`.
  - `other hands absent`: `JSON.stringify(viewFor(s, 0))` contains no `uid` from any other seat's hand.
  - `no seed or rngState`.
  - `pending hidden, hasSubmitted shown`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): per-seat views`.

---

### Task 8: Bots (Archmage and easy / normal / hard)

**Files:**
- Create: `packages/engine/src/bots/archmage.ts`, `packages/engine/src/bots/bot.ts`
- Test: `packages/engine/test/bots.test.ts`

**Interfaces:**
- Produces:
  - `archmagePick(state, seat): Action`, following spec §5.10:
    1. A duel card if its duel power is below either neighbor's.
    2. Otherwise, the affordable card with the highest total cost (resource units plus coins), with ties broken by lowest `uid`.
    3. Otherwise, sell the first card.
  - `botPick(state, seat, level): Action`:
    - `easy`: a random legal action from the state's random generator, with builds weighted 3× over sells.
    - `normal`: greedy on immediate value: Renown, plus 1.5 × duel delta versus neighbors, plus research marginal value, plus 0.5 × production units, minus coins spent / 3.
    - `hard`: `normal` plus a lookahead of the next hand. It values denying a strong card to the receiving neighbor and towers by stage value.
  - `autoPlay(state): GameState` submits a pick for every non-human seat.

- [ ] **Step 1: Write the failing tests:**
  - `archmage takes duel card when behind`.
  - `archmage takes most expensive affordable card otherwise`.
  - `archmage sells when nothing is affordable`.
  - `every bot level always returns a legal action` over 50 random states.
  - `bots are deterministic for the same state`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(engine): archmage and bots`.

---

### Task 9: Full-game integration, public API, and balance simulator

**Files:**
- Create: `packages/engine/src/index.ts`, `packages/sim/package.json`, `packages/sim/src/cli.ts`
- Test: `packages/engine/test/fullgame.test.ts`

**Interfaces:**
- Produces:
  - `index.ts` exports every public function and type from Tasks 1–8.
  - CLI: `npm run sim -- --games 2000 --players 4 --level normal --seed 1` prints:
    - win rate per academy
    - average score per category
    - average total
    - the share of winners whose top category was each family

- [ ] **Step 1: Write the failing tests** in `fullgame.test.ts`:
  - `bot-only games always end` for 2, 3, 5 and 7 players over 20 seeds each. Each game reaches `phase === 'ended'` within 3 × 7 turns (plus one possible chronoKeep turn) and gives a non-empty `winners`.
  - `card conservation`: at game end, every dealt card is in exactly one of built, tower or archive.
  - `replay determinism`: replaying the recorded actions from the same seed gives a deep-equal final state.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `index.ts` and `cli.ts`, using `createGame`, `autoPlay`, `resolveTurn` and `finalScores`.
- [ ] **Step 4:** Run `npm test`. Expected: all tests pass.
- [ ] **Step 5:** Run `npm run sim -- --games 2000 --players 4 --level normal`. Expected:
  - no crash
  - every academy's win rate between 15% and 35% (expected value 25%)
  - no single category supplying more than 40% of the average winning total

  If the numbers fall outside those bounds, adjust the values in `cards.ts` or `academies.ts`, re-run until they're inside, and record the final numbers in the commit message.
- [ ] **Step 6:** Commit `feat: full game integration and balance simulator`.

---

## Later plans (not in this plan)
- **Plan 2:** game server (WebSocket rooms, room codes, rejoin tokens, bot takeover, turn timer).
- **Plan 3:** mobile client (lobby, game screen, card animations, tutorial, settings, i18n-ready strings).
- **Plan 4:** polish and store packaging (art, sound, Capacitor iOS/Android, store listings).
