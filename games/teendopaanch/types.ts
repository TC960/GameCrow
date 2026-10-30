/** Public types for Teen Do Paanch (3-2-5), shared by rules.ts, ui.tsx and tests. See BRIEF.md. */
import type { Card, PlayerId, Suit } from "../../engine";

export type Settings = {
  /** Hands to play (a cap when endRule is "points"). 1-30, default 6. */
  hands: number;
  /** "hands" (default): play `hands` hands. "points": first to `targetPoints` total (checked after each hand). */
  endRule: string;
  /** 1-20, default 5. Only used when endRule is "points". */
  targetPoints: number;
  /** Which two sevens leave the deck: "clubsDiamonds" (default) | "heartsDiamonds" | "spadesClubs". */
  removedSevens: string;
  /** "five" (default): trump called after the first 5 cards. "all": after all 10. */
  trumpCallAfter: string;
  /** "highest" (default): overtrick players pull cards (victim returns highest of the suit). "off": no exchange. */
  pullRule: string;
};

export type Phase = "trump" | "exchange" | "play" | "handEnd" | "over";

/** Trick targets used by this game. */
export const TARGETS = [5, 3, 2] as const;
export const TRICKS_PER_HAND = 10;
export const CARDS_PER_BATCH = 5;

export type TrickCard = { playerId: PlayerId; card: Card };

export type LastTrick = { plays: TrickCard[]; winner: PlayerId };

/** One single pull still to do (public). */
export type PullStep = { puller: PlayerId; victim: PlayerId };

/** A completed pull. In views, `given`/`returned` are null unless the viewer is the puller or the victim. */
export type Exchange = { puller: PlayerId; victim: PlayerId; given: Card | null; returned: Card | null };

/** Result of a completed hand (public). */
export type HandResult = {
  hand: number;
  dealer: PlayerId;
  trump: Suit;
  targets: Record<PlayerId, number>;
  tricks: Record<PlayerId, number>;
  /** tricks - target */
  diffs: Record<PlayerId, number>;
};

export interface State {
  /** Seat order (clockwise). */
  order: PlayerId[];
  settings: Settings;
  phase: Phase;
  /** 1-based hand number. */
  hand: number;
  dealer: PlayerId;
  targets: Record<PlayerId, number>;
  /** The 5-trick player: calls trump, leads trick 1. */
  trumpMaker: PlayerId;
  trump: Suit | null;
  /** Cards currently in each hand. */
  hands: Record<PlayerId, Card[]>;
  /** Second batch of 5, face down until trump is called (empty arrays once dealt / in "all" mode). SECRET. */
  secondBatch: Record<PlayerId, Card[]>;
  /** Pulls still to do this hand, in order. */
  pullQueue: PullStep[];
  /** Completed pulls this hand (full cards; views hide them from non-participants). */
  exchanges: Exchange[];
  /** Previous hand's diffs (what drives this hand's pulls). All 0 in hand 1. */
  owed: Record<PlayerId, number>;
  leader: PlayerId;
  /** Whose turn in "play" (null otherwise). */
  turn: PlayerId | null;
  trick: TrickCard[];
  lastTrick: LastTrick | null;
  tricksWon: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
  history: HandResult[];
}

export type Action =
  | { type: "trump"; suit: Suit }
  | { type: "pull"; card: Card }
  | { type: "play"; card: Card }
  | { type: "nextHand" };

export interface View {
  phase: Phase;
  hand: number;
  /** settings.hands */
  totalHands: number;
  settings: Settings;
  order: PlayerId[];
  dealer: PlayerId;
  targets: Record<PlayerId, number>;
  trumpMaker: PlayerId;
  trump: Suit | null;
  /** The viewer's own current hand ([] for spectators). Never includes a face-down second batch. */
  myHand: Card[];
  /** True while the second batch of 5 is still face down (trump phase in "five" mode). */
  awaitingSecondBatch: boolean;
  /** Cards currently in each hand (face-down second batch not counted). */
  handCounts: Record<PlayerId, number>;
  pullQueue: PullStep[];
  exchanges: Exchange[];
  owed: Record<PlayerId, number>;
  leader: PlayerId;
  turn: PlayerId | null;
  trick: TrickCard[];
  /** 1-based number of the trick in progress (10 once all are done). */
  trickNumber: number;
  lastTrick: LastTrick | null;
  tricksWon: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
  history: HandResult[];
}
