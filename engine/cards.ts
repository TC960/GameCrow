/**
 * Playing-card helpers shared by every card game (server and client safe).
 *
 * A Card is a compact string: rank + suit, e.g. "7H", "TS" (ten of spades), "AD".
 * Multi-deck games add a copy suffix: "7H#2". Jokers are "XR" / "XB" (+ optional "#n").
 */
import { GameError } from "./errors";
import type { Rng } from "./rng";

export type Suit = "S" | "H" | "D" | "C";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = string;

export const SUITS: readonly Suit[] = ["S", "H", "D", "C"];
export const RANKS: readonly Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
export const RANK_LABEL: Record<Rank, string> = {
  "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  T: "10", J: "J", Q: "Q", K: "K", A: "A",
};
const RANK_NAME: Record<Rank, string> = {
  "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "8": "Eight",
  "9": "Nine", T: "Ten", J: "Jack", Q: "Queen", K: "King", A: "Ace",
};

export interface ParsedCard {
  joker: boolean;
  /** Undefined for jokers. */
  rank?: Rank;
  /** Undefined for jokers. */
  suit?: Suit;
  /** Joker colour, "R" or "B". */
  jokerColor?: "R" | "B";
  /** Copy number for multi-deck games (1 when absent). */
  copy: number;
}

export function makeCard(rank: Rank, suit: Suit, copy = 1): Card {
  return copy > 1 ? `${rank}${suit}#${copy}` : `${rank}${suit}`;
}

export function parseCard(card: Card): ParsedCard {
  const [face, copyStr] = card.split("#");
  const copy = copyStr ? Number(copyStr) : 1;
  if (face === "XR" || face === "XB") return { joker: true, jokerColor: face[1] as "R" | "B", copy };
  const rank = face[0] as Rank;
  const suit = face[1] as Suit;
  if (face.length !== 2 || !RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`Invalid card: ${card}`);
  }
  return { joker: false, rank, suit, copy };
}

export function isValidCard(card: unknown): card is Card {
  if (typeof card !== "string") return false;
  try {
    parseCard(card);
    return true;
  } catch {
    return false;
  }
}

export function isJoker(card: Card): boolean {
  return card.startsWith("X");
}

/** Suit of a card; throws for jokers. */
export function suitOf(card: Card): Suit {
  const p = parseCard(card);
  if (!p.suit) throw new Error(`Joker has no suit: ${card}`);
  return p.suit;
}

/** Rank of a card; throws for jokers. */
export function rankOf(card: Card): Rank {
  const p = parseCard(card);
  if (!p.rank) throw new Error(`Joker has no rank: ${card}`);
  return p.rank;
}

/** Face without the copy suffix ("7H#2" -> "7H"). */
export function faceOf(card: Card): string {
  return card.split("#")[0];
}

/** Numeric rank: 2..10, J=11, Q=12, K=13, A=14 (or 1 when aceLow). */
export function rankValue(card: Card | Rank, aceLow = false): number {
  const rank = (card.length === 1 ? card : rankOf(card)) as Rank;
  if (rank === "A") return aceLow ? 1 : 14;
  return RANKS.indexOf(rank) + 2;
}

export function isRedSuit(suit: Suit): boolean {
  return suit === "H" || suit === "D";
}

/** "7♥", "10♠", "Joker". */
export function cardLabel(card: Card): string {
  const p = parseCard(card);
  if (p.joker) return "Joker";
  return `${RANK_LABEL[p.rank!]}${SUIT_SYMBOL[p.suit!]}`;
}

/** "Seven of Hearts" (for aria labels and logs). */
export function cardName(card: Card): string {
  const p = parseCard(card);
  if (p.joker) return p.jokerColor === "R" ? "Red Joker" : "Black Joker";
  return `${RANK_NAME[p.rank!]} of ${SUIT_NAME[p.suit!]}`;
}

export interface DeckOptions {
  /** Number of 52-card decks (default 1). Copies get "#2", "#3"... suffixes. */
  decks?: number;
  /** Total jokers to add (default 0). */
  jokers?: number;
  /** Only these ranks (e.g. 29 uses 7..A). Default all 13. */
  ranks?: readonly Rank[];
  suits?: readonly Suit[];
}

/** Ordered (unshuffled) deck. */
export function makeDeck(opts: DeckOptions = {}): Card[] {
  const { decks = 1, jokers = 0, ranks = RANKS, suits = SUITS } = opts;
  const out: Card[] = [];
  for (let d = 1; d <= decks; d++) {
    for (const s of suits) for (const r of ranks) out.push(makeCard(r, s, d));
  }
  for (let j = 0; j < jokers; j++) {
    const face = j % 2 === 0 ? "XR" : "XB";
    const copy = Math.floor(j / 2) + 1;
    out.push(copy > 1 ? `${face}#${copy}` : face);
  }
  return out;
}

export function shuffledDeck(rng: Rng, opts: DeckOptions = {}): Card[] {
  return rng.shuffle(makeDeck(opts));
}

/**
 * Deal `perPlayer` cards to each of `players` hands, round-robin starting at `startIndex`.
 * Returns the hands (index = player order) and the undealt rest.
 */
export function deal(deck: readonly Card[], players: number, perPlayer: number, startIndex = 0) {
  if (players * perPlayer > deck.length) throw new Error("Not enough cards to deal");
  const hands: Card[][] = Array.from({ length: players }, () => []);
  let i = 0;
  for (let round = 0; round < perPlayer; round++) {
    for (let p = 0; p < players; p++) hands[(startIndex + p) % players].push(deck[i++]);
  }
  return { hands, rest: deck.slice(i) };
}

/** Deal the whole deck round-robin (some hands get one extra card when it does not divide evenly). */
export function dealAll(deck: readonly Card[], players: number, startIndex = 0): Card[][] {
  const hands: Card[][] = Array.from({ length: players }, () => []);
  deck.forEach((c, i) => hands[(startIndex + i) % players].push(c));
  return hands;
}

/** Copy of `hand` without `card`. Throws a GameError if it is not there. */
export function removeCard(hand: readonly Card[], card: Card): Card[] {
  const i = hand.indexOf(card);
  if (i < 0) throw new GameError("You don't have that card");
  return [...hand.slice(0, i), ...hand.slice(i + 1)];
}

/** Copy of `hand` without all of `cards` (each removed once). */
export function removeCards(hand: readonly Card[], cards: readonly Card[]): Card[] {
  return cards.reduce<Card[]>((h, c) => removeCard(h, c), hand.slice());
}

export type SortMode = "suit" | "rank";

/** Alternating colours so neighbouring suits are easy to tell apart. */
export const DISPLAY_SUIT_ORDER: readonly Suit[] = ["S", "H", "C", "D"];

/**
 * Sorted copy of `cards`. "suit": grouped by suit (alternating colours), rank ascending inside.
 * "rank": by rank, then suit. Jokers go last.
 */
export function sortCards(
  cards: readonly Card[],
  mode: SortMode = "suit",
  opts: { aceLow?: boolean; suitOrder?: readonly Suit[] } = {},
): Card[] {
  const order = opts.suitOrder ?? DISPLAY_SUIT_ORDER;
  const key = (c: Card): [number, number, number] => {
    const p = parseCard(c);
    if (p.joker) return [99, 99, p.copy];
    const s = order.indexOf(p.suit!);
    const r = rankValue(p.rank!, opts.aceLow);
    return mode === "suit" ? [s, r, p.copy] : [r, s, p.copy];
  };
  return cards.slice().sort((x, y) => {
    const a = key(x), b = key(y);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}

/**
 * Index of the winning play in a trick: highest trump if any trump was played,
 * otherwise highest card of the led suit. `rankOrder` overrides the normal A-high order
 * (lowest first), e.g. 29's ["7","8","Q","K","T","A","9","J"].
 */
export function trickWinner(
  cards: readonly Card[],
  trump: Suit | null,
  rankOrder?: readonly Rank[],
): number {
  if (cards.length === 0) throw new Error("trickWinner: empty trick");
  const lead = suitOf(cards[0]);
  const value = (c: Card) => (rankOrder ? rankOrder.indexOf(rankOf(c)) : rankValue(c));
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    const c = cards[i], b = cards[best];
    const cs = suitOf(c), bs = suitOf(b);
    const cTrump = trump !== null && cs === trump;
    const bTrump = trump !== null && bs === trump;
    if (cTrump && !bTrump) best = i;
    else if (cTrump === bTrump && cs === bs && value(c) > value(b)) best = i;
    else if (!cTrump && !bTrump && cs === lead && bs !== lead) best = i;
  }
  return best;
}

/** Cards in `hand` that may be played to a trick led with `leadSuit` (follow suit if able). */
export function followSuitOptions(hand: readonly Card[], leadSuit: Suit | null): Card[] {
  if (leadSuit === null) return hand.slice();
  const same = hand.filter((c) => !isJoker(c) && suitOf(c) === leadSuit);
  return same.length > 0 ? same : hand.slice();
}
