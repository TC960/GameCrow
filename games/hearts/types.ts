/** Public types and constants for Hearts (shared by rules.ts, ui.tsx and tests). See BRIEF.md. */
import type { Card, PlayerId } from "../../engine";

export type Settings = {
  /** "standard" | "left" | "leftRight" | "none" */
  passPattern: string;
  /** "twoClubs" (holder of the opening card leads it) | "leftOfDealer" */
  firstLead: string;
  noPointsFirstTrick: boolean;
  heartsMustBreak: boolean;
  queenBreaksHearts: boolean;
  /** "others" (others +26) | "self" (shooter −26) | "off" */
  moon: string;
  /** J♦ counts −10 for whoever wins it. */
  jackOfDiamonds: boolean;
  targetScore: number;
  /** Seconds per turn / pass phase; 0 = no timer. */
  turnTimer: number;
};

export type Phase = "pass" | "play" | "handEnd" | "over";
export type PassDirection = "left" | "right" | "across" | "hold";

export const PASS_COUNT = 3;
export const QUEEN_OF_SPADES: Card = "QS";
export const JACK_OF_DIAMONDS: Card = "JD";
export const QUEEN_POINTS = 13;
export const HEART_POINTS = 1;
export const JACK_POINTS = -10;
export const MOON_POINTS = 26;

/** Cards removed from the 52-card deck so it divides evenly, by player count. */
export const REMOVED_CARDS: Record<number, Card[]> = {
  3: ["2D"],
  4: [],
  5: ["2D", "2C"],
  6: ["2D", "2C", "3D", "3C"],
};

/** Lowest club left in the deck: the card that must open trick 1 when firstLead = "twoClubs". */
export const OPENING_CARD: Record<number, Card> = { 3: "2C", 4: "2C", 5: "3C", 6: "4C" };

/** Pass direction for hand number `hand` (1-based). */
export function passDirectionFor(pattern: string, players: number, hand: number): PassDirection {
  const seq: PassDirection[] =
    pattern === "none"
      ? ["hold"]
      : pattern === "left"
        ? ["left"]
        : pattern === "leftRight"
          ? ["left", "right"]
          : players % 2 === 0
            ? ["left", "right", "across", "hold"]
            : ["left", "right", "hold"];
  return seq[(hand - 1) % seq.length];
}

/** Who `id` passes to in direction `dir` (null on a hold hand). Left = next seat clockwise. */
export function passTarget(order: readonly PlayerId[], id: PlayerId, dir: PassDirection): PlayerId | null {
  const n = order.length;
  const i = order.indexOf(id);
  if (i < 0 || dir === "hold") return null;
  const step = dir === "left" ? 1 : dir === "right" ? n - 1 : n / 2;
  return order[(i + step) % n];
}

/** Who passes to `id` in direction `dir` (null on a hold hand). */
export function passSource(order: readonly PlayerId[], id: PlayerId, dir: PassDirection): PlayerId | null {
  const n = order.length;
  const i = order.indexOf(id);
  if (i < 0 || dir === "hold") return null;
  const step = dir === "left" ? 1 : dir === "right" ? n - 1 : n / 2;
  return order[(i - step + n) % n];
}

export type TrickPlay = { playerId: PlayerId; card: Card };

export type CompletedTrick = { plays: TrickPlay[]; winner: PlayerId };

export type HandResult = {
  hand: number;
  /** Raw points taken: hearts + 13 for Q♠ (− 10 for J♦ when that rule is on). */
  points: Record<PlayerId, number>;
  /** What was added to each total after the moon rule. */
  scores: Record<PlayerId, number>;
  /** The player who shot the moon (when the moon rule is on), else null. */
  moon: PlayerId | null;
  /** Totals after this hand. */
  totals: Record<PlayerId, number>;
};

export interface State {
  order: PlayerId[];
  settings: Settings;
  phase: Phase;
  /** Hand number, from 1. */
  hand: number;
  /** Seat index of this hand's dealer. */
  dealer: number;
  passDirection: PassDirection;
  hands: Record<PlayerId, Card[]>;
  /** Secret: each player's current pass selection (pass phase). */
  passSelected: Record<PlayerId, Card[]>;
  /** Secret: committed passes (null = not yet confirmed / hold hand). */
  passed: Record<PlayerId, Card[] | null>;
  /** Secret: cards each player received this hand (after the exchange). */
  received: Record<PlayerId, Card[] | null>;
  /** Whose turn in the play phase. */
  turn: PlayerId | null;
  /** Leader of the current trick. */
  leader: PlayerId | null;
  trick: TrickPlay[];
  /** Current trick number, from 1. */
  trickNumber: number;
  lastTrick: CompletedTrick | null;
  heartsBroken: boolean;
  /** Every card each player has won this hand (public: tricks are played face up). */
  taken: Record<PlayerId, Card[]>;
  tricksWon: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
  history: HandResult[];
  removed: Card[];
  /** When the current turn (play) or the pass phase started; used by the optional timer. */
  turnStartedAt: number;
}

export type Action =
  | { type: "togglePass"; card: Card }
  | { type: "confirmPass" }
  | { type: "play"; card: Card }
  | { type: "nextHand" }
  | { type: "@timeout" };

export interface View {
  phase: Phase;
  hand: number;
  order: PlayerId[];
  dealer: PlayerId;
  passDirection: PassDirection;
  /** Who I pass to / receive from this hand (null on hold hands and for spectators). */
  passTo: PlayerId | null;
  passFrom: PlayerId | null;
  myHand: Card[];
  /** My current pass selection (pass phase only, else []). */
  passSelected: Card[];
  /** The cards I passed this hand (after I confirmed), else null. */
  myPassed: Card[] | null;
  /** The cards I received this hand (after the exchange), else null. */
  received: Card[] | null;
  /** Who has confirmed their pass (public). */
  passConfirmed: Record<PlayerId, boolean>;
  handCounts: Record<PlayerId, number>;
  turn: PlayerId | null;
  leader: PlayerId | null;
  trick: TrickPlay[];
  trickNumber: number;
  /** Tricks per hand for this player count. */
  tricksPerHand: number;
  lastTrick: CompletedTrick | null;
  heartsBroken: boolean;
  /** Scoring cards each player has won this hand (hearts, Q♠, J♦ when on). */
  pointCards: Record<PlayerId, Card[]>;
  /** Raw points taken this hand so far (same formula as HandResult.points). */
  handPoints: Record<PlayerId, number>;
  tricksWon: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
  history: HandResult[];
  lastHand: HandResult | null;
  removedCards: Card[];
  /** The card that must open trick 1 (null when firstLead = "leftOfDealer"). */
  openingCard: Card | null;
  targetScore: number;
  settings: Settings;
}
