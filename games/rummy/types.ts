/** Public types for Rummy (13-card & 10-card Indian Rummy), shared by rules.ts, melds.ts, ui.tsx and tests. */
import type { Card, PlayerId, Rank } from "../../engine";

export type Variant = "13" | "10";
export type Mode = "single" | "deals" | "pool101" | "pool201";

export type Settings = {
  /** "13" = 13-card (default), "10" = 10-card. */
  variant: Variant;
  mode: Mode;
  /** Number of deals for mode "deals". */
  dealCount: number;
  /** "auto" | "1" | "2". Auto: 13-card 2 decks; 10-card 1 deck (2–4 players) or 2 decks (5–6). */
  decks: "auto" | "1" | "2";
  /** Printed jokers added to the whole shoe. */
  printedJokers: number;
  /** Cut a wild-joker rank after the deal. */
  wildJoker: boolean;
  /** May a joker (printed or wild rank) be taken from the open pile. */
  jokerFromDiscard: boolean;
  /** Cap on a losing hand's points. */
  maxPoints: number;
  wrongShowPenalty: number;
  /** "continue": wrong-show player is out of the deal, play goes on. "end": the deal ends. */
  wrongShow: "continue" | "end";
  firstDrop: number;
  middleDrop: number;
  /** Offer the Auto-group action. */
  autoGroup: boolean;
};

/** in = playing this deal; dropped / wrongShow = out of this deal; out = eliminated from the pool. */
export type Status = "in" | "dropped" | "wrongShow" | "out";
export type Phase = "play" | "dealOver" | "over";
export type Step = "draw" | "discard";
export type MeldKind = "pure" | "impure" | "set";
export type EndReason = "declare" | "lastStanding" | "stockOut" | "wrongShow";

export type LogKind = "drawStock" | "drawDiscard" | "discard" | "drop" | "declare" | "wrongShow" | "skip" | "reshuffle";

/** A public event. `card` is only set when the card is public (open-pile pick, discard, finishing card). */
export type LogEntry = { player: PlayerId | null; kind: LogKind; card: Card | null };

/** A wrong show: the declarer's arrangement is revealed. */
export type Show = { player: PlayerId; groups: Card[][]; finishCard: Card };

export type ResultHand = {
  status: Status;
  /** Revealed groups (winner: as declared; others still in: the scored best grouping). null for dropped / out players. */
  groups: Card[][] | null;
  /** Kind of each group in `groups` (null = unmatched cards). */
  kinds: (MeldKind | null)[] | null;
  /** Points this deal (null for eliminated players). */
  points: number | null;
};

export type DealResult = {
  deal: number;
  reason: EndReason;
  winner: PlayerId | null;
  /** The declarer's finishing card (reason "declare"). */
  finishCard: Card | null;
  hands: Record<PlayerId, ResultHand>;
};

export type DealSummary = { deal: number; winner: PlayerId | null; points: Record<PlayerId, number | null> };

export interface State {
  settings: Settings;
  /** Seat order. */
  order: PlayerId[];
  phase: Phase;
  /** 1-based deal number. */
  deal: number;
  /** Who started the current deal. */
  starter: PlayerId;
  handSize: number;
  /** Resolved deck count. */
  decks: number;
  /** Each player's hand as their own arrangement (SECRET). Empty for dropped / wrong-show / out players. */
  groups: Record<PlayerId, Card[][]>;
  /** Closed stock (SECRET). stock[0] is the top. */
  stock: Card[];
  /** Open pile; the last element is the top. */
  discard: Card[];
  /** Cut wild-joker indicator (public, out of play) or null. */
  wildCard: Card | null;
  /** Rank that is wild this deal ("A" when a printed joker was cut) or null. */
  wildRank: Rank | null;
  turn: PlayerId | null;
  step: Step | null;
  /** Card the turn player took from the open pile this turn (may not be discarded). */
  pickedFromDiscard: Card | null;
  /** Card the turn player drew this turn (SECRET when from the stock). */
  lastDrawn: Card | null;
  /** Has drawn at least once this deal (first vs middle drop). */
  hasDrawn: Record<PlayerId, boolean>;
  status: Record<PlayerId, Status>;
  /** Points of the current/last deal once known (drop and wrong show are known immediately). */
  dealPoints: Record<PlayerId, number | null>;
  totals: Record<PlayerId, number>;
  /** Stock rebuilds this deal. */
  reshuffles: number;
  shows: Show[];
  /** Last 12 public events. */
  log: LogEntry[];
  result: DealResult | null;
  history: DealSummary[];
}

export type Action =
  | { type: "draw"; from: "stock" | "discard" }
  | { type: "discard"; card: Card }
  | { type: "declare"; card: Card }
  | { type: "drop" }
  /** Move `card` to group index `group`; group === groups.length = new group at the end. */
  | { type: "move"; card: Card; group: number }
  /** Whole arrangement as text: "7H,8H,9H|KS,KD#2,KC" (see encodeGroups / decodeGroups in melds.ts). */
  | { type: "arrange"; groups: string }
  | { type: "sortGroups" }
  | { type: "autoGroup" }
  /** Host only: auto-play a slow player's turn. */
  | { type: "skipTurn" }
  /** Host only: start the next deal. */
  | { type: "nextDeal" };

export type PlayerPublic = {
  id: PlayerId;
  status: Status;
  handCount: number;
  dealPoints: number | null;
  total: number;
};

export interface View {
  phase: Phase;
  deal: number;
  /** Total deals in mode "deals", else null. */
  dealCount: number | null;
  /** 101 / 201 in pool modes, else null. */
  poolLimit: number | null;
  variant: Variant;
  handSize: number;
  settings: Settings;
  turn: PlayerId | null;
  step: Step | null;
  wildCard: Card | null;
  wildRank: Rank | null;
  stockCount: number;
  discardTop: Card | null;
  discardCount: number;
  /** My arrangement ([] for spectators / when out of the deal). */
  myGroups: Card[][];
  /** My hand (myGroups flattened). */
  myHand: Card[];
  myStatus: Status | null;
  /** Only while it is my turn. */
  pickedFromDiscard: Card | null;
  /** Only while it is my turn: the card I drew this turn. */
  lastDrawn: Card | null;
  /** Points a drop would cost me now, or null when I can't drop. */
  myDropCost: number | null;
  /** Seat order. */
  players: PlayerPublic[];
  totals: Record<PlayerId, number>;
  log: LogEntry[];
  shows: Show[];
  result: DealResult | null;
  history: DealSummary[];
}
