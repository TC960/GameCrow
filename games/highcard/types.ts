/** Public types for High Card Duel (shared by rules.ts, ui.tsx and tests). */
import type { Card, PlayerId } from "../../engine";

export type Settings = {
  handSize: number;
  tieRule: string; // "all" | "none"
  aceLow: boolean;
};

export type Phase = "pick" | "reveal" | "over";

export interface State {
  order: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  /** Secret until phase "reveal". */
  picks: Record<PlayerId, Card | null>;
  scores: Record<PlayerId, number>;
  round: number;
  phase: Phase;
  lastWinners: PlayerId[];
  settings: Settings;
}

export type Action =
  | { type: "pick"; card: Card }
  | { type: "nextRound" };

export interface View {
  phase: Phase;
  round: number;
  totalRounds: number;
  myHand: Card[];
  /** My own pick (always visible to me). */
  myPick: Card | null;
  /** Who has picked (not what). */
  picked: Record<PlayerId, boolean>;
  /** Everyone's picks, only during "reveal"/"over". */
  revealed: Record<PlayerId, Card> | null;
  handCounts: Record<PlayerId, number>;
  lastWinners: PlayerId[];
  scores: Record<PlayerId, number>;
}
