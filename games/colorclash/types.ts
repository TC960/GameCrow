/** Public types and constants for Color Clash (shared by rules.ts, ui.tsx and tests). See BRIEF.md. */
import type { PlayerId } from "../../engine";

/** Colour ids (never hex; the UI maps them to colour-blind-safe colours + symbols). */
export type ColorId = "sun" | "sky" | "leaf" | "berry";
export type CardColor = ColorId | "wild";
export type NumberValue = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export type ActionValue = "freeze" | "flip" | "plus2";
export type WildValue = "rainbow" | "rainbow4";
export type CardValue = NumberValue | ActionValue | WildValue;

/** Unique id of one physical card: "<colour>:<value>:<copy>", e.g. "sun:5:1", "wild:rainbow4:3". */
export type CardId = string;

export const COLORS: readonly ColorId[] = ["sun", "sky", "leaf", "berry"];
export const COLOR_INFO: Record<ColorId, { name: string; symbol: string; shape: string }> = {
  sun: { name: "Sun", symbol: "●", shape: "circle" },
  sky: { name: "Sky", symbol: "■", shape: "square" },
  leaf: { name: "Leaf", symbol: "▲", shape: "triangle" },
  berry: { name: "Berry", symbol: "◆", shape: "diamond" },
};
export const NUMBER_VALUES: readonly NumberValue[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const ACTION_VALUES: readonly ActionValue[] = ["freeze", "flip", "plus2"];
export const WILD_VALUES: readonly WildValue[] = ["rainbow", "rainbow4"];
export const VALUE_ORDER: readonly CardValue[] = [...NUMBER_VALUES, ...ACTION_VALUES, ...WILD_VALUES];
export const VALUE_LABEL: Record<CardValue, string> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  freeze: "Freeze",
  flip: "Flip",
  plus2: "+2",
  rainbow: "Rainbow",
  rainbow4: "Rainbow +4",
};
/** Cards in one deck. */
export const DECK_SIZE = 108;

export type Settings = {
  scoring: "points" | "single";
  targetScore: number;
  handSize: number;
  decks: "auto" | "1" | "2";
  drawRule: "one" | "untilPlayable";
  mustPlay: boolean;
  stacking: "off" | "same" | "any";
  wild4Rule: "challenge" | "strict" | "free";
  sevenZero: boolean;
  jumpIn: boolean;
  twoPlayerFlip: boolean;
  clashRule: "penalty" | "off";
  clashPenalty: number;
  catchSeconds: number;
};

export type Phase = "play" | "drawn" | "respond" | "roundOver" | "over";

/** Public event log entry (colour/value only, never card ids). `n` increases by 1 per entry. */
export type LogEntry =
  | { n: number; kind: "play"; player: PlayerId; value: CardValue; cardColor: CardColor; color: ColorId; jumpIn: boolean }
  | { n: number; kind: "draw"; player: PlayerId; count: number; reason: "turn" | "plus" | "penalty" | "challenge" | "skip" }
  | { n: number; kind: "skip"; player: PlayerId }
  | { n: number; kind: "flip"; direction: 1 | -1 }
  | { n: number; kind: "pass"; player: PlayerId }
  | { n: number; kind: "clash"; player: PlayerId; late: boolean }
  | { n: number; kind: "caught"; player: PlayerId; target: PlayerId; count: number }
  | { n: number; kind: "challenge"; player: PlayerId; target: PlayerId; guilty: boolean }
  | { n: number; kind: "swap"; player: PlayerId; target: PlayerId }
  | { n: number; kind: "rotate"; direction: 1 | -1 }
  | { n: number; kind: "hostSkip"; player: PlayerId }
  | { n: number; kind: "reshuffle" }
  | { n: number; kind: "roundEnd"; winner: PlayerId; gained: number; blocked: boolean };

export interface RoundResult {
  round: number;
  winner: PlayerId;
  /** Points the winner scored this round (points mode; also filled in single mode). */
  gained: number;
  blocked: boolean;
  /** Card points left in each hand at the end of the round. */
  handPoints: Record<PlayerId, number>;
}

export interface State {
  order: PlayerId[];
  settings: Settings;
  /** Resolved number of decks (1 or 2). */
  deckCount: number;
  round: number;
  phase: Phase;
  hands: Record<PlayerId, CardId[]>;
  /** Secret. Index 0 is the top. */
  drawPile: CardId[];
  /** Last element is the top card. Never empty. */
  discard: CardId[];
  /** Colour in play. */
  color: ColorId;
  /** Whose turn it is (kept, but meaningless, in roundOver/over). */
  turn: PlayerId;
  /** 1 = order index +1 (clockwise), -1 = reversed. */
  direction: 1 | -1;
  /** Cards the turn player must take in phase "respond". */
  pending: number;
  /** The card just drawn by the turn player in phase "drawn". */
  drawnCard: CardId | null;
  /** Turn player who called Clash! early this turn. */
  called: PlayerId | null;
  /** Un-called one-card players → epoch ms until which they can be caught. */
  exposed: Record<PlayerId, number>;
  /** Secret: the last Rainbow +4 and whether it was unfair (for challenges). */
  wild4: { player: PlayerId; guilty: boolean } | null;
  /** Consecutive passes in phase "play" (stall breaker). */
  idle: number;
  totals: Record<PlayerId, number>;
  lastRound: RoundResult | null;
  log: LogEntry[];
  logSeq: number;
}

export type Action =
  | { type: "play"; card: CardId }
  | { type: "play"; card: CardId; color: ColorId }
  | { type: "play"; card: CardId; target: PlayerId }
  | { type: "draw" }
  | { type: "pass" }
  | { type: "accept" }
  | { type: "challenge" }
  | { type: "clash" }
  | { type: "catch"; target: PlayerId }
  | { type: "skipTurn" }
  | { type: "nextRound" }
  | { type: "@timeout" };

export interface View {
  /** The viewer (null = spectator). */
  me: PlayerId | null;
  phase: Phase;
  round: number;
  settings: Settings;
  deckCount: number;
  order: PlayerId[];
  /** null in roundOver/over. */
  turn: PlayerId | null;
  direction: 1 | -1;
  top: CardId;
  /** Up to the last 4 discard cards, oldest first (the last one is `top`). */
  discardTop: CardId[];
  color: ColorId;
  drawCount: number;
  discardCount: number;
  handCounts: Record<PlayerId, number>;
  /** My hand ([] for spectators). */
  myHand: CardId[];
  /** My drawn card while I am in phase "drawn", else null. */
  drawnCard: CardId | null;
  pending: number;
  called: PlayerId | null;
  exposed: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
  targetScore: number;
  lastRound: RoundResult | null;
  /** Every hand, only in roundOver/over; otherwise null. */
  revealedHands: Record<PlayerId, CardId[]> | null;
  /** Last ≤ 20 public events, oldest first. */
  log: LogEntry[];
}
