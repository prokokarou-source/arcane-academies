/**
 * All UI text. English is complete; other languages are partial tables that fall back to English.
 * Placeholders look like {name}.
 */
export const en = {
  appName: 'Arcane Academies',
  tagline: 'Rival schools of magic. One phone each.',
  yourName: 'Your name',
  createGame: 'Create game',
  roomCode: 'Room code',
  join: 'Join',
  playSolo: 'Play solo',
  bots: 'Bots',
  level: 'Level',
  level_easy: 'Easy',
  level_normal: 'Normal',
  level_hard: 'Hard',
  rules: 'Rules',
  settings: 'Settings',
  back: 'Back',
  dismiss: 'Dismiss',
  reconnecting: 'Reconnecting…',
  connecting: 'Connecting…',
  notice_replaced: 'Your seat was opened on another device.',
  notice_expired: 'The room closed after a long time without activity.',
  notice_left: 'You left the room.',
  notice_removed: 'The host removed you from the room.',
  notice_rejoinFailed: 'Your last game is no longer available.',
  // lobby
  lobby: 'Lobby',
  shareLink: 'Share link',
  linkCopied: 'Link copied',
  you: 'You',
  host: 'Host',
  bot: 'Bot',
  offline: 'Offline',
  academy: 'Academy',
  random: 'Random',
  side: 'Side',
  addBot: 'Add bot',
  newBotLevel: 'New bot level',
  remove: 'Remove',
  graceLabel: 'Bot takes over after',
  turnTimer: 'Turn timer',
  off: 'Off',
  seconds: '{n} s',
  minutes: '{n} min',
  start: 'Start game',
  leave: 'Leave',
  waitingHost: 'Waiting for the host to start…',
  seatsNeeded: 'A game needs 2 to 7 seats.',
  // game
  term: 'Term {n}',
  turn: 'Turn {n}/6',
  coins: 'Coins',
  timeLeft: '{n} s left',
  duelPower: 'Duel power',
  research: 'Research',
  tower: 'Tower',
  built: 'Built',
  production: 'Production',
  table: 'Table',
  close: 'Close',
  left: 'Left',
  right: 'Right',
  archmage: 'Rival Archmage',
  build: 'Build',
  raiseTower: 'Tower',
  sell: 'Sell +3',
  keep: 'Keep',
  free: 'Free (chain)',
  buyFor: 'Buy for {n} coins',
  costsCoins: 'Costs {n} coins',
  affordable: 'Affordable',
  cantBuild: "Can't build",
  pickCard: 'Pick a card from your hand.',
  waitingFor: 'Waiting for {names}…',
  waitingBonus: 'Waiting for the bonus turn…',
  waitingOthers: 'Waiting for the others…',
  bonusTurn: 'Bonus turn: play your kept card.',
  noCards: 'No cards yet',
  stageOf: '{built}/{total}',
  // term end
  duelsTitle: 'Term {n} duels',
  win: 'Win',
  loss: 'Loss',
  tie: 'Tie',
  vs: 'vs {name}',
  continue: 'Continue',
  // game end
  gameOver: 'Game over',
  winnerIs: '{names} wins!',
  winnersAre: '{names} share the win!',
  cantWin: "can't win",
  cat_duels: 'Duels',
  cat_coins: 'Coins',
  cat_tower: 'Tower',
  cat_lore: 'Lore',
  cat_trade: 'Trade',
  cat_research: 'Research',
  cat_patrons: 'Patrons',
  cat_total: 'Total',
  rematch: 'Rematch',
  waitingRematch: 'Waiting for the host to start a rematch…',
  // settings
  language: 'Language',
  animations: 'Animations',
  sound: 'Sound',
  haptics: 'Haptics',
  saved: 'Saved',
  // rules
  rulesText:
    'Three Terms. Each Term you get 7 cards. Everyone picks one card at the same time, then passes the rest (left in Terms I and III, right in Term II).\n' +
    'With your pick you can Build it (pay its cost; free if you own its prerequisite), use it to raise a Tower stage, or Sell it for 3 coins.\n' +
    'Resources are not spent: what you produce is available every turn. Buy missing resources from your left or right neighbor for 2 coins each.\n' +
    'At the end of each Term you duel both neighbors: more duel power wins 1/3/5 Renown, less loses 1.\n' +
    'After Term III the most Renown wins. Ties go to the most coins.',
} as const;

export type StringKey = keyof typeof en;
export type Lang = 'en' | 'el';

/** Greek: structure only for now; the full translation comes later. */
export const el: Partial<Record<StringKey, string>> = {
  appName: 'Arcane Academies',
  createGame: 'Νέο παιχνίδι',
  join: 'Είσοδος',
  rules: 'Κανόνες',
  settings: 'Ρυθμίσεις',
  language: 'Γλώσσα',
  back: 'Πίσω',
};

const TABLES: Record<Lang, Partial<Record<StringKey, string>>> = { en, el };

export function translate(lang: Lang, key: StringKey, vars?: Record<string, string | number>): string {
  const text = TABLES[lang][key] ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
