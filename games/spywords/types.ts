/** Public types for Spy Words (shared by rules.ts, ui.tsx and tests). See BRIEF.md. */
import type { PlayerId } from "../../engine";

export type Team = "sun" | "moon";
export const TEAMS: readonly Team[] = ["sun", "moon"];

/** What a tile is on the secret key. */
export type TileKind = Team | "neutral" | "trap";

export type Role = "handler" | "agent";

export type Phase = "clue" | "guess" | "gameEnd" | "over";

/** A vote in "vote" guess mode: a tile index (0..24) or "end" (end the turn). */
export type Vote = number | "end";

/** How a turn ended. */
export type TurnEnd =
  | "opponent" // revealed the other team's word
  | "neutral" // revealed a neutral word
  | "trap" // revealed a trap (team loses)
  | "limit" // used every allowed guess
  | "stop" // agents ended the turn
  | "complete" // revealed the team's last word (team wins)
  | "timeout" // timer ran out
  | "skip"; // host skipped

export type Clue = { word: string; count: number };

export type TurnRecord = {
  team: Team;
  /** null when the clue phase was skipped or timed out. */
  clue: Clue | null;
  /** Tile indices revealed this turn, in order. */
  guesses: number[];
  /** null while the turn is in progress. */
  end: TurnEnd | null;
};

export type GameResult = {
  game: number;
  winner: Team;
  /** "words": winner's words all revealed; "trap": the loser revealed a trap. */
  reason: "words" | "trap";
};

export type Settings = {
  games: number; // 1..9, default 1
  shuffleTeams: boolean; // default false
  starter: string; // "alternate" | "random"
  guessMode: string; // "first" | "vote"
  extraGuess: boolean; // default true
  allowZero: boolean; // default false
  strictClues: boolean; // default true
  trapCount: number; // 1..3, default 1
  clueTimer: number; // seconds, 0 = off
  guessTimer: number; // seconds, 0 = off
};

export interface State {
  /** Player ids in seat order. */
  order: PlayerId[];
  teams: Record<PlayerId, Team>;
  /** Each team's players in seat order. */
  members: Record<Team, PlayerId[]>;
  /** Handler rotation offset per team (Handler of game g = members[t][(offset + g - 1) % size]). */
  handlerOffset: Record<Team, number>;
  handlers: Record<Team, PlayerId>;
  /** 1-based game number. */
  game: number;
  phase: Phase;
  startingTeam: Team;
  turn: Team;
  /** 25 board words, row-major. */
  words: string[];
  /** SECRET: kind of each tile. */
  key: TileKind[];
  revealed: boolean[];
  clue: Clue | null;
  /** Guesses allowed this turn (25 = unlimited). 0 outside the guess phase. */
  maxGuesses: number;
  guessesMade: number;
  /** Vote mode: current round's votes (only agents who voted appear). */
  votes: Record<PlayerId, Vote>;
  noAgreement: boolean;
  /** Turns of the current game. */
  history: TurnRecord[];
  /** One entry per finished game. */
  results: GameResult[];
  wins: Record<Team, number>;
  /** Words used by earlier games of this match (not drawn again). */
  usedWords: string[];
  /** Epoch ms for the current phase's timer, or null. */
  deadlineAt: number | null;
  settings: Settings;
}

export type Action =
  | { type: "clue"; word: string; count: number }
  | { type: "guess"; tile: number }
  | { type: "endTurn" }
  | { type: "skipTurn" }
  | { type: "nextGame" }
  | { type: "@timeout" };

export type Tile = {
  word: string;
  revealed: boolean;
  /** The tile's kind once revealed; null while hidden (even for Handlers: use view.key). */
  kind: TileKind | null;
};

export interface View {
  phase: Phase;
  game: number;
  totalGames: number;
  teams: Record<PlayerId, Team>;
  members: Record<Team, PlayerId[]>;
  handlers: Record<Team, PlayerId>;
  /** null for spectators. */
  myTeam: Team | null;
  myRole: Role | null;
  turn: Team;
  startingTeam: Team;
  tiles: Tile[];
  /** Full key: Handlers during play; everyone once the game has ended. Otherwise null. */
  key: TileKind[] | null;
  /** Unrevealed words left per team. */
  remaining: Record<Team, number>;
  /** Words each team owns this game (9 / 8). */
  totals: Record<Team, number>;
  clue: Clue | null;
  /** Guesses left this turn (null outside the guess phase). */
  guessesLeft: number | null;
  /** True when the clue number was 0 (unlimited guesses). */
  unlimited: boolean;
  guessesMade: number;
  votes: Record<PlayerId, Vote>;
  noAgreement: boolean;
  history: TurnRecord[];
  results: GameResult[];
  lastResult: GameResult | null;
  wins: Record<Team, number>;
  settings: Settings;
}

export const BOARD_SIZE = 25;
export const UNLIMITED_GUESSES = 25;
export const MAX_CLUE_COUNT = 9;
export const MAX_CLUE_LENGTH = 24;

export const TEAM_LABEL: Record<Team, string> = { sun: "Sun", moon: "Moon" };
export const KIND_ICON: Record<TileKind, string> = { sun: "☀", moon: "☾", neutral: "·", trap: "✖" };
