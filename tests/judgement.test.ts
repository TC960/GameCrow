/**
 * Judgement rules tests, written from SPEC.md, ENGINE_CONTRACT.md, games/judgement/BRIEF.md and
 * games/judgement/types.ts (not from rules.ts).
 *
 * Conventions used here (from types.ts): the first dealer is seat 0 (p0) and the dealer moves one seat
 * clockwise each round; bidding starts left of the dealer and the dealer bids last; the player left of
 * the dealer leads trick 1.
 */
import { describe, expect, it } from "vitest";
import plugin from "../games/judgement/rules";
import type { Action, RoundResult, Settings, State, View } from "../games/judgement/types";
import { HURRY_MS } from "../games/judgement/types";
import { createHarness, simulateGame, findLeaks, assertJsonSafe, makePlayers, type Harness } from "../engine/testing";
import { startProblem, startMatch, buildView } from "../engine/match";
import { lintSchema } from "../engine/settings";
import { createRng } from "../engine/rng";
import { isValidCard, type Card, type PlayerId, type SettingField } from "../engine";

type H = Harness<State, Action, View>;

const BASE: Partial<Settings> = { turnTimer: 0 };

function mk(players: number, settings: Partial<Settings> = {}, seed = 1, host?: PlayerId): H {
  return createHarness<State, Action, View>(plugin, { players, settings: { ...BASE, ...settings }, seed, host });
}

const ids = (n: number) => makePlayers(n).map((p) => p.id);
/** +0 instead of -0 so toBe/toEqual comparisons do not trip over negative zero. */
const z = (x: number) => x + 0;

function legalBids(h: H, id: PlayerId): number[] {
  return h
    .legal(id)
    .filter((a): a is Extract<Action, { type: "bid" }> => a.type === "bid")
    .map((a) => a.bid)
    .sort((a, b) => a - b);
}
function legalCards(h: H, id: PlayerId): Card[] {
  return h
    .legal(id)
    .filter((a): a is Extract<Action, { type: "play" }> => a.type === "play")
    .map((a) => a.card)
    .sort();
}
function gameActions(h: H, id: PlayerId): Action[] {
  return h.legal(id).filter((a) => a.type === "bid" || a.type === "play");
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The current turn player makes their first legal bid/play. */
function autoStep(h: H): void {
  const turn = h.state.turn;
  expect(turn).not.toBeNull();
  const acts = gameActions(h, turn!);
  expect(acts.length).toBeGreaterThan(0);
  h.act(turn!, acts[0]);
}
/** Play the current round to its end (summary or over) with first-legal moves. */
function finishRound(h: H): void {
  let guard = 0;
  while (h.state.phase === "bidding" || h.state.phase === "playing") {
    if (guard++ > 1000) throw new Error("round did not finish");
    autoStep(h);
  }
}
/** Bid for everyone in bidding order. */
function bidAll(h: H, bids: Record<PlayerId, number>): void {
  for (const id of h.state.bidOrder) h.act(id, { type: "bid", bid: bids[id] });
}
/** Replace the hands at the start of a round (phase "bidding", no bids yet). */
function withHands(h: H, hands: Record<PlayerId, Card[]>, extra: Partial<State> = {}): void {
  expect(h.state.phase).toBe("bidding");
  h.setState({ ...h.state, hands, ...extra });
}
function play(h: H, id: PlayerId, card: Card): void {
  h.act(id, { type: "play", card });
}

// Deal 1: 3 players, 3 cards, trump Spades, dealer p0, bid order p1, p2, p0; p1 leads.
const DEAL1: Record<PlayerId, Card[]> = {
  p1: ["5H", "9C", "3D"],
  p2: ["KH", "2H", "4C"],
  p0: ["AS", "AD", "AC"],
};
/**
 * Bids p1=1, p2=0, p0=3 (total 4, the forbidden dealer bid was 2).
 * Trick 1: 5H 2H AC -> p1 (off-suit ace never wins). Trick 2: 9C 4C AS -> p0 (trump).
 * Trick 3: AD 3D KH -> p0. Won: p1 1, p2 0, p0 2.
 */
function playDeal1(h: H): void {
  withHands(h, DEAL1);
  bidAll(h, { p1: 1, p2: 0, p0: 3 });
  play(h, "p1", "5H");
  play(h, "p2", "2H");
  play(h, "p0", "AC");
  play(h, "p1", "9C");
  play(h, "p2", "4C");
  play(h, "p0", "AS");
  play(h, "p0", "AD");
  play(h, "p1", "3D");
  play(h, "p2", "KH");
}

// ---------------------------------------------------------------------------

describe("judgement: meta and house-rule schema", () => {
  it("has the right meta and player range", () => {
    expect(plugin.meta.id).toBe("judgement");
    expect(plugin.meta.minPlayers).toBe(3);
    expect(plugin.meta.maxPlayers).toBe(8);
    expect(plugin.meta.howToPlay.length).toBeGreaterThanOrEqual(3);
    expect(plugin.meta.howToPlay.length).toBeLessThanOrEqual(6);
  });

  it("declares every brief setting with the stated default", () => {
    expect(lintSchema(plugin.settings)).toEqual([]);
    const f = (key: string) => plugin.settings.find((s: SettingField) => s.key === key);
    const startCards = f("startCards");
    expect(startCards).toMatchObject({ type: "number", default: 7, min: 1, max: 13 });
    const seq = f("sequence");
    expect(seq).toMatchObject({ type: "select", default: "down" });
    expect((seq as { options: { value: string }[] }).options.map((o) => o.value).sort()).toEqual(["down", "downUp", "up"]);
    expect(f("noTrump")).toMatchObject({ type: "boolean", default: false });
    expect(f("lastBidderRule")).toMatchObject({ type: "boolean", default: true });
    expect(f("mustTrumpWhenVoid")).toMatchObject({ type: "boolean", default: false });
    expect(f("exactBonus")).toMatchObject({ type: "number", default: 10 });
    expect(f("perTrick")).toMatchObject({ type: "number", default: 1 });
    const miss = f("missPenalty");
    expect(miss).toMatchObject({ type: "select", default: "zero" });
    expect((miss as { options: { value: string }[] }).options.map((o) => o.value).sort()).toEqual(
      ["minusBid", "minusDiff", "zero"],
    );
  });
});

describe("judgement: validateSettings", () => {
  it("blocks startCards x players > 52", () => {
    expect(startProblem(plugin, makePlayers(8), { startCards: 7 })).toEqual(expect.any(String));
    expect(startProblem(plugin, makePlayers(5), { startCards: 11 })).toEqual(expect.any(String));
    expect(startProblem(plugin, makePlayers(4), { startCards: 13 })).toBeNull(); // 52 exactly is fine
    expect(startProblem(plugin, makePlayers(8), { startCards: 6 })).toBeNull(); // 48
    expect(startProblem(plugin, makePlayers(7), { startCards: 7 })).toBeNull(); // 49
    expect(startProblem(plugin, makePlayers(3), { startCards: 13 })).toBeNull();
    expect(startProblem(plugin, makePlayers(6), { startCards: 9 })).toEqual(expect.any(String)); // 54
  });

  it("the engine refuses to start a blocked game", () => {
    expect(() => mk(8, { startCards: 7 })).toThrow();
    expect(() => mk(4, { startCards: 13 })).not.toThrow();
  });

  it("enforces 3..8 players", () => {
    expect(startProblem(plugin, makePlayers(2), { startCards: 3 })).toEqual(expect.any(String));
    expect(startProblem(plugin, makePlayers(9), { startCards: 3 })).toEqual(expect.any(String));
  });
});

describe("judgement: setup", () => {
  it.each([3, 4, 5, 7])("deals startCards to each of %i players from one deck", (n) => {
    const h = mk(n, {}, 11);
    const s = h.state;
    expect(s.order).toEqual(ids(n));
    expect(s.phase).toBe("bidding");
    expect(s.round).toBe(1);
    expect(s.handSize).toBe(7);
    const all = ids(n).flatMap((id) => s.hands[id]);
    for (const id of ids(n)) expect(s.hands[id]).toHaveLength(7);
    expect(new Set(all).size).toBe(7 * n);
    expect(all.every(isValidCard)).toBe(true);
    expect(all.every((c) => !c.includes("#") && !c.startsWith("X"))).toBe(true);
    for (const id of ids(n)) {
      expect(s.bids[id]).toBeNull();
      expect(s.tricksWon[id]).toBe(0);
      expect(s.totals[id]).toBe(0);
    }
    expect(s.history).toEqual([]);
    expect(s.trick).toEqual([]);
    expect(s.lastTrick).toBeNull();
    expect(s.tricksPlayed).toBe(0);
  });

  it("round 1: trump Spades, dealer p0, p1 bids first, dealer bids last", () => {
    const h = mk(4);
    expect(h.state.trump).toBe("S");
    expect(h.state.dealer).toBe("p0");
    expect(h.state.bidOrder).toEqual(["p1", "p2", "p3", "p0"]);
    expect(h.state.turn).toBe("p1");
    expect(plugin.activePlayers(h.state)).toEqual(["p1"]);
    expect(h.match.over).toBe(false);
    const sc = plugin.scores(h.state);
    expect(sc).toHaveLength(4);
    expect(sc.every((l) => l.score === 0 && l.rank === 1)).toBe(true);
  });

  it("view at setup shows only my hand (sorted) plus public counts", () => {
    const h = mk(4, {}, 5);
    const v = h.view("p2");
    expect(v.phase).toBe("bidding");
    expect(v.round).toBe(1);
    expect(v.handSize).toBe(7);
    expect(v.trump).toBe("S");
    expect(v.dealer).toBe("p0");
    expect(v.turn).toBe("p1");
    expect(v.order).toEqual(ids(4));
    expect(v.bidOrder).toEqual(["p1", "p2", "p3", "p0"]);
    expect(v.myHand.slice().sort()).toEqual(h.state.hands.p2.slice().sort());
    expect(v.handCounts).toEqual({ p0: 7, p1: 7, p2: 7, p3: 7 });
    expect(v.bidTotal).toBe(0);
    expect(v.totalRounds).toBe(7);
    expect(v.handSizes).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(v.lastRound).toBeNull();
    expect(h.view(null).myHand).toEqual([]);
  });

  it("is deterministic for a seed and varies across seeds", () => {
    expect(startMatch(plugin, makePlayers(5), BASE, 42, 0).state).toEqual(startMatch(plugin, makePlayers(5), BASE, 42, 0).state);
    const a = startMatch(plugin, makePlayers(5), BASE, 1, 0).state as State;
    const b = startMatch(plugin, makePlayers(5), BASE, 2, 0).state as State;
    expect(a.hands).not.toEqual(b.hands);
  });
});

describe("judgement: hand-size sequences, trump and dealer rotation", () => {
  /** Plays every round with first-legal moves and records per-round state at round start. */
  function walk(n: number, settings: Partial<Settings>) {
    const h = mk(n, settings, 3);
    const rounds: { round: number; handSize: number; trump: string | null; dealer: string; bidOrder: string[]; firstTurn: string | null; leader: string | null; counts: number[] }[] = [];
    let guard = 0;
    while (!h.match.over) {
      if (guard++ > 100) throw new Error("too many rounds");
      const s = h.state;
      expect(s.phase).toBe("bidding");
      const all = s.order.flatMap((id) => s.hands[id]);
      expect(new Set(all).size).toBe(all.length);
      const entry = {
        round: s.round,
        handSize: s.handSize,
        trump: s.trump,
        dealer: s.dealer,
        bidOrder: s.bidOrder,
        firstTurn: s.turn,
        leader: null as string | null,
        counts: s.order.map((id) => s.hands[id].length),
      };
      expect(h.view("p1").trump).toBe(s.trump);
      // Bid everyone, then record who leads trick 1.
      while (h.state.phase === "bidding") autoStep(h);
      entry.leader = h.state.turn;
      expect(h.state.leader === null || h.state.leader === h.state.turn).toBe(true);
      rounds.push(entry);
      finishRound(h);
      if (h.state.phase === "summary") h.act(h.host, { type: "nextRound" });
    }
    return { h, rounds };
  }

  it("down (default): 7,6,...,1 = 7 rounds", () => {
    const { rounds, h } = walk(4, {});
    expect(rounds.map((r) => r.handSize)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(rounds.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const r of rounds) expect(r.counts).toEqual([r.handSize, r.handSize, r.handSize, r.handSize]);
    expect(h.state.handSizes).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(h.state.history).toHaveLength(7);
  });

  it("downUp: 7..1..7 with 1 played once = 13 rounds", () => {
    const { rounds, h } = walk(3, { sequence: "downUp" });
    expect(rounds.map((r) => r.handSize)).toEqual([7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
    expect(h.view("p0").totalRounds).toBe(13);
  });

  it("up: 1..startCards", () => {
    const { rounds } = walk(3, { sequence: "up", startCards: 5 });
    expect(rounds.map((r) => r.handSize)).toEqual([1, 2, 3, 4, 5]);
  });

  it("startCards changes the biggest round", () => {
    const { rounds } = walk(5, { startCards: 4 });
    expect(rounds.map((r) => r.handSize)).toEqual([4, 3, 2, 1]);
    const h = mk(4, { startCards: 13 });
    expect(h.state.handSize).toBe(13);
    expect(h.state.handSizes).toHaveLength(13);
  });

  it("trump rotates Spades, Diamonds, Clubs, Hearts", () => {
    const { rounds } = walk(3, { sequence: "downUp" });
    expect(rounds.map((r) => r.trump)).toEqual(["S", "D", "C", "H", "S", "D", "C", "H", "S", "D", "C", "H", "S"]);
  });

  it("noTrump adds a no-trump round after Hearts", () => {
    const { rounds, h } = walk(3, { sequence: "downUp", noTrump: true });
    expect(rounds.map((r) => r.trump)).toEqual(["S", "D", "C", "H", null, "S", "D", "C", "H", null, "S", "D", "C"]);
    expect(h.state.history.map((r) => r.trump)).toEqual(rounds.map((r) => r.trump));
  });

  it("dealer rotates clockwise; left of dealer bids first and leads; dealer bids last", () => {
    const n = 5;
    const { rounds } = walk(n, { startCards: 7 });
    const order = ids(n);
    rounds.forEach((r, i) => {
      const d = i % n;
      expect(r.dealer).toBe(order[d]);
      const expectedBidOrder = range(1, n).map((k) => order[(d + k) % n]);
      expect(r.bidOrder).toEqual(expectedBidOrder);
      expect(r.bidOrder[n - 1]).toBe(r.dealer);
      expect(r.firstTurn).toBe(order[(d + 1) % n]);
      expect(r.leader).toBe(order[(d + 1) % n]);
    });
  });
});

describe("judgement: bidding", () => {
  it("only the current bidder may bid, in order, 0..handSize", () => {
    const h = mk(4);
    expect(legalBids(h, "p1")).toEqual(range(0, 7));
    for (const id of ["p0", "p2", "p3"]) expect(legalBids(h, id)).toEqual([]);
    expect(h.tryAct("p2", { type: "bid", bid: 1 })).not.toBeNull();
    expect(h.tryAct("p0", { type: "bid", bid: 1 })).not.toBeNull();
    expect(h.tryAct("p1", { type: "bid", bid: 8 })).not.toBeNull();
    expect(h.tryAct("p1", { type: "bid", bid: -1 })).not.toBeNull();
    expect(h.tryAct("p1", { type: "bid", bid: 1.5 })).not.toBeNull();
    expect(h.tryAct("p1", { type: "play", card: h.state.hands.p1[0] })).not.toBeNull();
    h.act("p1", { type: "bid", bid: 3 });
    expect(h.tryAct("p1", { type: "bid", bid: 3 })).not.toBeNull(); // no second bid
    expect(h.state.turn).toBe("p2");
    expect(plugin.activePlayers(h.state)).toEqual(["p2"]);
    expect(legalBids(h, "p2")).toEqual(range(0, 7));
    h.act("p2", { type: "bid", bid: 0 });
    h.act("p3", { type: "bid", bid: 7 });
    expect(h.state.turn).toBe("p0");
  });

  it("bids are public as they happen (players and spectators)", () => {
    const h = mk(4);
    h.act("p1", { type: "bid", bid: 2 });
    h.act("p2", { type: "bid", bid: 0 });
    for (const viewer of ["p0", "p1", "p2", "p3", null]) {
      const v = h.view(viewer);
      expect(v.bids).toEqual({ p0: null, p1: 2, p2: 0, p3: null });
      expect(v.bidTotal).toBe(2);
      expect(v.turn).toBe("p3");
    }
  });

  it("last-bidder rule forbids exactly the bid that makes total = hand size", () => {
    const h = mk(4);
    h.act("p1", { type: "bid", bid: 2 });
    h.act("p2", { type: "bid", bid: 2 });
    // Not the last bidder: no restriction.
    expect(legalBids(h, "p3")).toEqual(range(0, 7));
    expect(h.view("p3").forbiddenBid).toBeNull();
    h.act("p3", { type: "bid", bid: 1 });
    // Total 5 of 7: dealer may not bid 2.
    expect(legalBids(h, "p0")).toEqual([0, 1, 3, 4, 5, 6, 7]);
    for (const viewer of ["p0", "p1", null]) expect(h.view(viewer).forbiddenBid).toBe(2);
    expect(h.tryAct("p0", { type: "bid", bid: 2 })).not.toBeNull();
    h.act("p0", { type: "bid", bid: 3 });
    expect(h.state.phase).toBe("playing");
  });

  it("last-bidder rule: when the others already total the hand size, the dealer may not bid 0", () => {
    const h = mk(3, { startCards: 3 });
    h.act("p1", { type: "bid", bid: 2 });
    h.act("p2", { type: "bid", bid: 1 });
    expect(legalBids(h, "p0")).toEqual([1, 2, 3]);
    expect(h.view("p2").forbiddenBid).toBe(0);
  });

  it("last-bidder rule: when the forbidden value is out of range every bid is allowed", () => {
    const h = mk(4);
    h.act("p1", { type: "bid", bid: 3 });
    h.act("p2", { type: "bid", bid: 3 });
    h.act("p3", { type: "bid", bid: 3 }); // total 9 > 7, "forbidden" would be -2
    expect(legalBids(h, "p0")).toEqual(range(0, 7));
    const fb = h.view("p0").forbiddenBid;
    expect(fb === null || fb < 0 || fb > 7).toBe(true);
  });

  it("last-bidder rule: one card, two zero bids -> dealer must bid 0", () => {
    // 3 players, 1 card: p1 0, p2 0 -> dealer may not bid 1.
    const h = mk(3, { startCards: 1 });
    h.act("p1", { type: "bid", bid: 0 });
    h.act("p2", { type: "bid", bid: 0 });
    expect(legalBids(h, "p0")).toEqual([0]);
  });

  it("last-bidder rule off: dealer may bid anything", () => {
    const h = mk(4, { lastBidderRule: false });
    h.act("p1", { type: "bid", bid: 2 });
    h.act("p2", { type: "bid", bid: 2 });
    h.act("p3", { type: "bid", bid: 1 });
    expect(legalBids(h, "p0")).toEqual(range(0, 7));
    expect(h.view("p0").forbiddenBid).toBeNull();
    h.act("p0", { type: "bid", bid: 2 });
    expect(h.state.phase).toBe("playing");
    expect(h.state.bids).toEqual({ p0: 2, p1: 2, p2: 2, p3: 1 });
  });

  it("the last-bidder rule follows the dealer in later rounds", () => {
    const h = mk(3, { startCards: 3 });
    finishRound(h);
    h.act("p0", { type: "nextRound" });
    // Round 2: 2 cards, dealer p1, order p2, p0, p1.
    expect(h.state.dealer).toBe("p1");
    expect(h.state.turn).toBe("p2");
    h.act("p2", { type: "bid", bid: 1 });
    expect(legalBids(h, "p0")).toEqual([0, 1, 2]);
    h.act("p0", { type: "bid", bid: 0 });
    expect(legalBids(h, "p1")).toEqual([0, 2]);
  });

  it("after the last bid, play starts with the player left of the dealer", () => {
    const h = mk(4);
    bidAll(h, { p1: 1, p2: 1, p3: 1, p0: 1 });
    expect(h.state.phase).toBe("playing");
    expect(h.state.turn).toBe("p1");
    expect(h.view("p3").turn).toBe("p1");
    expect(plugin.activePlayers(h.state)).toEqual(["p1"]);
    expect(legalCards(h, "p1")).toEqual(h.state.hands.p1.slice().sort()); // leader may lead anything
    for (const id of ["p0", "p2", "p3"]) expect(legalCards(h, id)).toEqual([]);
    expect(h.tryAct("p1", { type: "bid", bid: 1 })).not.toBeNull();
  });
});

describe("judgement: playing tricks", () => {
  it("must follow suit; void -> any card; off-suit non-trump never wins; winner leads next", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, DEAL1);
    bidAll(h, { p1: 1, p2: 0, p0: 3 });
    expect(h.state.turn).toBe("p1");
    // Out of turn / not held.
    expect(h.tryAct("p2", { type: "play", card: "KH" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "play", card: "KH" })).not.toBeNull();
    play(h, "p1", "5H");
    let v = h.view("p0");
    expect(v.trick).toEqual([{ player: "p1", card: "5H" }]);
    expect(v.ledSuit).toBe("H");
    expect(v.leader).toBe("p1");
    expect(v.handCounts).toEqual({ p0: 3, p1: 2, p2: 3 });
    // p2 holds hearts: must follow.
    expect(legalCards(h, "p2")).toEqual(["2H", "KH"]);
    expect(h.tryAct("p2", { type: "play", card: "4C" })).not.toBeNull();
    play(h, "p2", "2H");
    // p0 has no hearts: any card.
    expect(legalCards(h, "p0")).toEqual(["AC", "AD", "AS"]);
    play(h, "p0", "AC");
    // 5H wins: the off-suit ace does not.
    expect(h.state.tricksWon).toEqual({ p0: 0, p1: 1, p2: 0 });
    expect(h.state.tricksPlayed).toBe(1);
    expect(h.state.trick).toEqual([]);
    expect(h.state.turn).toBe("p1");
    v = h.view("p2");
    expect(v.lastTrick).toEqual({
      plays: [
        { player: "p1", card: "5H" },
        { player: "p2", card: "2H" },
        { player: "p0", card: "AC" },
      ],
      winner: "p1",
      winningCard: "5H",
    });
    expect(v.tricksWon).toEqual({ p0: 0, p1: 1, p2: 0 });
    expect(v.leader).toBe("p1");
    // Trick 2: clubs led, p2 must play 4C, p0 void trumps in.
    play(h, "p1", "9C");
    expect(legalCards(h, "p2")).toEqual(["4C"]);
    play(h, "p2", "4C");
    expect(legalCards(h, "p0")).toEqual(["AD", "AS"]);
    play(h, "p0", "AS");
    expect(h.state.tricksWon).toEqual({ p0: 1, p1: 1, p2: 0 });
    expect(h.state.turn).toBe("p0");
    expect(h.view("p1").lastTrick).toMatchObject({ winner: "p0", winningCard: "AS" });
    // Trick 3: p0 leads.
    expect(legalCards(h, "p1")).toEqual([]);
    play(h, "p0", "AD");
    expect(legalCards(h, "p1")).toEqual(["3D"]);
    play(h, "p1", "3D");
    expect(legalCards(h, "p2")).toEqual(["KH"]);
    play(h, "p2", "KH");
    expect(h.state.phase).toBe("summary");
    expect(h.state.tricksWon).toEqual({ p0: 2, p1: 1, p2: 0 });
  });

  it("a low trump beats the led suit; the highest trump wins among trumps", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, { p1: ["5H", "6H", "7H"], p2: ["3S", "2D", "4D"], p0: ["9S", "2C", "3C"] });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "5H");
    play(h, "p2", "3S");
    play(h, "p0", "9S");
    expect(h.state.tricksWon).toEqual({ p0: 1, p1: 0, p2: 0 });
    expect(h.state.turn).toBe("p0");
  });

  it("single trump on a high led-suit trick wins", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, { p1: ["AH", "6H", "7H"], p2: ["KH", "2D", "4D"], p0: ["2S", "2C", "3C"] });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "AH");
    play(h, "p2", "KH");
    play(h, "p0", "2S");
    expect(h.state.tricksWon.p0).toBe(1);
    expect(h.state.lastTrick).toMatchObject({ winner: "p0", winningCard: "2S" });
  });

  it("the trump of the round is used (Diamonds in round 2)", () => {
    const h = mk(3, { startCards: 3 });
    finishRound(h);
    h.act("p0", { type: "nextRound" });
    expect(h.state.trump).toBe("D");
    // Round 2: dealer p1, p2 leads; 2 cards each.
    withHands(h, { p2: ["KC", "3H"], p0: ["2D", "4H"], p1: ["AS", "5H"] });
    bidAll(h, { p2: 1, p0: 1, p1: 1 });
    play(h, "p2", "KC");
    play(h, "p0", "2D"); // void clubs, trumps
    play(h, "p1", "AS"); // spades are not trump this round
    expect(h.state.tricksWon).toEqual({ p0: 1, p1: 0, p2: 0 });
    expect(h.state.turn).toBe("p0");
  });

  it("no-trump round: highest of the led suit wins, spades are not trump", () => {
    const h = mk(3, { startCards: 3, noTrump: true });
    withHands(h, { p1: ["5H", "6H", "7H"], p2: ["3S", "2D", "4D"], p0: ["AS", "2C", "3C"] }, { trump: null });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "5H");
    play(h, "p2", "3S");
    play(h, "p0", "AS");
    expect(h.state.tricksWon).toEqual({ p0: 0, p1: 1, p2: 0 });
    expect(h.state.turn).toBe("p1");
  });

  it("mustTrumpWhenVoid: a void player holding trump must trump; otherwise any card", () => {
    const h = mk(3, { startCards: 3, mustTrumpWhenVoid: true });
    withHands(h, {
      p1: ["5H", "9C", "3D"],
      p2: ["KH", "2S", "4C"], // has hearts and a spade: must still follow hearts
      p0: ["AS", "AD", "AC"],
    });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "5H");
    expect(legalCards(h, "p2")).toEqual(["KH"]);
    play(h, "p2", "KH");
    expect(legalCards(h, "p0")).toEqual(["AS"]);
    expect(h.tryAct("p0", { type: "play", card: "AC" })).not.toBeNull();
    play(h, "p0", "AS");
    expect(h.state.turn).toBe("p0");
    // p0 leads AD; p1 follows 3D; p2 has no diamonds and its spade is the only trump -> must play 2S.
    play(h, "p0", "AD");
    play(h, "p1", "3D");
    expect(legalCards(h, "p2")).toEqual(["2S"]);
    play(h, "p2", "2S");
    expect(h.state.turn).toBe("p2");
    // p2 leads 4C; p0 has AC (follows), p1 has 9C.
    play(h, "p2", "4C");
    expect(legalCards(h, "p0")).toEqual(["AC"]);
  });

  it("mustTrumpWhenVoid: void with no trump in hand -> any card", () => {
    const h = mk(3, { startCards: 3, mustTrumpWhenVoid: true });
    withHands(h, { p1: ["5H", "6H", "7H"], p2: ["2C", "2D", "4D"], p0: ["9S", "2H", "3C"] });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "5H");
    expect(legalCards(h, "p2")).toEqual(["2C", "2D", "4D"]);
  });

  it("mustTrumpWhenVoid off (default): a void player may discard instead of trumping", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, { p1: ["5H", "6H", "7H"], p2: ["2C", "2S", "4D"], p0: ["9S", "2H", "3C"] });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "5H");
    expect(legalCards(h, "p2")).toEqual(["2C", "2S", "4D"]);
  });

  it("trump led: others must follow trump if able", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, { p1: ["5S", "6H", "7H"], p2: ["KS", "AH", "4D"], p0: ["9C", "2H", "3C"] });
    bidAll(h, { p1: 1, p2: 1, p0: 0 });
    play(h, "p1", "5S");
    expect(legalCards(h, "p2")).toEqual(["KS"]);
    play(h, "p2", "KS");
    expect(legalCards(h, "p0")).toEqual(["2H", "3C", "9C"]);
    play(h, "p0", "9C");
    expect(h.state.tricksWon.p2).toBe(1);
    expect(h.state.turn).toBe("p2");
  });

  it("sum of tricks won equals the hand size at round end", () => {
    const h = mk(5, { startCards: 6 }, 9);
    finishRound(h);
    const won = Object.values(h.state.tricksWon).reduce((a, b) => a + b, 0);
    expect(won).toBe(6);
    expect(h.state.history[0].handSize).toBe(6);
  });
});

describe("judgement: scoring", () => {
  function scoreDeal1(settings: Partial<Settings>) {
    const h = mk(3, { startCards: 3, ...settings });
    playDeal1(h);
    expect(h.state.phase).toBe("summary");
    return h;
  }

  it("default: exact = 10 + bid (incl. zero bid), miss = 0", () => {
    const h = scoreDeal1({});
    // p1 bid 1 won 1 -> 11; p2 bid 0 won 0 -> 10; p0 bid 3 won 2 -> 0.
    expect(h.state.totals).toEqual({ p0: 0, p1: 11, p2: 10 });
    const r = h.view("p2").lastRound as RoundResult;
    expect(r).toMatchObject({
      round: 1,
      handSize: 3,
      trump: "S",
      dealer: "p0",
      bids: { p0: 3, p1: 1, p2: 0 },
      won: { p0: 2, p1: 1, p2: 0 },
      made: { p0: false, p1: true, p2: true },
      totals: { p0: 0, p1: 11, p2: 10 },
    });
    expect(z(r.points.p0)).toBe(0);
    expect(r.points.p1).toBe(11);
    expect(r.points.p2).toBe(10);
    expect(h.state.history).toHaveLength(1);
    expect(h.view(null).history).toEqual(h.state.history);
    const sc = plugin.scores(h.state);
    expect(sc.find((l) => l.playerId === "p1")).toMatchObject({ score: 11, rank: 1 });
    expect(sc.find((l) => l.playerId === "p2")).toMatchObject({ score: 10, rank: 2 });
    expect(sc.find((l) => l.playerId === "p0")).toMatchObject({ score: 0, rank: 3 });
    expect(h.envelope("p1").scores).toEqual(sc);
  });

  it("exactBonus and perTrick settings", () => {
    const h = scoreDeal1({ exactBonus: 5, perTrick: 2 });
    // p1: 5 + 2*1 = 7; p2: 5 + 2*0 = 5; p0 miss 0.
    expect(h.state.totals.p1).toBe(7);
    expect(h.state.totals.p2).toBe(5);
    expect(z(h.state.totals.p0)).toBe(0);
  });

  it("missPenalty minusBid: miss scores -bid", () => {
    const h = scoreDeal1({ missPenalty: "minusBid" });
    expect(h.state.totals).toEqual({ p0: -3, p1: 11, p2: 10 });
    expect(h.state.history[0].points.p0).toBe(-3);
    expect(h.state.history[0].made.p0).toBe(false);
  });

  it("missPenalty minusDiff: miss scores -|bid - won|", () => {
    const h = scoreDeal1({ missPenalty: "minusDiff" });
    expect(h.state.totals).toEqual({ p0: -1, p1: 11, p2: 10 });
  });

  it("missed zero bid: 0 under zero/minusBid, -won under minusDiff; overbid miss too", () => {
    // Deal: p1 bids 0 but wins a trick; p0 bids 2 and wins 0; p2 bids 2 and makes it.
    const deal = { p1: ["AH", "2C", "3C"], p2: ["2H", "4C", "5C"], p0: ["3H", "KD", "QD"] };
    const run = (missPenalty: Settings["missPenalty"]) => {
      const h = mk(3, { startCards: 3, missPenalty });
      withHands(h, deal);
      bidAll(h, { p1: 0, p2: 2, p0: 2 }); // total 4 != 3
      // T1: AH 2H 3H -> p1. T2: 2C 4C KD -> p2 (diamonds are not trump in round 1).
      play(h, "p1", "AH");
      play(h, "p2", "2H");
      play(h, "p0", "3H");
      play(h, "p1", "2C");
      play(h, "p2", "4C");
      play(h, "p0", "KD");
      // p2 won with 4C, leads 5C; then clockwise p0 QD, p1 3C.
      play(h, "p2", "5C");
      play(h, "p0", "QD");
      play(h, "p1", "3C");
      expect(h.state.tricksWon).toEqual({ p0: 0, p1: 1, p2: 2 });
      return h.state.history[0].points;
    };
    // p1 bid 0 won 1 (miss); p2 bid 2 won 2 (exact 12); p0 bid 2 won 0 (miss).
    let pts = run("zero");
    expect([z(pts.p1), pts.p2, z(pts.p0)]).toEqual([0, 12, 0]);
    pts = run("minusBid");
    expect([z(pts.p1), pts.p2, pts.p0]).toEqual([0, 12, -2]);
    pts = run("minusDiff");
    expect([pts.p1, pts.p2, pts.p0]).toEqual([-1, 12, -2]);
  });

  it("totals accumulate across rounds", () => {
    const h = mk(3, { startCards: 3 });
    playDeal1(h);
    h.act("p0", { type: "nextRound" });
    // Round 2: 2 cards, trump D, dealer p1, order p2, p0, p1.
    withHands(h, { p2: ["AC", "KC"], p0: ["2C", "3C"], p1: ["4C", "5C"] });
    bidAll(h, { p2: 2, p0: 0, p1: 1 }); // total 3 != 2
    play(h, "p2", "AC");
    play(h, "p0", "2C");
    play(h, "p1", "4C");
    play(h, "p2", "KC");
    play(h, "p0", "3C");
    play(h, "p1", "5C");
    // p2 exact 2 -> 12; p0 exact 0 -> 10; p1 bid 1 won 0 -> 0.
    expect(h.state.totals).toEqual({ p0: 10, p1: 11, p2: 22 });
    expect(h.state.history[1]).toMatchObject({
      round: 2,
      handSize: 2,
      trump: "D",
      dealer: "p1",
      points: { p0: 10, p2: 12 },
      totals: { p0: 10, p1: 11, p2: 22 },
    });
    expect(plugin.scores(h.state).map((l) => [l.playerId, l.rank]).sort()).toEqual([
      ["p0", 3],
      ["p1", 2],
      ["p2", 1],
    ]);
  });
});

describe("judgement: summary and host-controlled rounds", () => {
  it("only the host may start the next round; nobody else is waited on", () => {
    const h = mk(3, { startCards: 3 });
    playDeal1(h);
    expect(h.state.phase).toBe("summary");
    expect(h.state.turn).toBeNull();
    expect(plugin.activePlayers(h.state)).toEqual([]);
    expect(h.legal("p0")).toContainEqual({ type: "nextRound" });
    expect(h.legal("p1")).toEqual([]);
    expect(h.legal("p2")).toEqual([]);
    expect(h.tryAct("p1", { type: "nextRound" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "bid", bid: 0 })).not.toBeNull();
    const v = h.view("p1");
    expect(v.phase).toBe("summary");
    expect(v.next).toEqual({ round: 2, handSize: 2, trump: "D", dealer: "p1" });
    expect(v.lastTrick).toMatchObject({ winner: "p0", winningCard: "AD" });
    h.act("p0", { type: "nextRound" });
    const s = h.state;
    expect(s.phase).toBe("bidding");
    expect(s.round).toBe(2);
    expect(s.handSize).toBe(2);
    expect(s.trump).toBe("D");
    expect(s.dealer).toBe("p1");
    expect(s.bidOrder).toEqual(["p2", "p0", "p1"]);
    expect(s.turn).toBe("p2");
    expect(s.bids).toEqual({ p0: null, p1: null, p2: null });
    expect(s.tricksWon).toEqual({ p0: 0, p1: 0, p2: 0 });
    expect(s.trick).toEqual([]);
    expect(s.lastTrick).toBeNull();
    expect(s.tricksPlayed).toBe(0);
    expect(s.totals).toEqual({ p0: 0, p1: 11, p2: 10 });
    for (const id of ids(3)) expect(s.hands[id]).toHaveLength(2);
    expect(h.view("p0").lastRound).toBeNull();
  });

  it("the host is whoever hosts the room, not the dealer", () => {
    const h = mk(3, { startCards: 3 }, 1, "p2");
    finishRound(h);
    expect(h.legal("p0")).toEqual([]);
    expect(h.legal("p2")).toContainEqual({ type: "nextRound" });
    h.act("p2", { type: "nextRound" });
    expect(h.state.round).toBe(2);
  });

  it("non-host bots never get nextRound (isHost false)", () => {
    const h = mk(3, { startCards: 3 });
    finishRound(h);
    expect(plugin.legalActions(h.state, { id: "p0", isHost: false })).toEqual([]);
  });
});

describe("judgement: end of game", () => {
  it("ends after the last round, not before", () => {
    const h = mk(3, { startCards: 2 });
    finishRound(h);
    expect(h.match.over).toBe(false);
    expect(h.state.phase).toBe("summary");
    h.act("p0", { type: "nextRound" });
    expect(h.state.round).toBe(2);
    expect(h.state.handSize).toBe(1);
    expect(h.match.over).toBe(false);
    finishRound(h);
    // After the final round: either straight to "over", or a summary whose only step is to end.
    if (h.state.phase === "summary") {
      expect(h.view("p1").next).toBeNull();
      expect(h.match.over).toBe(false);
      h.act("p0", { type: "nextRound" });
    }
    expect(h.state.phase).toBe("over");
    expect(h.match.over).toBe(true);
    expect(plugin.isOver(h.state)).toBe(true);
    expect(h.state.history).toHaveLength(2);
    expect(h.view("p1").lastRound).toEqual(h.state.history[1]);
    expect(h.view("p1").next).toBeNull();
    expect(plugin.activePlayers(h.state)).toEqual([]);
    for (const id of ids(3)) expect(h.legal(id)).toEqual([]);
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull();
  });

  /** One-round game (startCards 1) with a crafted deal: p2 wins the only trick. */
  function oneRound(bids: Record<PlayerId, number>, settings: Partial<Settings> = {}) {
    const h = mk(3, { startCards: 1, ...settings });
    withHands(h, { p1: ["2H"], p2: ["3H"], p0: ["4C"] });
    bidAll(h, bids);
    play(h, "p1", "2H");
    play(h, "p2", "3H");
    play(h, "p0", "4C");
    if (h.state.phase === "summary") h.act("p0", { type: "nextRound" });
    expect(h.match.over).toBe(true);
    return h;
  }

  it("final totals and ranks (highest wins)", () => {
    // p1 0 exact -> 10, p2 1 exact -> 11, p0 must bid 1 (0 forbidden) -> miss 0.
    const h = oneRound({ p1: 0, p2: 1, p0: 1 });
    expect(h.state.totals).toEqual({ p0: 0, p1: 10, p2: 11 });
    const ranks = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, [l.score, l.rank]]));
    expect(ranks).toEqual({ p2: [11, 1], p1: [10, 2], p0: [0, 3] });
  });

  it("ties share a rank", () => {
    const h = oneRound({ p1: 0, p2: 0, p0: 0 }, { lastBidderRule: false });
    // p1 10, p0 10, p2 bid 0 won 1 -> 0.
    expect(z(h.state.totals.p2)).toBe(0);
    const ranks = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, l.rank]));
    expect(ranks).toEqual({ p0: 1, p1: 1, p2: 3 });
  });

  it("scores rank from totals with competition ranking (crafted totals)", () => {
    const h = mk(4);
    h.setState({ ...h.state, totals: { p0: 20, p1: 35, p2: 20, p3: -4 } });
    const ranks = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, [l.score, l.rank]]));
    expect(ranks).toEqual({ p1: [35, 1], p0: [20, 2], p2: [20, 2], p3: [-4, 4] });
  });
});

describe("judgement: viewFor and legal never leak other hands", () => {
  function checkLeaks(h: H, label: string) {
    const s = h.state;
    for (const owner of s.order) {
      const secrets = s.hands[owner];
      if (!secrets || secrets.length === 0) continue;
      for (const viewer of [...s.order.filter((id) => id !== owner), null]) {
        expect(findLeaks(h.view(viewer), secrets), `${label}: view of ${viewer} leaks ${owner}`).toEqual([]);
        expect(findLeaks(h.envelope(viewer), secrets), `${label}: envelope of ${viewer} leaks ${owner}`).toEqual([]);
        if (viewer !== null) {
          expect(findLeaks(h.legal(viewer), secrets), `${label}: legal of ${viewer} leaks ${owner}`).toEqual([]);
        }
      }
    }
    // The viewer sees exactly their own hand.
    for (const id of s.order) {
      expect(h.view(id).myHand.slice().sort(), label).toEqual((s.hands[id] ?? []).slice().sort());
      expect(h.view(id).handCounts[id]).toBe((s.hands[id] ?? []).length);
    }
    expect(h.view(null).myHand).toEqual([]);
    expect(h.envelope(null).legal).toEqual([]);
    expect(plugin.legalActions(s, { id: "stranger", isHost: false })).toEqual([]);
    assertJsonSafe(h.view(null), `${label} spectator view`);
  }

  it.each([
    [3, {}],
    [5, { sequence: "up", startCards: 4, noTrump: true, mustTrumpWhenVoid: true }],
    [8, { startCards: 6, lastBidderRule: false }],
  ] as [number, Partial<Settings>][])("every step of a %i-player game (all phases)", (n, settings) => {
    const h = mk(n, settings, 17);
    const rng = createRng(77);
    const phases = new Set<string>();
    let guard = 0;
    while (!h.match.over) {
      if (guard++ > 5000) throw new Error("did not finish");
      phases.add(h.state.phase);
      checkLeaks(h, `${h.state.phase} r${h.state.round} t${h.state.tricksPlayed}`);
      if (h.state.phase === "summary") {
        h.act(h.host, { type: "nextRound" });
        continue;
      }
      const turn = h.state.turn!;
      h.act(turn, rng.pick(gameActions(h, turn)));
    }
    phases.add(h.state.phase);
    checkLeaks(h, "over");
    expect([...phases].sort()).toEqual(["bidding", "over", "playing", "summary"]);
  });

  it("crafted mid-trick position: no one sees another's remaining cards", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, DEAL1);
    bidAll(h, { p1: 1, p2: 0, p0: 3 });
    play(h, "p1", "5H");
    // p1's remaining cards are secret from p0, p2 and spectators.
    for (const viewer of ["p0", "p2", null]) {
      expect(findLeaks(h.view(viewer), ["9C", "3D"])).toEqual([]);
    }
    // The played card is public.
    expect(JSON.stringify(h.view(null))).toContain("5H");
    // p2's legal list only names p2's cards.
    expect(findLeaks(h.legal("p2"), [...DEAL1.p0, "9C", "3D"])).toEqual([]);
  });
});

describe("judgement: timers and hurry (types.ts)", () => {
  it("no deadline without a timer", () => {
    const h = mk(4);
    expect(plugin.deadline?.(h.state) ?? null).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
  });

  it("host can hurry a slow bidder; after HURRY_MS the game bids for them", () => {
    const h = mk(4);
    expect(h.legal("p0")).toContainEqual({ type: "hurry" });
    expect(h.legal("p2").some((a) => a.type === "hurry")).toBe(false);
    expect(h.legal("p1").some((a) => a.type === "hurry")).toBe(false); // the slow player themself
    h.act("p0", { type: "hurry" });
    expect(plugin.deadline?.(h.state)).toBe(h.now + HURRY_MS);
    expect(h.advanceTime(HURRY_MS - 1)).toBe(false);
    expect(h.advanceTime(1)).toBe(true);
    expect(h.state.bids.p1).not.toBeNull();
    expect(h.state.turn).toBe("p2");
  });

  it("a hurried play is a legal (follow-suit) card", () => {
    const h = mk(3, { startCards: 3 });
    withHands(h, DEAL1);
    bidAll(h, { p1: 1, p2: 0, p0: 3 });
    play(h, "p1", "5H");
    h.act("p0", { type: "hurry" });
    expect(h.advanceTime(HURRY_MS)).toBe(true);
    expect(h.state.trick).toHaveLength(2);
    expect(["KH", "2H"]).toContain(h.state.trick[1].card);
    expect(h.state.trick[1].player).toBe("p2");
  });

  it("turnTimer > 0 moves for the current player when it expires", () => {
    const field = plugin.settings.find((f: SettingField) => f.key === "turnTimer");
    expect(field).toBeDefined();
    const secs = field && field.type === "number" ? field.max : 30;
    const h = mk(4, { turnTimer: secs });
    expect(plugin.deadline?.(h.state)).toBe(h.now + secs * 1000);
    expect(h.advanceTime(secs * 1000)).toBe(true);
    expect(h.state.bids.p1).not.toBeNull();
    expect(h.state.turn).toBe("p2");
  });
});

describe("judgement: determinism and bots", () => {
  function verifyFinished(state: State, n: number) {
    const st = state.settings;
    expect(state.phase).toBe("over");
    expect(state.history).toHaveLength(state.handSizes.length);
    const running: Record<string, number> = Object.fromEntries(ids(n).map((id) => [id, 0]));
    state.history.forEach((r, i) => {
      expect(r.round).toBe(i + 1);
      expect(r.handSize).toBe(state.handSizes[i]);
      expect(r.dealer).toBe(state.order[i % n]);
      expect(Object.values(r.won).reduce((a, b) => a + b, 0)).toBe(r.handSize);
      const bidSum = Object.values(r.bids).reduce((a, b) => a + b, 0);
      if (st.lastBidderRule) expect(bidSum).not.toBe(r.handSize);
      for (const id of ids(n)) {
        const bid = r.bids[id], won = r.won[id];
        expect(bid).toBeGreaterThanOrEqual(0);
        expect(bid).toBeLessThanOrEqual(r.handSize);
        const made = bid === won;
        const pen = st.missPenalty === "zero" ? 0 : st.missPenalty === "minusBid" ? -bid : -Math.abs(bid - won);
        const pts = made ? st.exactBonus + st.perTrick * bid : pen;
        expect(r.made[id]).toBe(made);
        expect(z(r.points[id])).toBe(z(pts));
        running[id] += pts;
        expect(z(r.totals[id])).toBe(z(running[id]));
      }
    });
    for (const id of ids(n)) expect(z(state.totals[id])).toBe(z(running[id]));
    const sc = plugin.scores(state);
    expect(sc.map((l) => l.playerId).sort()).toEqual(ids(n).sort());
    for (const l of sc) {
      expect(l.score).toBe(state.totals[l.playerId]);
      expect(l.rank).toBe(1 + sc.filter((o) => o.score > l.score).length);
    }
  }

  const combos: [string, Partial<Settings>][] = [
    ["default", {}],
    ["downUp + noTrump", { sequence: "downUp", noTrump: true }],
    ["up + mustTrump + no last-bidder rule", { sequence: "up", mustTrumpWhenVoid: true, lastBidderRule: false }],
    ["minusBid, bonus 5, perTrick 2", { missPenalty: "minusBid", exactBonus: 5, perTrick: 2 }],
    ["minusDiff, 1 card", { missPenalty: "minusDiff", startCards: 1 }],
  ];

  for (const n of [3, 5, 8]) {
    for (const [name, settings] of combos) {
      it(`bots finish ${n} players, ${name}, several seeds; scoring is consistent`, () => {
        const s: Partial<Settings> = { ...BASE, ...settings };
        if (n * (s.startCards ?? 7) > 52) s.startCards = Math.floor(52 / n);
        for (const seed of [1, 2, 3]) {
          const { match } = simulateGame(plugin, { players: n, seed, settings: s });
          expect(match.over).toBe(true);
          verifyFinished(match.state as State, n);
          for (const p of [...ids(n), null]) assertJsonSafe(buildView(plugin, match, p, p === "p0"), `final view ${p}`);
        }
      });
    }
  }

  it("bots finish with a turn timer on", () => {
    const { match } = simulateGame(plugin, { players: 4, seed: 4, settings: { turnTimer: 30 } });
    expect(match.over).toBe(true);
  });

  it("same seed -> same game; different seeds -> different games", () => {
    const a = simulateGame(plugin, { players: 4, seed: 99, settings: BASE });
    const b = simulateGame(plugin, { players: 4, seed: 99, settings: BASE });
    expect(a.log).toEqual(b.log);
    expect(a.match.state).toEqual(b.match.state);
    const c = simulateGame(plugin, { players: 4, seed: 100, settings: BASE });
    expect(c.log).not.toEqual(a.log);
  });

  it("reduce does not mutate its input and is pure for the same context", () => {
    const h = mk(4, {}, 8);
    const before = JSON.stringify(h.state);
    const ctx = { actor: { id: "p1", isHost: false }, rng: createRng(1, 1), now: 0 };
    const s1 = plugin.reduce(h.state, { type: "bid", bid: 2 }, ctx);
    const s2 = plugin.reduce(h.state, { type: "bid", bid: 2 }, { ...ctx, rng: createRng(1, 1) });
    expect(JSON.stringify(h.state)).toBe(before);
    expect(s1).toEqual(s2);
  });
});
