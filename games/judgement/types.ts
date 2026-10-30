/**
 * Public types and pure helpers for Judgement (shared by rules.ts, ui.tsx and tests).
 * Nothing in here is secret: it ships to every client.
 *
 * Flow per round: deal `handSize` cards each -> "bidding" (left of the dealer first, dealer last)
 * -> "playing" (left of the dealer leads trick 1, each trick's winner leads the next)
 * -> "summary" (host taps Next round) ... after the final round the phase is "over".
 * The first dealer is seat 0; the dealer moves one seat clockwise every round.
 */
import type { Card, PlayerId, Suit } from "../../engine";

// ---------------------------------------------------------------------------
// Settings (house rules)
// ---------------------------------------------------------------------------

export type Sequence = "down" | "downUp" | "up";
export type MissPenalty = "zero" | "minusBid" | "minusDiff";

export type Settings = {
  /** Cards dealt in the biggest round (1-13). startCards x players must be <= 52. */
  startCards: number;
  /** "down": 7,6..1. "downUp": 7..1..7 (1 played once). "up": 1..7. */
  sequence: Sequence;
  /** Adds a no-trump round after Hearts in the trump rotation. */
  noTrump: boolean;
  /** The last bidder (dealer) may not make the total of bids equal the hand size. */
  lastBidderRule: boolean;
  /** When you can't follow suit but hold a trump, you must play a trump. */
  mustTrumpWhenVoid: boolean;
  /** Points for making your bid exactly (added to perTrick x bid). */
  exactBonus: number;
  /** Points per bid trick when the bid is made exactly. */
  perTrick: number;
  /** Missed bid: "zero" = 0, "minusBid" = -bid, "minusDiff" = -|bid - won|. */
  missPenalty: MissPenalty;
  /** Seconds per bid/play before the game auto-moves for that player. 0 = no timer. */
  turnTimer: number;
};

// ---------------------------------------------------------------------------
// Constants and pure helpers (safe for the UI)
// ---------------------------------------------------------------------------

/** Trump rotation without the optional no-trump round. */
export const TRUMP_ORDER: readonly Suit[] = ["S", "D", "C", "H"];

/** How long the host's "Hurry up" gives the slow player before the game moves for them. */
export const HURRY_MS = 30_000;

/** The trump cycle for these settings: S, D, C, H (+ null = no trump when `noTrump`). */
export function trumpRotation(noTrump: boolean): (Suit | null)[] {
  return noTrump ? [...TRUMP_ORDER, null] : [...TRUMP_ORDER];
}

/** Trump of 1-based round `round`. null = no trump. */
export function trumpForRound(round: number, noTrump: boolean): Suit | null {
  const rot = trumpRotation(noTrump);
  return rot[(round - 1) % rot.length];
}

/** Hand size of every round, in order. down(7) = 7..1, downUp(7) = 7..1..7, up(7) = 1..7. */
export function handSizeSequence(startCards: number, sequence: Sequence): number[] {
  const down = Array.from({ length: startCards }, (_, i) => startCards - i);
  if (sequence === "up") return down.slice().reverse();
  if (sequence === "downUp") return [...down, ...down.slice(0, -1).reverse()];
  return down;
}

/** "Spades", "No trump". */
export function trumpName(trump: Suit | null): string {
  if (trump === null) return "No trump";
  return { S: "Spades", D: "Diamonds", C: "Clubs", H: "Hearts" }[trump];
}

// ---------------------------------------------------------------------------
// State (server only in practice; never sent to clients as-is)
// ---------------------------------------------------------------------------

export type Phase = "bidding" | "playing" | "summary" | "over";

export type TrickPlay = { player: PlayerId; card: Card };

export type CompletedTrick = {
  plays: TrickPlay[];
  winner: PlayerId;
  /** Winning card (public: everyone saw the trick). */
  winningCard: Card;
};

/** Result of one finished round (public). */
export type RoundResult = {
  round: number;
  handSize: number;
  trump: Suit | null;
  dealer: PlayerId;
  bids: Record<PlayerId, number>;
  won: Record<PlayerId, number>;
  /** Points scored this round (can be negative with a miss penalty). */
  points: Record<PlayerId, number>;
  /** true when the player won exactly their bid. */
  made: Record<PlayerId, boolean>;
  /** Running totals after this round. */
  totals: Record<PlayerId, number>;
};

export interface State {
  /** Seat order (clockwise). */
  order: PlayerId[];
  settings: Settings;
  /** Hand size of every round (handSizeSequence of the settings). */
  handSizes: number[];
  phase: Phase;
  /** 1-based round number. */
  round: number;
  handSize: number;
  trump: Suit | null;
  dealer: PlayerId;
  /** Bidding order this round: left of the dealer first, dealer last. */
  bidOrder: PlayerId[];
  /** Secret: each player's cards. */
  hands: Record<PlayerId, Card[]>;
  /** Public; null = not bid yet. */
  bids: Record<PlayerId, number | null>;
  tricksWon: Record<PlayerId, number>;
  /** Who must bid/play now (null in summary/over). */
  turn: PlayerId | null;
  /** Who led the current trick (null outside "playing"). */
  leader: PlayerId | null;
  /** Cards played to the current trick, in play order. */
  trick: TrickPlay[];
  /** The most recent completed trick of this round (null at the start of a round). */
  lastTrick: CompletedTrick | null;
  /** Completed tricks this round. */
  tricksPlayed: number;
  totals: Record<PlayerId, number>;
  history: RoundResult[];
  /** Epoch ms when the game moves for `turn` (turn timer or host "hurry"), else null. */
  deadline: number | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type BidAction = { type: "bid"; bid: number };
export type PlayAction = { type: "play"; card: Card };
/** Host only, in "summary": deal the next round. */
export type NextRoundAction = { type: "nextRound" };
/** Host only, while waiting on someone else: start a HURRY_MS countdown, then the game moves for them. */
export type HurryAction = { type: "hurry" };
export type TimeoutAction = { type: "@timeout" };

export type Action = BidAction | PlayAction | NextRoundAction | HurryAction | TimeoutAction;

// ---------------------------------------------------------------------------
// View (what one player may see)
// ---------------------------------------------------------------------------

export interface View {
  phase: Phase;
  round: number;
  totalRounds: number;
  /** Every round's hand size, in order (for "round 3 of 7" style displays). */
  handSizes: number[];
  handSize: number;
  trump: Suit | null;
  dealer: PlayerId;
  /** Seat order (clockwise). */
  order: PlayerId[];
  /** Left of the dealer first, dealer last. */
  bidOrder: PlayerId[];
  /** Who must bid/play now (null in summary/over). */
  turn: PlayerId | null;
  /** The viewer's own cards (sorted). [] for spectators. */
  myHand: Card[];
  handCounts: Record<PlayerId, number>;
  /** Public bids; null = not bid yet. */
  bids: Record<PlayerId, number | null>;
  /** Sum of the bids made so far. */
  bidTotal: number;
  /**
   * While bidding: the bid the current bidder may not make (last-bidder rule), else null.
   * Public, since everyone can work it out from the bids.
   */
  forbiddenBid: number | null;
  tricksWon: Record<PlayerId, number>;
  /** Leader of the current trick (null outside "playing"). */
  leader: PlayerId | null;
  /** Current trick, in play order. */
  trick: TrickPlay[];
  /** Suit led in the current trick (null if no card yet). */
  ledSuit: Suit | null;
  /** Most recent completed trick this round (also the final trick during "summary"). */
  lastTrick: CompletedTrick | null;
  tricksPlayed: number;
  totals: Record<PlayerId, number>;
  /** Every finished round, oldest first (per-round score columns). */
  history: RoundResult[];
  /** The round just finished (in "summary"/"over"), else null. */
  lastRound: RoundResult | null;
  /** What comes after this round (null on the final round). */
  next: { round: number; handSize: number; trump: Suit | null; dealer: PlayerId } | null;
  settings: Settings;
}
