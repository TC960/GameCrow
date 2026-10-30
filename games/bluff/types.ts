/** Public types and constants for Bluff (shared by rules.ts, ui.tsx and tests). See BRIEF.md. */
import type { Card, PlayerId, Rank } from "../../engine";

export type ClaimMode = "follow" | "free" | "sequence";
export type WhoCanCall = "anyone" | "next";
export type AllPassRule = "discard" | "keep";
export type AfterCall = "winner" | "loser" | "next";
export type EndMode = "first" | "full";
export type DecksSetting = "auto" | "1" | "2";

export type Settings = {
  claimMode: string; // ClaimMode
  maxCards: number; // 1..8, effective cap 4 × decks
  whoCanCall: string; // WhoCanCall
  callSeconds: number; // 0..30, 0 = no timer
  allowPass: boolean;
  allPass: string; // AllPassRule
  afterCall: string; // AfterCall
  endMode: string; // EndMode
  decks: string; // DecksSetting
};

/** Ranks in the order a claim picker shows them (and the "sequence" claim order). */
export const CLAIM_RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
/** Sequence mode: the n-th play (0-based) must claim SEQUENCE[n % 13]. */
export const SEQUENCE: readonly Rank[] = CLAIM_RANKS;
/** Max entries kept in the public log. */
export const LOG_LIMIT = 30;

export type Phase = "turn" | "respond" | "over";

/** The last play, while its call window is open. `cards` is secret (state only, never in a view). */
export interface PendingPlay {
  claimant: PlayerId;
  cards: Card[];
  rank: Rank;
}

/** Public result of the most recent call. `cards` (the called play) are revealed to everyone. */
export interface CallResult {
  id: number;
  caller: PlayerId;
  claimant: PlayerId;
  rank: Rank;
  cards: Card[];
  truthful: boolean;
  /** Who picked up the pile. */
  taker: PlayerId;
  /** How many cards they picked up. */
  pileSize: number;
}

export type LogEntry =
  | { kind: "play"; playerId: PlayerId; count: number; rank: Rank }
  | { kind: "pass"; playerId: PlayerId }
  | { kind: "call"; caller: PlayerId; claimant: PlayerId; rank: Rank; cards: Card[]; truthful: boolean; taker: PlayerId; pileSize: number }
  | { kind: "clear"; count: number; discarded: boolean }
  | { kind: "finish"; playerId: PlayerId; place: number };

export interface State {
  order: PlayerId[];
  hands: Record<PlayerId, Card[]>;
  /** Secret: every card on the pile, oldest first. */
  pile: Card[];
  /** Secret: cards removed by the all-pass rule. */
  discarded: Card[];
  decks: number;
  phase: Phase;
  /** Player to act in phase "turn"; null otherwise. */
  turn: PlayerId | null;
  /** Round state. */
  roundLeader: PlayerId;
  /** Follow mode: the rank set by the round's first play (null before it). */
  roundRank: Rank | null;
  roundPlays: number;
  /** Last player who played in this round (null before the first play). */
  lastClaimant: PlayerId | null;
  passCount: number;
  /** Sequence mode: number of plays so far (next claim is SEQUENCE[seqIndex % 13]). */
  seqIndex: number;
  /** Phase "respond": the play under the call window. */
  pending: PendingPlay | null;
  eligible: PlayerId[];
  declined: PlayerId[];
  /** Epoch ms when the call window closes, or null (no timer / not responding). */
  deadline: number | null;
  /** Finish order (place 1 first). */
  finished: PlayerId[];
  lastCall: CallResult | null;
  callCount: number;
  round: number;
  log: LogEntry[];
  settings: Settings;
}

export type Action =
  | { type: "play"; cards: Card[]; rank: Rank }
  | { type: "pass" }
  | { type: "call" }
  | { type: "accept" }
  | { type: "skip" }
  | { type: "@timeout" };

export interface View {
  phase: Phase;
  order: PlayerId[];
  turn: PlayerId | null;
  myHand: Card[];
  handCounts: Record<PlayerId, number>;
  pileCount: number;
  discardCount: number;
  decks: number;
  round: number;
  roundLeader: PlayerId;
  roundRank: Rank | null;
  roundPlays: number;
  /** The rank the current turn player must claim; null = free choice (or not in phase "turn"). */
  requiredRank: Rank | null;
  /** Max cards per play for the current turn player (0 when not in phase "turn"). */
  maxPlay: number;
  canPass: boolean;
  /** The pending claim during "respond" (no cards). */
  claim: { claimant: PlayerId; count: number; rank: Rank } | null;
  eligible: PlayerId[];
  declined: PlayerId[];
  deadline: number | null;
  finished: PlayerId[];
  lastCall: CallResult | null;
  log: LogEntry[];
  settings: Settings;
}
