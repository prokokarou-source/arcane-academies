/**
 * The new menu's wire types. They used to be a local copy of the contract while the server was built in parallel;
 * now they come straight from '@arcane/protocol' (this file only keeps the names the screens import).
 */
import { DEFAULT_ROOM_CONFIG, type ClientMessage, type GameReveal, type RoomConfig as Config, type ServerMessage } from '@arcane/protocol';

export {
  continentOf,
  COUNTRY_CONTINENT as COUNTRIES,
  divisionOf,
  QUEUES,
  START_RATING,
} from '@arcane/protocol';
export type {
  Continent,
  Division,
  GameKind,
  LeaderRow,
  LobbyState,
  OpenRoom,
  Profile,
  Queue,
  RoomConfig,
  Scope,
  Side,
  SideMode,
} from '@arcane/protocol';

export type Reveal = GameReveal;
export type AnyClientMessage = ClientMessage;
export type AnyServerMessage = ServerMessage;
export type GameMsg = Extract<ServerMessage, { t: 'game' }>;

/** What the Create Room screen starts from: a small public table (the server's own default is 7 private seats). */
export const DEFAULT_ROOM: Config = { ...DEFAULT_ROOM_CONFIG, seats: 4, public: true };
