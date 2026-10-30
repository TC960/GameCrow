/**
 * Public types for Badam Satti / Sevens (shared by rules.ts, ui.tsx and tests).
 * Everything here is safe to ship to clients: types, constants and pure helpers only.
 */
import type { Card, PlayerId, Rank, Suit } from "../../engine";

/** House rules (resolved by the engine before setup). */
export type Settings = {
  /** The very first card of each round must be the 7♥ (else the 7♥ holder may open with any 7). Default true. */
  firstCard7H: boolean;
  /** Ace ranks above the King (suits run 2 … 7 … A). Default false: Ace is below the 2 (A … 7 … K). */
  aceHigh: boolean;
  /** You may pass even when you have a playable card (the opening card of a round is still forced). Default false. */
  allowPassWhenAble: boolean;
  /** Keep playing after the first player goes out, until only one player still has cards. Default false. */
  playToEnd: boolean;
  /** Number of rounds (1–10). Default 1. */
  rounds: number;
};

/**
 * "play": someone's turn. "roundOver": a round finished and more rounds remain (the host starts the next one).
 * "over": the last round finished.
 */
export type Phase = "play" | "roundOver" | "over";

/** Played range of one suit: lowest and highest rank on the table (both null while the 7 is not out). */
export type SuitRange = { low: Rank; high: Rank } | null;

/** One line of the public play log. */
export type LogEntry = {
  /** Increasing number within the round (stable React key). */
  n: number;
  playerId: PlayerId;
  kind: "play" | "pass";
  /** The card played (null for a pass). */
  card: Card | null;
  /** Finishing place if this play emptied the player's hand, else null. */
  wentOut: number | null;
};

/** Result of one finished round. */
export type RoundResult = {
  round: number;
  /** Players who emptied their hand, in order (first = round winner). */
  finishOrder: PlayerId[];
  /** Place in this round (1 = best; ties share a place). */
  places: Record<PlayerId, number>;
  /** Cards each player still held when the round ended (counts only). */
  cardsLeft: Record<PlayerId, number>;
  /**
   * Penalty points scored this round (lower is better):
   * playToEnd off: cards left in hand; playToEnd on: place − 1 (winner 0, last n − 1).
   */
  penalty: Record<PlayerId, number>;
};

/** Server-only full state. */
export interface State {
  /** Seat order (clockwise). */
  order: PlayerId[];
  /** Secret hands. */
  hands: Record<PlayerId, Card[]>;
  board: Record<Suit, SuitRange>;
  phase: Phase;
  /** 1-based round number. */
  round: number;
  /** Whose turn it is (null outside "play"). */
  turn: PlayerId | null;
  /** Holder of the 7♥ who started this round. */
  starter: PlayerId;
  /** Cards played so far this round (0 = the opening card is still due). */
  playedCount: number;
  /** Players who emptied their hand this round, in order. */
  finishOrder: PlayerId[];
  /** Whether each player's most recent turn this round was a pass. */
  passedLastTurn: Record<PlayerId, boolean>;
  /** Last LOG_LIMIT entries of this round, oldest first. */
  log: LogEntry[];
  /** Next log entry number. */
  logN: number;
  /** Total penalty points from finished rounds (lower is better). */
  totals: Record<PlayerId, number>;
  history: RoundResult[];
  settings: Settings;
}

export type Action =
  | { type: "play"; card: Card }
  | { type: "pass" }
  /** Host only, in phase "roundOver". */
  | { type: "nextRound" };

/** One suit row of the board, ready to render. */
export type SuitRow = {
  suit: Suit;
  /** True once the suit's 7 is on the table. */
  open: boolean;
  /** Lowest / highest rank on the table (null while closed). */
  low: Rank | null;
  high: Rank | null;
  /** Every rank on the table for this suit, lowest first (empty while closed). */
  played: Rank[];
  /** The rank that may be played next below / above (null when that end is complete). While closed, both are null. */
  nextDown: Rank | null;
  nextUp: Rank | null;
  /** All 13 cards of the suit are on the table. */
  complete: boolean;
};

/**
 * Public rule flags (a copy of the house rules). Named differently from Settings on purpose: the
 * setting key "firstCard7H" contains the card code "7H", which would trip findLeaks() on views.
 */
export type PublicRules = {
  openWithSevenOfHearts: boolean;
  aceHigh: boolean;
  allowPassWhenAble: boolean;
  playToEnd: boolean;
  rounds: number;
};

export interface View {
  phase: Phase;
  round: number;
  totalRounds: number;
  rules: PublicRules;
  /** Seat order. */
  order: PlayerId[];
  /** Whose turn it is (null outside "play"). */
  turn: PlayerId | null;
  /** Who started this round (the 7♥ holder). */
  starter: PlayerId;
  /** True until the first card of the round has been played. */
  openingMove: boolean;
  /** The viewer's own hand (empty for spectators). */
  myHand: Card[];
  handCounts: Record<PlayerId, number>;
  /** Four suit rows in BOARD_SUIT_ORDER (♠ ♥ ♣ ♦). */
  board: SuitRow[];
  /** Recent plays and passes this round, oldest first (at most LOG_LIMIT). */
  log: LogEntry[];
  passedLastTurn: Record<PlayerId, boolean>;
  /** Players who have gone out this round, in order. */
  finishOrder: PlayerId[];
  /** Finished rounds, oldest first. */
  history: RoundResult[];
  /** Penalty totals of finished rounds (lower is better). Matches scores(). */
  totals: Record<PlayerId, number>;
}

// ---------------------------------------------------------------------------
// Constants and pure helpers (no secrets)
// ---------------------------------------------------------------------------

/** Display order of the board rows (alternating colours). */
export const BOARD_SUIT_ORDER: readonly Suit[] = ["S", "H", "C", "D"];

/** Max entries kept in the play log. */
export const LOG_LIMIT = 12;

/** Rank order of a suit row, lowest first: A 2 … K (default) or 2 … K A (aceHigh). */
export function rankLine(aceHigh: boolean): readonly Rank[] {
  return aceHigh
    ? ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
    : ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
}

/** The card that starts every round. */
export const START_CARD: Card = "7H";
