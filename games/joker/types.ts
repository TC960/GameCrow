/** Public types for Joker (shared by rules.ts, ui.tsx and tests). See BRIEF.md. */
import type { Card, PlayerId } from "../../engine";

/** The single Joker added to the 52-card deck (deck "joker"). */
export const JOKER: Card = "XR";
/** The queen taken out of the deck in the classic Old Maid variant (deck "queen"). */
export const REMOVED_QUEEN: Card = "QC";

export type Settings = {
  /** "joker" = 52 + Joker; "queen" = 52 minus the Queen of Clubs (Old Maid). */
  deck: string;
  /** Pairs must also match colour (black ♠♣ / red ♥♦). */
  matchColour: boolean;
  /** "next" = draw from the next holder clockwise; "previous" = from the previous holder. */
  drawFrom: string;
  /** "shuffle" = server reshuffles hands after each draw; "arrange" = target arranges and offers before each draw. */
  handOrder: string;
  /** Number of deals, 1..10. */
  rounds: number;
  /** "places" = place points (higher better); "losses" = rounds lost (lower better). */
  scoring: string;
};

export type Phase = "play" | "roundOver" | "over";
/** Within "play": "offer" (target arranges, arrange mode only) then "draw" (drawer picks a position). */
export type Step = "offer" | "draw";

/** A pair thrown out face up (public). */
export type PairDiscard = {
  by: PlayerId;
  cards: Card[];
};

/** The latest draw (state version: `card` is secret to the drawer). */
export type DrawRecord = {
  drawer: PlayerId;
  from: PlayerId;
  /** Position picked in the target's hand. */
  index: number;
  /** The card drawn. Secret (only the drawer's view gets it, as myDrawnCard). */
  card: Card;
  /** The pair it made (held card, drawn card), or null if it stayed in the drawer's hand. */
  paired: Card[] | null;
  /** Players who went out on this draw. */
  out: PlayerId[];
};

/** Public part of the latest draw. */
export type PublicDraw = {
  drawer: PlayerId;
  from: PlayerId;
  index: number;
  paired: Card[] | null;
  out: PlayerId[];
};

export type RoundResult = {
  round: number;
  loser: PlayerId;
  /** Final places this round (1 = first out, n = loser). */
  places: Record<PlayerId, number>;
  /** Points this round: n - place. */
  points: Record<PlayerId, number>;
};

export interface State {
  order: PlayerId[];
  settings: Settings;
  phase: Phase;
  /** Meaningful only in phase "play". */
  step: Step;
  round: number;
  /** Each hand in its real position order (index = draw position). Empty after a round ends. */
  hands: Record<PlayerId, Card[]>;
  /** The drawer (null outside "play"). */
  turn: PlayerId | null;
  /** Whose hand the drawer draws from (null outside "play"). */
  target: PlayerId | null;
  /** Finishing place this round; null while still holding cards. */
  places: Record<PlayerId, number | null>;
  /** Pairs thrown out this round, in order (initial discards first). */
  pairs: PairDiscard[];
  lastDraw: DrawRecord | null;
  /** Place points from completed rounds. */
  points: Record<PlayerId, number>;
  /** Rounds lost (left holding the loser card). */
  losses: Record<PlayerId, number>;
  results: RoundResult[];
  /**
   * The just-finished round's loser card(s) (the Joker, or the odd queen): public, set only in
   * phases "roundOver"/"over", [] during play (so no past card string is visible while it is in a hand).
   */
  loserCards: Card[];
}

export type Action =
  | { type: "draw"; index: number }
  | { type: "offer" }
  | { type: "shuffle" }
  | { type: "move"; card: Card; to: number }
  | { type: "skipTurn" }
  | { type: "nextRound" };

export interface View {
  phase: Phase;
  /** null outside "play". */
  step: Step | null;
  round: number;
  totalRounds: number;
  settings: Settings;
  order: PlayerId[];
  /** My cards in real position order ([] for spectators). */
  myHand: Card[];
  handCounts: Record<PlayerId, number>;
  turn: PlayerId | null;
  target: PlayerId | null;
  places: Record<PlayerId, number | null>;
  pairs: PairDiscard[];
  lastDraw: PublicDraw | null;
  /** The card I drew, when the latest draw was mine; otherwise null. */
  myDrawnCard: Card | null;
  points: Record<PlayerId, number>;
  losses: Record<PlayerId, number>;
  results: RoundResult[];
  /** Same as State.loserCards: [] during play. */
  loserCards: Card[];
}
