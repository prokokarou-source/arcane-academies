# Sounds, music and haptics — design

## Intent
The user wants Arcane Academies to feel like a complete game: feedback on every important moment,
atmosphere in duels, and background music. Today the Settings have Sound and Haptics toggles that do nothing.

## Goals
- Sound effects for: card select, Build / Tower / Sell, new turn (your hand arrives), timer running out,
  term-end duels (clash, win, loss), game end (winner fanfare / other placings jingle),
  lobby (player joins, game starts), menu button taps.
- One calm magical/medieval music loop on Home and in the game, low volume, fades on screen change.
- Settings: `Sound` splits into **Music** and **Sound effects**; **Haptics** works (Android `navigator.vibrate`).
  All on by default; music quiet.
- Works offline in the installed app (sounds are precached by the service worker).

## Non-goals
AI-generated audio, voice, per-academy music (later; the files are swappable).

## Anti-goals
- Never play sound before the first user gesture (iOS blocks it) or after the app is hidden.
- Never block or slow game input on audio loading.
- No unlicensed audio: only CC0 sources, each listed in `public/sounds/CREDITS.md`.

## Approaches
1. **CC0 recorded packs (Kenney, OpenGameArt)** — real sounds, free, store-safe, not unique. **Chosen.**
2. Code-synthesised Web Audio — original and tiny but sounds retro-electronic; poor for music.
3. AI-generated audio — unique, costs credits; planned later as drop-in file replacements.

## Design
- `src/audio/sounds.ts`: a `SoundBoard` with `play(name)`, `music(on)`, `unlock()`, `setPrefs()`, using
  `HTMLAudioElement`s (simple, works on iOS after a gesture) behind a small injectable backend for tests.
  Pauses music on `visibilitychange` hidden.
- `src/audio/cues.ts`: pure function deriving cue names from (previous state, next state) of the client
  (new turn, term-end duels appear, game ended, lobby seat count grew, game started).
- A React hook in App wires state changes to cues; buttons call `play` directly for taps and actions.
- Haptics: `vibrate(pattern)` in the same module, gated by the Haptics pref.
- Prefs: `sound` becomes `sfx`, new `music` (old `sound:false` maps to both off).
- Files: `public/sounds/*.mp3` (short, small), `music.mp3` loop; Workbox globs include `mp3`.

## Left to the builder
Exact files chosen from the packs, volumes, the timer warning threshold (proposal: last 5 s).
