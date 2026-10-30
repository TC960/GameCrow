/**
 * Rummy meld validator and solver (pure, client + server safe, no secrets).
 *
 * - classifyGroup / checkDeclaration validate a player's own grouping.
 * - bestGrouping / handPoints find the minimum-deadwood arrangement (scoring losers).
 * - solveHand with a penalty is the bot / auto-group heuristic.
 *
 * "Joker" = printed joker ("XR", "XB", with optional "#n") or any card of the wild rank.
 * Sequences: same suit, consecutive, Ace low (A-2-3) or high (Q-K-A), never wrapping (K-A-2), max 13.
 * Sets: 3–4 cards, same rank, all different suits (two-deck duplicates invalid). Jokers substitute.
 * A pure sequence has no printed jokers; a wild-rank card in its natural place keeps it pure.
 * A group made only of jokers (3+) counts as an impure sequence.
 */
import { DISPLAY_SUIT_ORDER, parseCard, sortCards, type Card, type Rank, type Suit } from "../../engine";
import type { MeldKind } from "./types";

// ---------------------------------------------------------------------------
// Card basics
// ---------------------------------------------------------------------------

export function isPrintedJoker(card: Card): boolean {
  return card.startsWith("X");
}

/** Printed joker or a card of the wild rank. */
export function isJokerCard(card: Card, wildRank: Rank | null): boolean {
  if (isPrintedJoker(card)) return true;
  return wildRank !== null && parseCard(card).rank === wildRank;
}

/** A, K, Q, J = 10; 10..2 = face value; jokers (printed and wild rank) = 0. */
export function cardPoints(card: Card, wildRank: Rank | null): number {
  if (isJokerCard(card, wildRank)) return 0;
  const r = parseCard(card).rank!;
  return r === "A" || r === "K" || r === "Q" || r === "J" || r === "T" ? 10 : Number(r);
}

/** Sum of cardPoints. */
export function fullCount(cards: readonly Card[], wildRank: Rank | null): number {
  return cards.reduce((s, c) => s + cardPoints(c, wildRank), 0);
}

const RANK_NUM: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/**
 * Can `values` (2..14, Ace = 14, all distinct required) sit in a run of exactly `length` consecutive ranks,
 * with Ace either low (window inside 1..13) or high (window inside 2..14)?
 */
function runFits(values: readonly number[], length: number): boolean {
  if (length > 13) return false;
  if (values.length === 0) return length >= 1;
  for (const aceLow of [true, false]) {
    const vs = values.map((v) => (v === 14 && aceLow ? 1 : v));
    if (new Set(vs).size !== vs.length) return false;
    const min = Math.min(...vs), max = Math.max(...vs);
    const lo = aceLow ? 1 : 2, hi = aceLow ? 13 : 14;
    const sMin = Math.max(lo, max - length + 1);
    const sMax = Math.min(min, hi - length + 1);
    if (sMin <= sMax) return true;
  }
  return false;
}

/** Kind of a group, or null when it is not a valid meld. Prefers pure > impure > set. */
export function classifyGroup(cards: readonly Card[], wildRank: Rank | null): MeldKind | null {
  if (cards.length < 3) return null;
  // Pure: no printed jokers, all cards (wild-rank cards as themselves) one suit and consecutive.
  if (cards.every((c) => !isPrintedJoker(c))) {
    const parsed = cards.map(parseCard);
    if (parsed.every((p) => p.suit === parsed[0].suit) && runFits(parsed.map((p) => RANK_NUM[p.rank!]), cards.length)) {
      return "pure";
    }
  }
  const naturals = cards.filter((c) => !isJokerCard(c, wildRank)).map(parseCard);
  if (naturals.length === 0) return "impure";
  if (naturals.every((p) => p.suit === naturals[0].suit) && runFits(naturals.map((p) => RANK_NUM[p.rank!]), cards.length)) {
    return "impure";
  }
  if (
    cards.length <= 4 &&
    naturals.every((p) => p.rank === naturals[0].rank) &&
    new Set(naturals.map((p) => p.suit)).size === naturals.length
  ) {
    return "set";
  }
  return null;
}

export const isSequenceKind = (k: MeldKind | null) => k === "pure" || k === "impure";

export interface DeclarationCheck {
  valid: boolean;
  /** Short player-facing reason when invalid. */
  reason: string | null;
  kinds: (MeldKind | null)[];
  pure: number;
  sequences: number;
}

/** Is this arrangement a valid declaration: all groups valid, ≥ 2 sequences, ≥ 1 pure. */
export function checkDeclaration(groups: readonly (readonly Card[])[], wildRank: Rank | null): DeclarationCheck {
  const kinds = groups.map((g) => classifyGroup(g, wildRank));
  const pure = kinds.filter((k) => k === "pure").length;
  const sequences = kinds.filter(isSequenceKind).length;
  let reason: string | null = null;
  if (groups.length === 0) reason = "No cards to declare";
  else if (kinds.some((k) => k === null)) reason = "Every group must be a sequence or a set";
  else if (pure < 1) reason = "You need a pure sequence (no jokers)";
  else if (sequences < 2) reason = "You need at least two sequences";
  return { valid: reason === null, reason, kinds, pure, sequences };
}

/**
 * Points of an arrangement as it stands: when its valid groups include ≥ 1 pure and ≥ 2 sequences,
 * the cards in invalid groups count; otherwise every card counts (full count). Not capped.
 */
export function groupingPoints(groups: readonly (readonly Card[])[], wildRank: Rank | null): number {
  const check = checkDeclaration(groups, wildRank);
  const all = groups.flat();
  if (check.pure < 1 || check.sequences < 2) return fullCount(all, wildRank);
  return groups.reduce((s, g, i) => s + (check.kinds[i] === null ? fullCount(g, wildRank) : 0), 0);
}

// ---------------------------------------------------------------------------
// Arrangement helpers
// ---------------------------------------------------------------------------

/** "7H,8H,9H|KS,KD#2,KC" */
export function encodeGroups(groups: readonly (readonly Card[])[]): string {
  return groups.map((g) => g.join(",")).join("|");
}

/** Inverse of encodeGroups. Returns null on malformed text (empty groups, bad cards). */
export function decodeGroups(text: string): Card[][] | null {
  if (typeof text !== "string" || text.length === 0 || text.length > 2000) return null;
  const groups = text.split("|").map((g) => g.split(","));
  for (const g of groups) {
    for (const c of g) {
      try {
        parseCard(c);
      } catch {
        return null;
      }
    }
  }
  return groups;
}

/** True when `groups` uses exactly the cards of `hand` (as a multiset) and has no empty group. */
export function isArrangementOf(groups: readonly (readonly Card[])[], hand: readonly Card[]): boolean {
  if (groups.some((g) => g.length === 0)) return false;
  const flat = groups.flat();
  if (flat.length !== hand.length) return false;
  const a = flat.slice().sort(), b = hand.slice().sort();
  return a.every((c, i) => c === b[i]);
}

/** One group per suit (♠ ♥ ♣ ♦, ranks ascending, ace high), then printed jokers. Empty suits omitted. */
export function sortBySuit(cards: readonly Card[]): Card[][] {
  const sorted = sortCards(cards, "suit");
  const out: Card[][] = [];
  for (const s of DISPLAY_SUIT_ORDER) {
    const g = sorted.filter((c) => !isPrintedJoker(c) && parseCard(c).suit === s);
    if (g.length) out.push(g);
  }
  const jokers = sorted.filter(isPrintedJoker);
  if (jokers.length) out.push(jokers);
  return out;
}

/** Sort a meld for display: sequences in rank order (ace low when the run is A-2-3…), sets by suit, jokers last. */
export function sortGroup(cards: readonly Card[], wildRank: Rank | null): Card[] {
  const kind = classifyGroup(cards, wildRank);
  if (kind === "pure") {
    const vals = cards.map((c) => RANK_NUM[parseCard(c).rank!]);
    const aceLow = vals.includes(14) && vals.includes(2);
    return sortCards(cards, "rank", { aceLow });
  }
  const nat = cards.filter((c) => !isJokerCard(c, wildRank));
  const jok = cards.filter((c) => isJokerCard(c, wildRank));
  const vals = nat.map((c) => RANK_NUM[parseCard(c).rank!]);
  const aceLow = vals.includes(14) && vals.some((v) => v <= 5);
  return [...sortCards(nat, "rank", { aceLow }), ...jok];
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

export interface Penalty {
  /** Added when the hand has no pure sequence. */
  noPure: number;
  /** Added per missing sequence below two. */
  perMissingSeq: number;
}

const BIG = 1_000_000;
/** Requirement must hold (cost ≥ BIG when impossible). */
export const STRICT: Penalty = { noPure: BIG, perMissingSeq: BIG };
/** Bot / auto-group heuristic: still 0 exactly when the hand is declarable. */
export const BOT_PENALTY: Penalty = { noPure: 30, perMissingSeq: 15 };
/** Plain minimum deadwood, ignoring the sequence requirement. */
export const NO_PENALTY: Penalty = { noPure: 0, perMissingSeq: 0 };

export interface SolvedMeld {
  cards: Card[];
  kind: MeldKind;
}

export interface SolveResult {
  /** Deadwood points + penalties. 0 exactly when the hand is a valid declaration. */
  cost: number;
  /** Points of the unmatched cards (no penalty, no full count). */
  deadwood: number;
  melds: SolvedMeld[];
  unmatched: Card[];
  pure: number;
  sequences: number;
  /** Arrangement: melds (sorted) then one group of unmatched cards. Every hand card exactly once. */
  groups: Card[][];
}

interface Item {
  card: Card;
  suit: Suit;
  v: number;
  wild: boolean;
  pts: number;
}

interface Meld {
  mask: number;
  jokers: number;
  wildNat: number;
  pure: boolean;
  seq: boolean;
}

/** Minimise deadwood + penalty over all ways to split `hand` into melds. */
export function solveHand(hand: readonly Card[], wildRank: Rank | null, penalty: Penalty): SolveResult {
  const printed = hand.filter(isPrintedJoker);
  const P = printed.length;
  const items: Item[] = hand
    .filter((c) => !isPrintedJoker(c))
    .map((card) => {
      const p = parseCard(card);
      return { card, suit: p.suit!, v: RANK_NUM[p.rank!], wild: p.rank === wildRank, pts: cardPoints(card, wildRank) };
    })
    .sort((a, b) => a.suit.localeCompare(b.suit) || a.v - b.v || a.card.localeCompare(b.card));
  const n = items.length;
  const W = items.filter((i) => i.wild).length;
  const FULL = (1 << n) - 1;

  const memo = new Map<number, number>();
  const choice = new Map<number, { kind: "dead" | "joker" } | { kind: "meld"; meld: Meld }>();

  const keyOf = (mask: number, ju: number, wn: number, p: number, q: number) => (((mask * 16 + ju) * 16 + wn) * 2 + p) * 3 + q;

  const meldsFor = (i: number, mask: number, avail: number): Meld[] => {
    const it = items[i];
    const out: Meld[] = [];
    const seen = new Set<string>();
    const push = (m: Meld) => {
      const k = `${m.mask}:${m.jokers}:${m.seq ? 1 : 0}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(m);
    };
    // Sets (natural first item only; a lone card + 2 jokers is better as a sequence).
    if (!it.wild) {
      const others: number[] = [];
      const usedSuits = new Set<Suit>([it.suit]);
      for (let j = i + 1; j < n; j++) {
        const o = items[j];
        if (mask & (1 << j) || o.wild || o.v !== it.v || usedSuits.has(o.suit)) continue;
        usedSuits.add(o.suit);
        others.push(j);
      }
      for (let sub = 1; sub < 1 << others.length; sub++) {
        let m = 1 << i, cnt = 1;
        others.forEach((j, k) => {
          if (sub & (1 << k)) {
            m |= 1 << j;
            cnt++;
          }
        });
        const jokers = Math.max(0, 3 - cnt);
        if (jokers <= avail) push({ mask: m, jokers, wildNat: 0, pure: false, seq: false });
      }
    }
    // Sequences in it.suit containing item i.
    const nat = new Array<number>(15).fill(-1);
    const wnat = new Array<number>(15).fill(-1);
    for (let j = i + 1; j < n; j++) {
      const o = items[j];
      if (mask & (1 << j) || o.suit !== it.suit) continue;
      const arr = o.wild ? wnat : nat;
      for (const v of o.v === 14 ? [1, 14] : [o.v]) if (arr[v] < 0) arr[v] = j;
    }
    const pureOnly = it.wild;
    for (const high of [false, true]) {
      const lo = high ? 2 : 1, hi = high ? 14 : 13;
      const cv = it.v === 14 ? (high ? 14 : 1) : it.v;
      for (let a = Math.max(lo, cv - 12); a <= cv; a++) {
        for (let b = Math.max(cv, a + 2); b <= Math.min(hi, a + 12); b++) {
          if (high && b !== 14) continue; // windows inside 2..13 are covered by the low pass
          const L = b - a + 1;
          const rec = (pos: number, m: number, jokers: number, wildNat: number) => {
            if (jokers + wildNat > avail) return;
            if (pos > b) {
              if (jokers > 0 && (wildNat > 0 || pureOnly)) return;
              push({ mask: m, jokers, wildNat, pure: jokers === 0, seq: true });
              return;
            }
            if (pos === cv) return rec(pos + 1, m, jokers, wildNat);
            if (nat[pos] >= 0) rec(pos + 1, m | (1 << nat[pos]), jokers, wildNat);
            if (wnat[pos] >= 0) rec(pos + 1, m | (1 << wnat[pos]), jokers, wildNat + 1);
            if (!pureOnly && (L === 3 || (pos !== a && pos !== b))) rec(pos + 1, m, jokers + 1, wildNat);
          };
          rec(a, 1 << i, 0, it.wild ? 1 : 0);
        }
      }
    }
    return out;
  };

  const terminal = (ju: number, wn: number, p: number, q: number) => {
    const leftover = P + W - wn - ju;
    const q2 = Math.min(2, q + Math.floor(leftover / 3));
    return (p ? 0 : penalty.noPure) + (q2 >= 2 ? 0 : penalty.perMissingSeq * (2 - q2));
  };

  const f = (mask: number, ju: number, wn: number, p: number, q: number): number => {
    const key = keyOf(mask, ju, wn, p, q);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let i = 0;
    while (i < n && mask & (1 << i)) i++;
    if (i === n) {
      const t = terminal(ju, wn, p, q);
      memo.set(key, t);
      return t;
    }
    const it = items[i];
    let best: number;
    let pick: { kind: "dead" | "joker" } | { kind: "meld"; meld: Meld };
    if (it.wild) {
      best = f(mask | (1 << i), ju, wn, p, q);
      pick = { kind: "joker" };
    } else {
      best = it.pts + f(mask | (1 << i), ju, wn, p, q);
      pick = { kind: "dead" };
    }
    const avail = P + W - wn - ju;
    for (const m of meldsFor(i, mask, avail)) {
      const nwn = wn + m.wildNat, nju = ju + m.jokers;
      if (nju > P + W - nwn) continue;
      const cost = f(mask | m.mask, nju, nwn, p || (m.pure ? 1 : 0), Math.min(2, q + (m.seq ? 1 : 0)));
      if (cost < best) {
        best = cost;
        pick = { kind: "meld", meld: m };
      }
    }
    memo.set(key, best);
    choice.set(key, pick);
    return best;
  };

  const cost = f(0, 0, 0, 0, 0);

  // Reconstruct.
  let mask = 0, ju = 0, wn = 0, p = 0, q = 0;
  const rawMelds: { items: number[]; jokers: number; pure: boolean; seq: boolean }[] = [];
  const dead: Card[] = [];
  const jokerPool: Card[] = [...printed];
  while (mask !== FULL) {
    const key = keyOf(mask, ju, wn, p, q);
    const c = choice.get(key)!;
    let i = 0;
    while (mask & (1 << i)) i++;
    if (c.kind === "dead") {
      dead.push(items[i].card);
      mask |= 1 << i;
    } else if (c.kind === "joker") {
      jokerPool.push(items[i].card);
      mask |= 1 << i;
    } else {
      const m = c.meld;
      const idx: number[] = [];
      for (let j = 0; j < n; j++) if (m.mask & (1 << j)) idx.push(j);
      rawMelds.push({ items: idx, jokers: m.jokers, pure: m.pure, seq: m.seq });
      mask |= m.mask;
      ju += m.jokers;
      wn += m.wildNat;
      p = p || (m.pure ? 1 : 0);
      q = Math.min(2, q + (m.seq ? 1 : 0));
    }
  }
  const melds: Card[][] = rawMelds.map((m) => [...m.items.map((j) => items[j].card), ...jokerPool.splice(0, m.jokers)]);
  // Leftover jokers: joker-only sequences if still needed, then attach to existing melds.
  let seqs = rawMelds.filter((m) => m.seq).length;
  while (seqs < 2 && jokerPool.length >= 3) {
    melds.push(jokerPool.splice(0, 3));
    seqs++;
  }
  const unmatched = [...dead];
  for (const j of jokerPool) {
    const kinds = melds.map((g) => classifyGroup(g, wildRank));
    const pureCount = kinds.filter((k) => k === "pure").length;
    const order = [
      ...kinds.map((k, i) => (k === "impure" ? i : -1)),
      ...kinds.map((k, i) => (k === "pure" && pureCount >= 2 ? i : -1)),
      ...kinds.map((k, i) => (k === "set" ? i : -1)),
    ].filter((i) => i >= 0);
    const target = order.find((i) => {
      const before = kinds[i];
      const after = classifyGroup([...melds[i], j], wildRank);
      return after !== null && (isSequenceKind(before) ? isSequenceKind(after) : true);
    });
    if (target === undefined) unmatched.push(j);
    else melds[target].push(j);
  }
  const solved: SolvedMeld[] = melds.map((g) => ({ cards: sortGroup(g, wildRank), kind: classifyGroup(g, wildRank)! }));
  const groups = solved.map((m) => m.cards);
  if (unmatched.length) groups.push(sortCards(unmatched, "suit"));
  return {
    cost,
    deadwood: fullCount(unmatched, wildRank),
    melds: solved,
    unmatched,
    pure: solved.filter((m) => m.kind === "pure").length,
    sequences: solved.filter((m) => isSequenceKind(m.kind)).length,
    groups,
  };
}

export interface BestGrouping {
  /** Arrangement to show (melds, then unmatched cards). */
  groups: Card[][];
  melds: SolvedMeld[];
  unmatched: Card[];
  /** True when ≥ 1 pure and ≥ 2 sequences are possible (only unmatched cards count). */
  qualified: boolean;
  /** Minimum deadwood when qualified, otherwise the full count of every card. Not capped. */
  points: number;
}

/** Minimum-points arrangement used to score a losing hand. */
export function bestGrouping(hand: readonly Card[], wildRank: Rank | null): BestGrouping {
  const strict = solveHand(hand, wildRank, STRICT);
  if (strict.cost < BIG) {
    return { groups: strict.groups, melds: strict.melds, unmatched: strict.unmatched, qualified: true, points: strict.cost };
  }
  const soft = solveHand(hand, wildRank, BOT_PENALTY);
  return { groups: soft.groups, melds: soft.melds, unmatched: soft.unmatched, qualified: false, points: fullCount(hand, wildRank) };
}

/** Points a losing hand scores (before the cap). */
export function handPoints(hand: readonly Card[], wildRank: Rank | null): number {
  return bestGrouping(hand, wildRank).points;
}

/** True when the cards can be arranged as a valid declaration. */
export function canDeclare(hand: readonly Card[], wildRank: Rank | null): boolean {
  return solveHand(hand, wildRank, STRICT).cost === 0;
}

export interface DiscardPlan {
  /** Card to throw. */
  discard: Card;
  /** Heuristic cost of the remaining hand (0 = declarable). */
  cost: number;
  /** Arrangement of the remaining hand. */
  groups: Card[][];
}

/**
 * For a hand of handSize + 1 cards: which card to throw (never one of `keep`), scored by BOT_PENALTY.
 * Ties prefer throwing the higher-value card, then the earlier card in sorted order (deterministic).
 */
export function planDiscard(hand: readonly Card[], wildRank: Rank | null, keep: readonly Card[] = []): DiscardPlan {
  let best: DiscardPlan | null = null;
  let bestPts = -1;
  const seen = new Set<string>();
  for (const c of sortCards(hand, "suit")) {
    if (keep.includes(c)) continue;
    const face = c.split("#")[0];
    if (seen.has(face)) continue; // copies are interchangeable
    seen.add(face);
    const rest = hand.slice();
    rest.splice(rest.indexOf(c), 1);
    const r = solveHand(rest, wildRank, BOT_PENALTY);
    const pts = cardPoints(c, wildRank);
    if (!best || r.cost < best.cost || (r.cost === best.cost && pts > bestPts)) {
      best = { discard: c, cost: r.cost, groups: r.groups };
      bestPts = pts;
    }
  }
  if (!best) throw new Error("planDiscard: nothing to discard");
  return best;
}
