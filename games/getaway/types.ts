/** Public types for Get Away (Bhabhi), shared by rules.ts, ui.tsx and tests. See BRIEF.md. */
import type { Card, PlayerId, Suit } from "../../engine";

export type Settings = {
  /** Rounds in the match (1..10). */
  rounds: number;
  /** "placement" | "losses" */
  scoring: string;
  /** "aceSpades" | "anyCard" */
  openingLead: string;
  /** Off-suit on trick 1 is a cut (pick up). Default false: trick 1 is always discarded. */
  firstTrickCut: boolean;
  /** A player who has played their last card can never be made to pick up. */
  lastCardSafe: boolean;
  /** "trickWinner" | "draw": who is Bhabhi when everyone left runs out on the same trick. */
  allOutRule: string;
};

export const SCORING = { placement: "placement", losses: "losses" } as const;
export const OPENING_LEAD = { aceSpades: "aceSpades", anyCard: "anyCard" } as const;
export const ALL_OUT_RULE = { trickWinner: "trickWinner", draw: "draw" } as const;

/** The card whose holder leads the first trick of every round. */
export const OPENING_CARD: Card = "AS";

export type Phase = "play" | "roundOver" | "over";

/** One card played to a trick (same shape as the kit's TrickPlay). */
export type Play = { playerId: PlayerId; card: Card };

/** A trick that has ended. All its cards are public (they were played face up). */
export type ResolvedTrick = {
  trickNo: number;
  plays: Play[];
  ledSuit: Suit;
  /** "discarded": removed from play. "pickedUp": went into `pickedUpBy`'s hand. */
  outcome: "discarded" | "pickedUp";
  /** Who played an off-suit card that ended the trick (null if nobody cut). */
  cutBy: PlayerId | null;
  pickedUpBy: PlayerId | null;
  /** Player with the highest led-suit card. */
  highest: PlayerId;
  /** Leader of the next trick (null when the round ended). */
  nextLeader: PlayerId | null;
  /** Players who got away on this trick. */
  escaped: PlayerId[];
};

export type RoundResult = {
  round: number;
  /** Finishing groups in order (same-trick escapes share a group). The Bhabhi is not included. */
  safe: PlayerId[][];
  bhabhi: PlayerId | null;
  /** Placement points earned this round. */
  points: Record<PlayerId, number>;
};

export interface State {
  order: PlayerId[];
  settings: Settings;
  phase: Phase;
  round: number;
  hands: Record<PlayerId, Card[]>;
  /** Trick number within the round (1-based). */
  trickNo: number;
  /** Players in the current trick, clockwise from the leader (fixed at trick start). */
  trickPlayers: PlayerId[];
  trick: Play[];
  ledSuit: Suit | null;
  /** Whose turn (null outside "play"). */
  turn: PlayerId | null;
  /** Finishing groups this round, in order. */
  safe: PlayerId[][];
  discardCount: number;
  lastTrick: ResolvedTrick | null;
  /** This round's Bhabhi, once the round ended (null during play, or on a "draw"). */
  bhabhi: PlayerId | null;
  losses: Record<PlayerId, number>;
  /** Placement points from completed rounds. */
  points: Record<PlayerId, number>;
  history: RoundResult[];
}

export type Action = { type: "play"; card: Card } | { type: "nextRound" };

export interface View {
  phase: Phase;
  round: number;
  totalRounds: number;
  settings: Settings;
  /** The viewer's own hand ([] for spectators and safe players). */
  myHand: Card[];
  handCounts: Record<PlayerId, number>;
  trickNo: number;
  trickPlayers: PlayerId[];
  trick: Play[];
  ledSuit: Suit | null;
  turn: PlayerId | null;
  /** Whether an off-suit card on the current trick is a cut (false on trick 1 unless firstTrickCut). */
  cutsAllowed: boolean;
  /** Player currently holding the highest led-suit card in the trick (null if no plays yet). */
  highest: PlayerId | null;
  safe: PlayerId[][];
  /** Players not (yet) safe this round, in seat order (includes the Bhabhi at round end). */
  inPlay: PlayerId[];
  discardCount: number;
  lastTrick: ResolvedTrick | null;
  bhabhi: PlayerId | null;
  losses: Record<PlayerId, number>;
  points: Record<PlayerId, number>;
  history: RoundResult[];
}
