/**
 * Hearts tests, written from games/hearts/BRIEF.md, ENGINE_CONTRACT.md and games/hearts/types.ts
 * (not from rules.ts).
 */
import { describe, expect, it } from "vitest";
import plugin from "../games/hearts/rules";
import { makeDeck, rankScores, suitOf, type Card, type PlayerId } from "../engine";
import { chooseBotAction } from "../engine/match";
import { assertJsonSafe, createHarness, findLeaks, simulateGame, type Harness } from "../engine/testing";
import {
  OPENING_CARD,
  PASS_COUNT,
  REMOVED_CARDS,
  passDirectionFor,
  passSource,
  passTarget,
  type Action,
  type HandResult,
  type PassDirection,
  type Settings,
  type State,
  type View,
} from "../games/hearts/types";

type H = Harness<State, Action, View>;

const T0 = 1_700_000_000_000;
const TRICKS: Record<number, number> = { 3: 17, 4: 13, 5: 10, 6: 8 };
const ALL_COUNTS = [3, 4, 5, 6];
const HEARTS = makeDeck().filter((c) => suitOf(c) === "H");

function mk(players = 4, settings: Partial<Settings> = {}, seed = 1): H {
  return createHarness<State, Action, View>(plugin, { players, settings, seed, now: T0 });
}

const sorted = (cards: readonly Card[]) => [...cards].sort();
const isHeart = (c: Card) => suitOf(c) === "H";
const isPenalty = (c: Card) => isHeart(c) || c === "QS";
const playsOf = (legal: Action[]) =>
  sorted(legal.filter((a): a is { type: "play"; card: Card } => a.type === "play").map((a) => a.card));
const togglesOf = (legal: Action[]) =>
  sorted(legal.filter((a): a is { type: "togglePass"; card: Card } => a.type === "togglePass").map((a) => a.card));
const hasType = (legal: Action[], type: Action["type"]) => legal.some((a) => a.type === type);
const byId = <T>(order: readonly PlayerId[], f: (id: PlayerId) => T) =>
  Object.fromEntries(order.map((id) => [id, f(id)])) as Record<PlayerId, T>;
const minus = (a: readonly Card[], b: readonly Card[]) => a.filter((c) => !b.includes(c));

function deckFor(n: number): Card[] {
  return makeDeck().filter((c) => !REMOVED_CARDS[n].includes(c));
}

// ---------------------------------------------------------------------------
// Crafting exact positions
// ---------------------------------------------------------------------------

interface PlayOpts {
  hands: Record<PlayerId, Card[]>;
  turn: PlayerId;
  leader: PlayerId;
  trick?: { playerId: PlayerId; card: Card }[];
  trickNumber?: number;
  heartsBroken?: boolean;
  taken?: Record<PlayerId, Card[]>;
  totals?: Record<PlayerId, number>;
}

/** A play-phase state built on top of a real state from setup. */
function playState(h: H, o: PlayOpts): State {
  const s = h.state;
  const order = s.order;
  const taken = o.taken ?? byId(order, () => [] as Card[]);
  return {
    ...s,
    phase: "play",
    hands: byId(order, (id) => o.hands[id] ?? []),
    passSelected: byId(order, () => [] as Card[]),
    passed: byId(order, () => null),
    received: byId(order, () => null),
    turn: o.turn,
    leader: o.leader,
    trick: o.trick ?? [],
    trickNumber: o.trickNumber ?? 2,
    lastTrick: null,
    heartsBroken: o.heartsBroken ?? false,
    taken,
    tricksWon: byId(order, (id) => Math.floor(taken[id].length / order.length)),
    totals: o.totals ?? s.totals,
  };
}

function setPlay(h: H, o: PlayOpts): void {
  h.setState(playState(h, o));
}

/**
 * Last trick of a 4-player hand. `taken` lists the scoring cards (all hearts, Q♠ and J♦ must be placed
 * in `taken` or `last`); the remaining non-scoring cards are spread over the players as filler.
 * Plays the final trick (leader first) and returns the state after scoring.
 */
function playFinalTrick(
  h: H,
  o: { taken: Record<PlayerId, Card[]>; last: Record<PlayerId, Card>; leader: PlayerId; totals?: Record<PlayerId, number> },
): State {
  const order = h.state.order;
  const n = order.length;
  const used = [...Object.values(o.taken).flat(), ...Object.values(o.last)];
  const filler = deckFor(n).filter((c) => !used.includes(c));
  expect(filler.filter((c) => isPenalty(c) || c === "JD")).toEqual([]);
  expect(used.length + filler.length).toBe(deckFor(n).length);
  const taken = byId(order, (id) => [...(o.taken[id] ?? [])]);
  filler.forEach((c, i) => taken[order[i % n]].push(c));
  setPlay(h, {
    hands: byId(order, (id) => [o.last[id]]),
    turn: o.leader,
    leader: o.leader,
    trickNumber: TRICKS[n],
    heartsBroken: true,
    taken,
    totals: o.totals,
  });
  const li = order.indexOf(o.leader);
  for (let k = 0; k < n; k++) {
    const id = order[(li + k) % n];
    h.act(id, { type: "play", card: o.last[id] });
  }
  return h.state;
}

/** Scenario A (4p): p0 Q♠+2♥=15, p1 6♥=6, p2 4♥ + A♥ won in last trick =5, p3 0 (holds J♦). */
const SCENARIO_A = {
  taken: {
    p0: ["QS", "2H", "3H"],
    p1: ["4H", "5H", "6H", "7H", "8H", "9H"],
    p2: ["TH", "JH", "QH", "KH"],
    p3: ["JD"],
  },
  last: { p0: "2S", p1: "3S", p2: "KS", p3: "AH" },
  leader: "p0",
};

/** Moon (4p): p0 takes all 13 hearts and Q♠ (A♥ in the last trick). J♦ placed by the caller. */
function moonScenario(jdTo: PlayerId) {
  const taken: Record<PlayerId, Card[]> = { p0: ["QS", ...HEARTS.filter((c) => c !== "AH")], p1: [], p2: [], p3: [] };
  taken[jdTo].push("JD");
  return { taken, last: { p0: "AH", p1: "2C", p2: "3C", p3: "4C" }, leader: "p0" };
}

// ---------------------------------------------------------------------------
// Bot stepping, invariants and leak checks
// ---------------------------------------------------------------------------

/** One bot move through the real engine (same policy as simulateGame). Returns false when over. */
function botStep(h: H): boolean {
  if (h.match.over) return false;
  const active = plugin.activePlayers(h.state);
  const ids = h.players.map((p) => p.id);
  for (const id of [...active, ...ids.filter((x) => !active.includes(x))]) {
    let a = chooseBotAction(plugin, h.match, id) as Action | null;
    if (!a && id === h.host) a = (plugin.legalActions(h.state, { id, isHost: true }) as Action[])[0] ?? null;
    if (a) {
      h.act(id, a);
      return true;
    }
  }
  throw new Error(`stalled in phase ${h.state.phase}`);
}

function runUntil(h: H, pred: (s: State) => boolean, max = 5000): void {
  for (let i = 0; i < max && !pred(h.state); i++) {
    if (!botStep(h)) break;
  }
  expect(pred(h.state)).toBe(true);
}

/** Secrets that `viewer` must not see (cards in other hands, other players' pass selections/passes). */
function secretsFor(s: State, viewer: PlayerId | null): Card[] {
  const pub = new Set<Card>([
    ...s.trick.map((p) => p.card),
    ...(s.lastTrick?.plays.map((p) => p.card) ?? []),
    ...Object.values(s.taken).flat(),
  ]);
  const known = new Set<Card>(
    viewer
      ? [...(s.hands[viewer] ?? []), ...(s.passSelected[viewer] ?? []), ...(s.passed[viewer] ?? []), ...(s.received[viewer] ?? [])]
      : [],
  );
  const out = new Set<Card>();
  for (const p of s.order) {
    if (p === viewer) continue;
    const committed = s.phase === "pass" ? (s.passed[p] ?? []) : [];
    for (const c of [...s.hands[p], ...(s.passSelected[p] ?? []), ...committed]) {
      if (!pub.has(c) && !known.has(c)) out.add(c);
    }
  }
  return [...out];
}

function checkNoLeaks(h: H): void {
  const s = h.state;
  for (const viewer of [...s.order, null]) {
    const secrets = secretsFor(s, viewer);
    const label = `${s.phase} hand ${s.hand} trick ${s.trickNumber} viewer ${viewer}`;
    expect(findLeaks(h.view(viewer), secrets), `view ${label}`).toEqual([]);
    expect(findLeaks(h.envelope(viewer), secrets), `envelope ${label}`).toEqual([]);
    if (viewer) {
      expect(findLeaks(h.legal(viewer), secrets), `legal ${label}`).toEqual([]);
      expect(findLeaks(plugin.legalActions(s, { id: viewer, isHost: true }), secrets), `host legal ${label}`).toEqual([]);
    }
  }
  const spec = h.view(null);
  expect(spec.myHand).toEqual([]);
  expect(spec.passSelected).toEqual([]);
  expect(spec.myPassed).toBeNull();
  expect(spec.received).toBeNull();
  expect(spec.passTo).toBeNull();
  expect(spec.passFrom).toBeNull();
  expect(plugin.legalActions(s, { id: "spectator", isHost: false })).toEqual([]);
  expect(plugin.legalActions(s, { id: "spectator", isHost: true })).toEqual([]);
}

function checkInvariants(h: H): void {
  const s = h.state;
  const n = s.order.length;
  assertJsonSafe(s, "state");
  assertJsonSafe(h.view(null), "spectator view");
  const active = plugin.activePlayers(s);
  if (s.phase === "pass" || s.phase === "play") {
    const all = [
      ...Object.values(s.hands).flat(),
      ...s.trick.map((p) => p.card),
      ...Object.values(s.taken).flat(),
      ...(s.phase === "pass" ? Object.values(s.passed).flatMap((p) => p ?? []) : []),
    ];
    expect(sorted(all), "card conservation").toEqual(sorted(deckFor(n)));
  }
  if (s.phase === "play") {
    expect(active).toEqual([s.turn]);
    for (const id of s.order) {
      const legal = h.legal(id);
      if (id !== s.turn) expect(legal).toEqual([]);
      else {
        expect(legal.length).toBeGreaterThan(0);
        for (const c of playsOf(legal)) expect(s.hands[id]).toContain(c);
        expect(legal.every((a) => a.type === "play")).toBe(true);
      }
    }
  } else if (s.phase === "pass") {
    const v = h.view(null);
    expect(sorted(active)).toEqual(sorted(s.order.filter((id) => !v.passConfirmed[id])));
  } else {
    expect(active).toEqual([]);
  }
  const v = h.view(s.order[0]);
  for (const id of s.order) expect(v.handCounts[id]).toBe(s.hands[id].length);
}

// ---------------------------------------------------------------------------
// Meta and settings
// ---------------------------------------------------------------------------

describe("meta and settings", () => {
  it("has the right meta", () => {
    expect(plugin.meta.id).toBe("hearts");
    expect(plugin.meta.category).toBe("cards");
    expect(plugin.meta.minPlayers).toBe(3);
    expect(plugin.meta.maxPlayers).toBe(6);
    expect(plugin.meta.hidden).toBeFalsy();
    expect(plugin.meta.howToPlay.length).toBeGreaterThanOrEqual(3);
    expect(plugin.meta.howToPlay.length).toBeLessThanOrEqual(6);
  });

  it("rejects 2 and 7 players", () => {
    expect(() => mk(2)).toThrow();
    expect(() => mk(7)).toThrow();
  });

  it("defaults match the brief", () => {
    const s = mk(4).state.settings;
    expect(s).toMatchObject({
      passPattern: "standard",
      firstLead: "twoClubs",
      noPointsFirstTrick: true,
      heartsMustBreak: true,
      queenBreaksHearts: false,
      moon: "others",
      jackOfDiamonds: false,
      targetScore: 100,
      turnTimer: 0,
    });
  });

  it("accepts every option value", () => {
    for (const passPattern of ["standard", "left", "leftRight", "none"]) expect(mk(4, { passPattern }).state.settings.passPattern).toBe(passPattern);
    for (const firstLead of ["twoClubs", "leftOfDealer"]) expect(mk(4, { firstLead }).state.settings.firstLead).toBe(firstLead);
    for (const moon of ["others", "self", "off"]) expect(mk(4, { moon }).state.settings.moon).toBe(moon);
    for (const turnTimer of [15, 30, 180]) expect(mk(4, { turnTimer }).state.settings.turnTimer).toBe(turnTimer);
    const s = mk(4, { noPointsFirstTrick: false, heartsMustBreak: false, queenBreaksHearts: true, jackOfDiamonds: true, targetScore: 50 }).state.settings;
    expect(s).toMatchObject({ noPointsFirstTrick: false, heartsMustBreak: false, queenBreaksHearts: true, jackOfDiamonds: true, targetScore: 50 });
  });
});

// ---------------------------------------------------------------------------
// Setup: deck and deal
// ---------------------------------------------------------------------------

describe.each(ALL_COUNTS)("setup with %i players", (n) => {
  it("deals the reduced deck evenly and secretly sorted", () => {
    for (const seed of [1, 2, 3]) {
      const h = mk(n, {}, seed);
      const s = h.state;
      expect(s.order).toEqual(Array.from({ length: n }, (_, i) => `p${i}`));
      expect(sorted(s.removed)).toEqual(sorted(REMOVED_CARDS[n]));
      const per = (52 - REMOVED_CARDS[n].length) / n;
      expect(per).toBe(TRICKS[n]);
      for (const id of s.order) expect(s.hands[id]).toHaveLength(per);
      const all = Object.values(s.hands).flat();
      expect(new Set(all).size).toBe(all.length);
      expect(sorted(all)).toEqual(sorted(deckFor(n)));
      for (const c of REMOVED_CARDS[n]) expect(all).not.toContain(c);
      // 26 penalty points always present
      for (const c of [...HEARTS, "QS", "JD"]) expect(all).toContain(c);
      expect(all).toContain(OPENING_CARD[n]);
    }
  });

  it("starts hand 1 in the pass phase, passing left, dealer seat 0, totals 0", () => {
    const h = mk(n);
    const s = h.state;
    expect(s.phase).toBe("pass");
    expect(s.hand).toBe(1);
    expect(s.dealer).toBe(0);
    expect(s.passDirection).toBe("left");
    expect(s.history).toEqual([]);
    expect(Object.values(s.totals)).toEqual(Array(n).fill(0));
    expect(sorted(plugin.activePlayers(s))).toEqual(sorted(s.order));
    expect(plugin.scores(s).map((l) => l.rank)).toEqual(Array(n).fill(1));
    expect(plugin.scores(s).map((l) => l.score)).toEqual(Array(n).fill(0));
    expect(plugin.isOver(s)).toBe(false);
    expect(h.match.over).toBe(false);
    const v = h.view("p0");
    expect(v.phase).toBe("pass");
    expect(v.hand).toBe(1);
    expect(v.dealer).toBe("p0");
    expect(v.passDirection).toBe("left");
    expect(v.passTo).toBe("p1");
    expect(v.passFrom).toBe(`p${n - 1}`);
    expect(sorted(v.myHand)).toEqual(sorted(s.hands.p0));
    expect(v.passSelected).toEqual([]);
    expect(v.myPassed).toBeNull();
    expect(v.received).toBeNull();
    expect(v.tricksPerHand).toBe(TRICKS[n]);
    expect(sorted(v.removedCards)).toEqual(sorted(REMOVED_CARDS[n]));
    expect(v.targetScore).toBe(100);
    expect(v.trick).toEqual([]);
    expect(v.trickNumber).toBe(1);
    expect(v.heartsBroken).toBe(false);
    expect(v.lastTrick).toBeNull();
    expect(v.lastHand).toBeNull();
    expect(v.history).toEqual([]);
    for (const id of s.order) {
      expect(v.passConfirmed[id]).toBe(false);
      expect(v.handCounts[id]).toBe(TRICKS[n]);
      expect(v.totals[id]).toBe(0);
      expect(v.handPoints[id]).toBe(0);
      expect(v.tricksWon[id]).toBe(0);
      expect(v.pointCards[id]).toEqual([]);
    }
    expect(h.envelope("p0").deadline).toBeNull();
  });

  it("with passPattern none starts in play, opening card holder leads it", () => {
    const h = mk(n, { passPattern: "none" });
    const s = h.state;
    expect(s.phase).toBe("play");
    expect(s.passDirection).toBe("hold");
    const holder = s.order.find((id) => s.hands[id].includes(OPENING_CARD[n]))!;
    expect(s.turn).toBe(holder);
    expect(plugin.activePlayers(s)).toEqual([holder]);
    expect(h.legal(holder)).toEqual([{ type: "play", card: OPENING_CARD[n] }]);
    for (const id of s.order) {
      if (id !== holder) expect(h.legal(id)).toEqual([]);
      expect(hasType(h.legal(id), "togglePass")).toBe(false);
    }
    const v = h.view(holder);
    expect(v.passTo).toBeNull();
    expect(v.passFrom).toBeNull();
    // any other card is rejected
    const other = s.hands[holder].find((c) => c !== OPENING_CARD[n])!;
    expect(h.tryAct(holder, { type: "play", card: other })).not.toBeNull();
    h.act(holder, { type: "play", card: OPENING_CARD[n] });
    expect(h.state.trick).toEqual([{ playerId: holder, card: OPENING_CARD[n] }]);
    expect(h.state.turn).toBe(s.order[(s.order.indexOf(holder) + 1) % n]);
  });

  it("with leftOfDealer, the player left of the dealer leads trick 1 with any allowed card", () => {
    const h = mk(n, { passPattern: "none", firstLead: "leftOfDealer" });
    const s = h.state;
    expect(s.turn).toBe("p1");
    const plays = playsOf(h.legal("p1"));
    const hand = s.hands.p1;
    const nonPenalty = hand.filter((c) => !isPenalty(c));
    if (nonPenalty.length > 0) expect(plays).toEqual(sorted(nonPenalty));
  });

  it("is deterministic per seed and differs between seeds", () => {
    expect(mk(n, {}, 7).state).toEqual(mk(n, {}, 7).state);
    expect(mk(n, {}, 7).state.hands).not.toEqual(mk(n, {}, 8).state.hands);
  });
});

// ---------------------------------------------------------------------------
// Passing
// ---------------------------------------------------------------------------

/** Every player toggles the given cards (default: 3 of their cards) and confirms. */
function passAll(h: H, pick?: (id: PlayerId, hand: Card[]) => Card[]): Record<PlayerId, Card[]> {
  const chosen: Record<PlayerId, Card[]> = {};
  for (const id of h.state.order) {
    const cards = pick ? pick(id, h.state.hands[id]) : sorted(h.state.hands[id]).slice(0, PASS_COUNT);
    chosen[id] = cards;
    for (const card of cards) h.act(id, { type: "togglePass", card });
    h.act(id, { type: "confirmPass" });
  }
  return chosen;
}

function checkExchange(h: H, dir: PassDirection) {
  const order = h.state.order;
  const before = byId(order, (id) => [...h.state.hands[id]]);
  expect(h.state.passDirection).toBe(dir);
  const chosen = passAll(h);
  const s = h.state;
  expect(s.phase).toBe("play");
  for (const id of order) {
    const src = passSource(order, id, dir)!;
    const to = passTarget(order, id, dir)!;
    expect(sorted(s.hands[id])).toEqual(sorted([...minus(before[id], chosen[id]), ...chosen[src]]));
    const v = h.view(id);
    expect(v.passTo).toBe(to);
    expect(v.passFrom).toBe(src);
    expect(sorted(v.received!)).toEqual(sorted(chosen[src]));
    expect(sorted(v.myPassed!)).toEqual(sorted(chosen[id]));
    expect(sorted(v.myHand)).toEqual(sorted(s.hands[id]));
  }
  const holder = order.find((id) => s.hands[id].includes(OPENING_CARD[order.length]))!;
  expect(s.turn).toBe(holder);
  expect(h.legal(holder)).toEqual([{ type: "play", card: OPENING_CARD[order.length] }]);
  checkNoLeaks(h);
}

describe("passing", () => {
  it("togglePass/confirmPass legality follows the selection size", () => {
    const h = mk(4);
    const hand = h.state.hands.p1;
    expect(togglesOf(h.legal("p1"))).toEqual(sorted(hand));
    expect(hasType(h.legal("p1"), "confirmPass")).toBe(false);
    expect(hasType(h.legal("p1"), "play")).toBe(false);
    expect(h.legal("p1")).toHaveLength(hand.length);

    const [a, b, c, d] = sorted(hand);
    h.act("p1", { type: "togglePass", card: a });
    expect(h.view("p1").passSelected).toEqual([a]);
    expect(h.tryAct("p1", { type: "confirmPass" })).not.toBeNull();
    // toggling again removes it
    h.act("p1", { type: "togglePass", card: a });
    expect(h.view("p1").passSelected).toEqual([]);
    h.act("p1", { type: "togglePass", card: a });
    h.act("p1", { type: "togglePass", card: b });
    expect(togglesOf(h.legal("p1"))).toEqual(sorted(hand));
    expect(h.tryAct("p1", { type: "confirmPass" })).not.toBeNull();
    h.act("p1", { type: "togglePass", card: c });
    expect(sorted(h.view("p1").passSelected)).toEqual(sorted([a, b, c]));
    // 3 selected: only deselects + confirm
    expect(togglesOf(h.legal("p1"))).toEqual(sorted([a, b, c]));
    expect(hasType(h.legal("p1"), "confirmPass")).toBe(true);
    expect(h.legal("p1")).toHaveLength(4);
    expect(h.tryAct("p1", { type: "togglePass", card: d })).not.toBeNull();
    // the hand itself does not change before confirming
    expect(h.state.hands.p1).toHaveLength(13);
    expect(h.view("p0").passConfirmed.p1).toBe(false);
  });

  it("confirmPass removes the 3 cards at once and ends that player's pass actions", () => {
    const h = mk(4);
    const pick = sorted(h.state.hands.p1).slice(0, 3);
    for (const card of pick) h.act("p1", { type: "togglePass", card });
    h.act("p1", { type: "confirmPass" });
    const s = h.state;
    expect(s.phase).toBe("pass");
    expect(s.hands.p1).toHaveLength(10);
    for (const c of pick) expect(s.hands.p1).not.toContain(c);
    expect(h.legal("p1")).toEqual([]);
    expect(h.tryAct("p1", { type: "togglePass", card: s.hands.p1[0] })).not.toBeNull();
    expect(h.tryAct("p1", { type: "togglePass", card: pick[0] })).not.toBeNull();
    expect(h.tryAct("p1", { type: "confirmPass" })).not.toBeNull();
    expect(sorted(plugin.activePlayers(s))).toEqual(["p0", "p2", "p3"]);
    const v1 = h.view("p1");
    expect(sorted(v1.myPassed!)).toEqual(pick);
    expect(v1.myHand).toHaveLength(10);
    expect(v1.received).toBeNull();
    for (const viewer of ["p0", "p2", "p3", null]) {
      const v = h.view(viewer);
      expect(v.passConfirmed.p1).toBe(true);
      expect(v.passConfirmed.p0).toBe(false);
      expect(v.handCounts.p1).toBe(10);
      // the receiver (p2) must not see the cards before the exchange either
      expect(findLeaks(v, pick)).toEqual([]);
    }
    for (const viewer of ["p0", "p2", "p3"]) expect(findLeaks(h.legal(viewer), pick)).toEqual([]);
    checkNoLeaks(h);
  });

  it("selections are secret", () => {
    const h = mk(4);
    const card = h.state.hands.p2[5];
    h.act("p2", { type: "togglePass", card });
    expect(h.view("p2").passSelected).toEqual([card]);
    for (const viewer of ["p0", "p1", "p3", null]) {
      expect(h.view(viewer).passSelected).toEqual([]);
      expect(findLeaks(h.view(viewer), [card])).toEqual([]);
    }
    expect(h.view("p0").passConfirmed.p2).toBe(false);
    checkNoLeaks(h);
  });

  it("rejects bad pass actions", () => {
    const h = mk(4);
    const notMine = h.state.hands.p2[0];
    expect(h.tryAct("p1", { type: "togglePass", card: notMine })).not.toBeNull();
    expect(h.tryAct("p1", { type: "togglePass", card: "ZZ" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "play", card: h.state.hands.p1[0] })).not.toBeNull();
    expect(h.tryAct("p0", { type: "nextHand" })).not.toBeNull();
    expect(h.tryAct("spectator", { type: "togglePass", card: h.state.hands.p0[0] })).not.toBeNull();
    expect(h.tryAct("spectator", { type: "confirmPass" })).not.toBeNull();
    const holderOf2C = h.state.order.find((id) => h.state.hands[id].includes("2C"))!;
    expect(h.tryAct(holderOf2C, { type: "play", card: "2C" })).not.toBeNull();
    expect(h.state.phase).toBe("pass");
  });

  it("exchange happens only when the last player confirms (left, 4p)", () => {
    const h = mk(4);
    const order = h.state.order;
    for (const id of order.slice(0, 3)) {
      for (const card of sorted(h.state.hands[id]).slice(0, 3)) h.act(id, { type: "togglePass", card });
      h.act(id, { type: "confirmPass" });
      expect(h.state.phase).toBe("pass");
      expect(h.view(id).received).toBeNull();
      checkNoLeaks(h);
    }
    expect(plugin.activePlayers(h.state)).toEqual(["p3"]);
    // p0's passed cards go to p1; p1 still has only 10 cards
    expect(h.state.hands.p1).toHaveLength(10);
  });

  it.each([3, 4, 5, 6])("exchanges left on hand 1 with %i players", (n) => {
    checkExchange(mk(n, {}, 11), "left");
  });

  it.each([
    [4, 2, "right"],
    [4, 3, "across"],
    [3, 2, "right"],
    [5, 2, "right"],
    [6, 2, "right"],
    [6, 3, "across"],
  ] as const)("exchanges with %i players on hand %i (%s)", (n, hand, dir) => {
    const h = mk(n, {}, 5);
    expect(passDirectionFor("standard", n, hand)).toBe(dir);
    h.setState({ ...h.state, hand, dealer: (hand - 1) % n, passDirection: dir });
    checkExchange(h, dir);
  });

  it("across in 4p swaps opposite seats", () => {
    expect(passTarget(["p0", "p1", "p2", "p3"], "p0", "across")).toBe("p2");
    expect(passTarget(["p0", "p1", "p2", "p3"], "p3", "across")).toBe("p1");
    expect(passTarget(["p0", "p1", "p2", "p3"], "p0", "right")).toBe("p3");
  });

  it("the opening card can be passed; the receiver then leads it", () => {
    const h = mk(4, {}, 3);
    const holder = h.state.order.find((id) => h.state.hands[id].includes("2C"))!;
    const receiver = passTarget(h.state.order, holder, "left")!;
    passAll(h, (id, hand) => (id === holder ? ["2C", ...sorted(hand.filter((c) => c !== "2C")).slice(0, 2)] : sorted(hand.filter((c) => c !== "2C")).slice(0, 3)));
    expect(h.state.hands[receiver]).toContain("2C");
    expect(h.state.turn).toBe(receiver);
    expect(h.legal(receiver)).toEqual([{ type: "play", card: "2C" }]);
  });
});

// ---------------------------------------------------------------------------
// Pass direction rotation, hold hands, next hand, dealer
// ---------------------------------------------------------------------------

describe("pass rotation and next hand", () => {
  it("passDirectionFor sequences", () => {
    const seq = (p: string, n: number) => [1, 2, 3, 4, 5, 6, 7, 8].map((h) => passDirectionFor(p, n, h));
    expect(seq("standard", 4)).toEqual(["left", "right", "across", "hold", "left", "right", "across", "hold"]);
    expect(seq("standard", 6)).toEqual(["left", "right", "across", "hold", "left", "right", "across", "hold"]);
    expect(seq("standard", 3)).toEqual(["left", "right", "hold", "left", "right", "hold", "left", "right"]);
    expect(seq("standard", 5)).toEqual(["left", "right", "hold", "left", "right", "hold", "left", "right"]);
    expect(seq("left", 4)).toEqual(Array(8).fill("left"));
    expect(seq("leftRight", 5)).toEqual(["left", "right", "left", "right", "left", "right", "left", "right"]);
    expect(seq("none", 4)).toEqual(Array(8).fill("hold"));
  });

  const cases: [number, string][] = [];
  for (const n of ALL_COUNTS) for (const p of ["standard", "left", "leftRight", "none"]) cases.push([n, p]);

  it.each(cases)("%i players, passPattern %s: each next hand uses the right direction and dealer", (n, passPattern) => {
    const h = mk(n, { passPattern }, 2);
    runUntil(h, (s) => s.phase === "handEnd");
    const base = h.state;
    for (let k = 1; k <= 8; k++) {
      // put the table at the end of hand k, then let the host deal hand k+1
      h.setState({ ...base, hand: k, dealer: (k - 1) % n });
      expect(h.legal("p1")).toEqual([]);
      expect(h.tryAct("p1", { type: "nextHand" })).not.toBeNull();
      expect(h.legal("p0")).toEqual([{ type: "nextHand" }]);
      h.act("p0", { type: "nextHand" });
      const s = h.state;
      const dir = passDirectionFor(passPattern, n, k + 1);
      expect(s.hand).toBe(k + 1);
      expect(s.passDirection).toBe(dir);
      expect(s.dealer).toBe(k % n);
      expect(h.view(null).dealer).toBe(`p${k % n}`);
      expect(s.phase).toBe(dir === "hold" ? "play" : "pass");
      expect(s.totals).toEqual(base.totals);
      expect(s.history).toEqual(base.history);
      for (const id of s.order) expect(s.hands[id]).toHaveLength(TRICKS[n]);
      expect(sorted(Object.values(s.hands).flat())).toEqual(sorted(deckFor(n)));
      expect(s.trickNumber).toBe(1);
      expect(s.trick).toEqual([]);
      expect(s.heartsBroken).toBe(false);
      const v = h.view("p0");
      expect(v.passTo).toBe(dir === "hold" ? null : passTarget(s.order, "p0", dir));
      expect(v.passFrom).toBe(dir === "hold" ? null : passSource(s.order, "p0", dir));
      expect(v.myPassed).toBeNull();
      expect(v.received).toBeNull();
      for (const id of s.order) {
        expect(v.pointCards[id]).toEqual([]);
        expect(v.handPoints[id]).toBe(0);
        expect(v.tricksWon[id]).toBe(0);
        expect(v.passConfirmed[id]).toBe(false);
      }
      if (dir === "hold") {
        for (const id of s.order) expect(hasType(h.legal(id), "togglePass")).toBe(false);
        const holder = s.order.find((id) => s.hands[id].includes(OPENING_CARD[n]))!;
        expect(s.turn).toBe(holder);
      } else {
        for (const id of s.order) expect(togglesOf(h.legal(id))).toHaveLength(TRICKS[n]);
        expect(sorted(plugin.activePlayers(s))).toEqual(sorted(s.order));
      }
      checkNoLeaks(h);
    }
  });

  it("leftOfDealer: the leader follows the dealer", () => {
    const n = 4;
    const h = mk(n, { passPattern: "none", firstLead: "leftOfDealer" }, 4);
    expect(h.state.turn).toBe("p1");
    runUntil(h, (s) => s.phase === "handEnd");
    const base = h.state;
    for (let k = 1; k <= 5; k++) {
      h.setState({ ...base, hand: k, dealer: (k - 1) % n });
      h.act("p0", { type: "nextHand" });
      expect(h.state.dealer).toBe(k % n);
      expect(h.state.turn).toBe(`p${(k + 1) % n}`);
      expect(plugin.activePlayers(h.state)).toEqual([`p${(k + 1) % n}`]);
    }
  });

  it("real hands rotate left, right, across, hold (4p)", () => {
    const h = mk(4, { targetScore: 500 }, 9);
    const seen: PassDirection[] = [];
    const dealers: number[] = [];
    for (let hand = 1; hand <= 5; hand++) {
      expect(h.state.hand).toBe(hand);
      seen.push(h.state.passDirection);
      dealers.push(h.state.dealer);
      runUntil(h, (s) => s.phase === "handEnd" || s.phase === "over");
      if (h.state.phase === "over") break;
      expect(plugin.activePlayers(h.state)).toEqual([]);
      h.act("p0", { type: "nextHand" });
    }
    expect(seen).toEqual(["left", "right", "across", "hold", "left"].slice(0, seen.length));
    expect(dealers).toEqual([0, 1, 2, 3, 0].slice(0, dealers.length));
  });
});

// ---------------------------------------------------------------------------
// Play: follow suit, hearts broken, first trick
// ---------------------------------------------------------------------------

describe("play rules", () => {
  it("must follow suit", () => {
    const h = mk(4, { passPattern: "none" });
    setPlay(h, {
      hands: { p0: ["2S", "9C"], p1: ["2D", "KD", "3S", "AH"], p2: ["4S", "5S"], p3: ["6S", "7S"] },
      turn: "p1",
      leader: "p0",
      trick: [{ playerId: "p0", card: "5D" }],
      trickNumber: 2,
    });
    expect(playsOf(h.legal("p1"))).toEqual(sorted(["2D", "KD"]));
    expect(h.tryAct("p1", { type: "play", card: "3S" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "play", card: "AH" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "play", card: "QD" })).not.toBeNull(); // not held
    expect(h.tryAct("p2", { type: "play", card: "4S" })).not.toBeNull(); // wrong turn
    expect(h.tryAct("p0", { type: "play", card: "2S" })).not.toBeNull(); // already played
    expect(h.tryAct("spectator", { type: "play", card: "KD" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "togglePass", card: "KD" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "confirmPass" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "nextHand" })).not.toBeNull();
    expect(h.legal("p0")).toEqual([]);
    expect(h.legal("p2")).toEqual([]);
    h.act("p1", { type: "play", card: "KD" });
    expect(h.state.turn).toBe("p2");
  });

  it("void players may discard anything after trick 1 (and a heart discard breaks hearts)", () => {
    const h = mk(4, { passPattern: "none" });
    setPlay(h, {
      hands: { p0: ["2S", "9C"], p1: ["3S", "AH", "QS"], p2: ["4S", "5S"], p3: ["6S", "7S"] },
      turn: "p1",
      leader: "p0",
      trick: [{ playerId: "p0", card: "5D" }],
      trickNumber: 2,
    });
    expect(playsOf(h.legal("p1"))).toEqual(sorted(["3S", "AH", "QS"]));
    h.act("p1", { type: "play", card: "AH" });
    expect(h.state.heartsBroken).toBe(true);
    expect(h.view("p3").heartsBroken).toBe(true);
  });

  it("the highest card of the led suit wins the trick; winner leads next", () => {
    const h = mk(4, { passPattern: "none" });
    setPlay(h, {
      hands: { p0: ["5D", "2S"], p1: ["KD", "3S"], p2: ["AS", "AH"], p3: ["9D", "4S"] },
      turn: "p0",
      leader: "p0",
      trickNumber: 2,
    });
    h.act("p0", { type: "play", card: "5D" });
    expect(h.state.trick).toEqual([{ playerId: "p0", card: "5D" }]);
    expect(h.view(null).trick).toEqual([{ playerId: "p0", card: "5D" }]);
    h.act("p1", { type: "play", card: "KD" });
    expect(playsOf(h.legal("p2"))).toEqual(sorted(["AS", "AH"]));
    h.act("p2", { type: "play", card: "AS" }); // off-suit ace does not win
    expect(playsOf(h.legal("p3"))).toEqual(["9D"]);
    h.act("p3", { type: "play", card: "9D" });
    const s = h.state;
    expect(s.trick).toEqual([]);
    expect(s.lastTrick).toEqual({
      plays: [
        { playerId: "p0", card: "5D" },
        { playerId: "p1", card: "KD" },
        { playerId: "p2", card: "AS" },
        { playerId: "p3", card: "9D" },
      ],
      winner: "p1",
    });
    expect(s.turn).toBe("p1");
    expect(s.leader).toBe("p1");
    expect(s.trickNumber).toBe(3);
    expect(s.tricksWon.p1).toBe(1);
    expect(sorted(s.taken.p1)).toEqual(sorted(["5D", "KD", "AS", "9D"]));
    expect(s.heartsBroken).toBe(false);
    const v = h.view("p2");
    expect(v.lastTrick?.winner).toBe("p1");
    expect(v.tricksWon.p1).toBe(1);
    expect(v.pointCards.p1).toEqual([]);
    expect(v.handPoints.p1).toBe(0);
    expect(v.trickNumber).toBe(3);
    expect(plugin.activePlayers(s)).toEqual(["p1"]);
  });

  it("point cards won are public and counted in handPoints", () => {
    const h = mk(4, { passPattern: "none" });
    setPlay(h, {
      hands: { p0: ["5D", "2S"], p1: ["KD", "3S"], p2: ["QS", "AH"], p3: ["4H", "4S"] },
      turn: "p0",
      leader: "p0",
      trickNumber: 2,
    });
    h.act("p0", { type: "play", card: "5D" });
    h.act("p1", { type: "play", card: "KD" });
    h.act("p2", { type: "play", card: "QS" });
    h.act("p3", { type: "play", card: "4H" });
    for (const viewer of ["p0", "p1", "p2", "p3", null]) {
      const v = h.view(viewer);
      expect(sorted(v.pointCards.p1)).toEqual(sorted(["QS", "4H"]));
      expect(v.handPoints.p1).toBe(14);
      expect(v.handPoints.p0).toBe(0);
      expect(v.heartsBroken).toBe(true);
    }
  });

  it("J♦ is a point card only with the jackOfDiamonds rule", () => {
    for (const jackOfDiamonds of [false, true]) {
      const h = mk(4, { passPattern: "none", jackOfDiamonds });
      setPlay(h, {
        hands: { p0: ["5D", "2S"], p1: ["KD", "3S"], p2: ["JD", "AS"], p3: ["4H", "4S"] },
        turn: "p0",
        leader: "p0",
        trickNumber: 2,
      });
      h.act("p0", { type: "play", card: "5D" });
      h.act("p1", { type: "play", card: "KD" });
      h.act("p2", { type: "play", card: "JD" });
      h.act("p3", { type: "play", card: "4H" });
      const v = h.view(null);
      expect(sorted(v.pointCards.p1)).toEqual(jackOfDiamonds ? sorted(["JD", "4H"]) : ["4H"]);
      expect(v.handPoints.p1).toBe(jackOfDiamonds ? -9 : 1);
    }
  });

  describe("leading hearts", () => {
    const lead = (settings: Partial<Settings>, hand: Card[], heartsBroken: boolean, trickNumber = 2) => {
      const h = mk(4, { passPattern: "none", ...settings });
      setPlay(h, {
        hands: { p0: hand, p1: ["2C", "3C"], p2: ["4C", "5C"], p3: ["6C", "7C"] },
        turn: "p0",
        leader: "p0",
        trickNumber,
        heartsBroken,
      });
      return h;
    };

    it("hearts cannot be led before they are broken", () => {
      const h = lead({}, ["2H", "KH", "3D", "QS"], false);
      expect(playsOf(h.legal("p0"))).toEqual(sorted(["3D", "QS"]));
      expect(h.tryAct("p0", { type: "play", card: "2H" })).not.toBeNull();
    });

    it("leading Q♠ is allowed and (by default) does not break hearts", () => {
      const h = lead({}, ["2H", "QS"], false);
      expect(playsOf(h.legal("p0"))).toEqual(["QS"]);
      h.act("p0", { type: "play", card: "QS" });
      expect(h.state.heartsBroken).toBe(false);
    });

    it("leading Q♠ breaks hearts with queenBreaksHearts", () => {
      const h = lead({ queenBreaksHearts: true }, ["2H", "QS"], false);
      h.act("p0", { type: "play", card: "QS" });
      expect(h.state.heartsBroken).toBe(true);
    });

    it("a leader with only hearts may lead one, which breaks hearts", () => {
      const h = lead({}, ["2H", "KH"], false);
      expect(playsOf(h.legal("p0"))).toEqual(sorted(["2H", "KH"]));
      h.act("p0", { type: "play", card: "KH" });
      expect(h.state.heartsBroken).toBe(true);
    });

    it("once broken, hearts may be led", () => {
      const h = lead({}, ["2H", "KH", "3D", "QS"], true);
      expect(playsOf(h.legal("p0"))).toEqual(sorted(["2H", "KH", "3D", "QS"]));
    });

    it("heartsMustBreak off: hearts may be led any time after trick 1", () => {
      const h = lead({ heartsMustBreak: false }, ["2H", "KH", "3D", "QS"], false);
      expect(playsOf(h.legal("p0"))).toEqual(sorted(["2H", "KH", "3D", "QS"]));
    });

    it("heartsMustBreak off: the first-trick rule still forbids leading hearts on trick 1", () => {
      const h = lead({ heartsMustBreak: false, firstLead: "leftOfDealer" }, ["2H", "KH", "3D", "QS"], false, 1);
      expect(playsOf(h.legal("p0"))).toEqual(["3D"]);
    });

    it("discarding Q♠ breaks hearts only with queenBreaksHearts", () => {
      for (const queenBreaksHearts of [false, true]) {
        const h = mk(4, { passPattern: "none", queenBreaksHearts });
        setPlay(h, {
          hands: { p0: ["5D", "2C"], p1: ["QS", "3C"], p2: ["6D", "4C"], p3: ["7D", "5C"] },
          turn: "p0",
          leader: "p0",
          trickNumber: 2,
        });
        h.act("p0", { type: "play", card: "5D" });
        h.act("p1", { type: "play", card: "QS" });
        expect(h.state.heartsBroken).toBe(queenBreaksHearts);
      }
    });

    it("after a heart discard the next leader may lead hearts", () => {
      const h = mk(4, { passPattern: "none" });
      setPlay(h, {
        hands: { p0: ["5D", "2H", "2S"], p1: ["AD", "3H", "3S"], p2: ["4H", "4C", "4S"], p3: ["6D", "5H", "5S"] },
        turn: "p0",
        leader: "p0",
        trickNumber: 2,
      });
      h.act("p0", { type: "play", card: "5D" });
      h.act("p1", { type: "play", card: "AD" });
      h.act("p2", { type: "play", card: "4H" });
      h.act("p3", { type: "play", card: "6D" });
      expect(h.state.turn).toBe("p1");
      expect(h.state.heartsBroken).toBe(true);
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["3H", "3S"]));
    });
  });

  describe("first trick (no points)", () => {
    const follow = (settings: Partial<Settings>, p1: Card[], led: Card = "2C") => {
      const h = mk(4, { passPattern: "none", ...settings });
      setPlay(h, {
        hands: { p0: ["9S", "9D"], p1, p2: ["TC", "TD"], p3: ["JC", "TS"] },
        turn: "p1",
        leader: "p0",
        trick: [{ playerId: "p0", card: led }],
        trickNumber: 1,
      });
      return h;
    };

    it("a void player may not discard hearts or Q♠ if they have another card (J♦ allowed)", () => {
      const h = follow({}, ["AH", "QS", "5D", "JD"]);
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["5D", "JD"]));
      expect(h.tryAct("p1", { type: "play", card: "AH" })).not.toBeNull();
      expect(h.tryAct("p1", { type: "play", card: "QS" })).not.toBeNull();
    });

    it("a void player with only hearts and Q♠ may play any of them", () => {
      const h = follow({}, ["AH", "QS", "2H"]);
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["AH", "QS", "2H"]));
      h.act("p1", { type: "play", card: "2H" });
      expect(h.state.heartsBroken).toBe(true);
    });

    it("a void player with only hearts may play any heart", () => {
      const h = follow({}, ["AH", "2H"]);
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["AH", "2H"]));
    });

    it("following suit still wins over the first-trick rule", () => {
      const h = follow({}, ["KC", "QS", "AH"]);
      expect(playsOf(h.legal("p1"))).toEqual(["KC"]);
    });

    it("Q♠ may not follow a spade lead on trick 1 when another spade is held", () => {
      const h = follow({ firstLead: "leftOfDealer" }, ["QS", "4S", "AH"], "9S");
      expect(playsOf(h.legal("p1"))).toEqual(["4S"]);
    });

    it("Q♠ as the only spade must follow a spade lead on trick 1", () => {
      const h = follow({ firstLead: "leftOfDealer" }, ["QS", "AH", "5D"], "8S");
      expect(playsOf(h.legal("p1"))).toEqual(["QS"]);
    });

    it("noPointsFirstTrick off allows hearts and Q♠ on trick 1", () => {
      const h = follow({ noPointsFirstTrick: false }, ["AH", "QS", "5D", "JD"]);
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["AH", "QS", "5D", "JD"]));
      h.act("p1", { type: "play", card: "QS" });
      expect(h.state.trick).toHaveLength(2);
    });

    it("leftOfDealer leader on trick 1: no hearts, no Q♠ if anything else", () => {
      const h = mk(4, { passPattern: "none", firstLead: "leftOfDealer" });
      setPlay(h, {
        hands: { p0: ["2C", "3C"], p1: ["QS", "5S", "3D", "4H"], p2: ["4C", "5C"], p3: ["6C", "7C"] },
        turn: "p1",
        leader: "p1",
        trickNumber: 1,
      });
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["5S", "3D"]));
    });

    it("leftOfDealer leader on trick 1 holding only Q♠ and hearts must lead Q♠", () => {
      const h = mk(4, { passPattern: "none", firstLead: "leftOfDealer" });
      setPlay(h, {
        hands: { p0: ["2C", "3C"], p1: ["QS", "4H", "9H"], p2: ["4C", "5C"], p3: ["6C", "7C"] },
        turn: "p1",
        leader: "p1",
        trickNumber: 1,
      });
      expect(playsOf(h.legal("p1"))).toEqual(["QS"]);
    });

    it("leftOfDealer leader on trick 1 holding only hearts may lead them", () => {
      const h = mk(4, { passPattern: "none", firstLead: "leftOfDealer" });
      setPlay(h, {
        hands: { p0: ["2C", "3C"], p1: ["4H", "9H"], p2: ["4C", "5C"], p3: ["6C", "7C"] },
        turn: "p1",
        leader: "p1",
        trickNumber: 1,
      });
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["4H", "9H"]));
    });

    it("trick 2 is not restricted", () => {
      const h = follow({}, ["AH", "QS", "5D"]);
      h.setState({ ...h.state, trickNumber: 2 });
      expect(playsOf(h.legal("p1"))).toEqual(sorted(["AH", "QS", "5D"]));
    });
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe("scoring", () => {
  it("hearts 1, Q♠ 13; hand ends after the last trick", () => {
    const h = mk(4, { passPattern: "none" });
    const s = playFinalTrick(h, SCENARIO_A);
    expect(s.phase).toBe("handEnd");
    expect(s.history).toHaveLength(1);
    const r = s.history[0];
    expect(r).toEqual<HandResult>({
      hand: 1,
      points: { p0: 15, p1: 6, p2: 5, p3: 0 },
      scores: { p0: 15, p1: 6, p2: 5, p3: 0 },
      moon: null,
      totals: { p0: 15, p1: 6, p2: 5, p3: 0 },
    });
    expect(s.totals).toEqual({ p0: 15, p1: 6, p2: 5, p3: 0 });
    expect(plugin.activePlayers(s)).toEqual([]);
    expect(plugin.isOver(s)).toBe(false);
    expect(h.match.over).toBe(false);
    expect(h.legal("p0")).toEqual([{ type: "nextHand" }]);
    for (const id of ["p1", "p2", "p3"]) expect(h.legal(id)).toEqual([]);
    expect(h.tryAct("p1", { type: "nextHand" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "play", card: "2S" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "togglePass", card: "2S" })).not.toBeNull();
    const v = h.view("p2");
    expect(v.phase).toBe("handEnd");
    expect(v.lastHand).toEqual(r);
    expect(v.history).toEqual([r]);
    expect(v.totals).toEqual(s.totals);
    expect(plugin.scores(s)).toEqual(rankScores(s.totals, false));
    const rank = Object.fromEntries(plugin.scores(s).map((l) => [l.playerId, l.rank]));
    expect(rank).toEqual({ p3: 1, p2: 2, p1: 3, p0: 4 });
    expect(plugin.deadline?.(s) ?? null).toBeNull();
    checkNoLeaks(h);
  });

  it("totals accumulate over hands and the next hand starts fresh", () => {
    const h = mk(4, { passPattern: "none" });
    playFinalTrick(h, { ...SCENARIO_A, totals: { p0: 10, p1: 20, p2: 30, p3: 40 } });
    expect(h.state.totals).toEqual({ p0: 25, p1: 26, p2: 35, p3: 40 });
    expect(h.state.history[0].totals).toEqual({ p0: 25, p1: 26, p2: 35, p3: 40 });
    h.act("p0", { type: "nextHand" });
    expect(h.state.hand).toBe(2);
    expect(h.state.totals).toEqual({ p0: 25, p1: 26, p2: 35, p3: 40 });
    expect(h.view("p1").lastHand).toEqual(h.state.history[0]);
    for (const id of h.state.order) expect(h.state.hands[id]).toHaveLength(13);
  });

  it("J♦ rule: whoever wins J♦ scores −10 (and totals can go negative)", () => {
    const h = mk(4, { passPattern: "none", jackOfDiamonds: true });
    const s = playFinalTrick(h, SCENARIO_A);
    expect(s.history[0].points).toEqual({ p0: 15, p1: 6, p2: 5, p3: -10 });
    expect(s.history[0].scores).toEqual({ p0: 15, p1: 6, p2: 5, p3: -10 });
    expect(s.totals.p3).toBe(-10);
    expect(plugin.scores(s).find((l) => l.playerId === "p3")!.rank).toBe(1);
    expect(h.view(null).pointCards.p3).toEqual(["JD"]);
  });

  it("J♦ is worth nothing without the rule", () => {
    const h = mk(4, { passPattern: "none", jackOfDiamonds: false });
    const s = playFinalTrick(h, SCENARIO_A);
    expect(s.history[0].points.p3).toBe(0);
    expect(h.view(null).pointCards.p3).toEqual([]);
  });

  it('moon "others": shooter 0, everyone else +26', () => {
    const h = mk(4, { passPattern: "none" });
    const s = playFinalTrick(h, moonScenario("p1"));
    expect(s.history[0]).toEqual<HandResult>({
      hand: 1,
      points: { p0: 26, p1: 0, p2: 0, p3: 0 },
      scores: { p0: 0, p1: 26, p2: 26, p3: 26 },
      moon: "p0",
      totals: { p0: 0, p1: 26, p2: 26, p3: 26 },
    });
    expect(h.view("p1").lastHand?.moon).toBe("p0");
  });

  it('moon "self": shooter −26, everyone else 0', () => {
    const h = mk(4, { passPattern: "none", moon: "self" });
    const s = playFinalTrick(h, moonScenario("p1"));
    expect(s.history[0]).toEqual<HandResult>({
      hand: 1,
      points: { p0: 26, p1: 0, p2: 0, p3: 0 },
      scores: { p0: -26, p1: 0, p2: 0, p3: 0 },
      moon: "p0",
      totals: { p0: -26, p1: 0, p2: 0, p3: 0 },
    });
  });

  it('moon "off": the shooter simply takes 26', () => {
    const h = mk(4, { passPattern: "none", moon: "off" });
    const s = playFinalTrick(h, moonScenario("p1"));
    expect(s.history[0]).toEqual<HandResult>({
      hand: 1,
      points: { p0: 26, p1: 0, p2: 0, p3: 0 },
      scores: { p0: 26, p1: 0, p2: 0, p3: 0 },
      moon: null,
      totals: { p0: 26, p1: 0, p2: 0, p3: 0 },
    });
  });

  it('moon "others" + shooter also won J♦ → shooter −10', () => {
    const h = mk(4, { passPattern: "none", jackOfDiamonds: true });
    const s = playFinalTrick(h, moonScenario("p0"));
    expect(s.history[0].points).toEqual({ p0: 16, p1: 0, p2: 0, p3: 0 });
    expect(s.history[0].scores).toEqual({ p0: -10, p1: 26, p2: 26, p3: 26 });
    expect(s.history[0].moon).toBe("p0");
  });

  it('moon "others" + another player won J♦ → that player 16', () => {
    const h = mk(4, { passPattern: "none", jackOfDiamonds: true });
    const s = playFinalTrick(h, moonScenario("p2"));
    expect(s.history[0].points).toEqual({ p0: 26, p1: 0, p2: -10, p3: 0 });
    expect(s.history[0].scores).toEqual({ p0: 0, p1: 26, p2: 16, p3: 26 });
    expect(s.history[0].moon).toBe("p0");
  });

  it('moon "self" + another player won J♦', () => {
    const h = mk(4, { passPattern: "none", jackOfDiamonds: true, moon: "self" });
    const s = playFinalTrick(h, moonScenario("p1"));
    expect(s.history[0].points).toEqual({ p0: 26, p1: -10, p2: 0, p3: 0 });
    expect(s.history[0].scores).toEqual({ p0: -26, p1: -10, p2: 0, p3: 0 });
    expect(s.history[0].moon).toBe("p0");
  });

  it('moon "self" + shooter won J♦ → shooter −36', () => {
    const h = mk(4, { passPattern: "none", jackOfDiamonds: true, moon: "self" });
    const s = playFinalTrick(h, moonScenario("p0"));
    expect(s.history[0].scores).toEqual({ p0: -36, p1: 0, p2: 0, p3: 0 });
  });

  it("all hearts without Q♠ is not a moon", () => {
    const h = mk(4, { passPattern: "none" });
    const sc = moonScenario("p3");
    const s = playFinalTrick(h, { ...sc, taken: { ...sc.taken, p0: sc.taken.p0.filter((c) => c !== "QS"), p1: ["QS"] } });
    expect(s.history[0].moon).toBeNull();
    expect(s.history[0].points).toEqual({ p0: 13, p1: 13, p2: 0, p3: 0 });
    expect(s.history[0].scores).toEqual({ p0: 13, p1: 13, p2: 0, p3: 0 });
  });

  it("moon in a 3-player hand (17 tricks)", () => {
    const h = mk(3, { passPattern: "none" });
    const order = h.state.order;
    const filler = deckFor(3).filter((c) => !isPenalty(c) && !["2S", "3S", "4S"].includes(c));
    const taken = { p0: ["QS", ...HEARTS.filter((c) => c !== "AH"), ...filler.slice(0, 10)], p1: filler.slice(10, 30), p2: filler.slice(30) };
    setPlay(h, {
      hands: { p0: ["AH"], p1: ["2S"], p2: ["3S"] },
      turn: "p0",
      leader: "p0",
      trickNumber: 17,
      heartsBroken: true,
      taken,
    });
    expect(sorted([...Object.values(taken).flat(), "AH", "2S", "3S"])).toEqual(sorted(deckFor(3)));
    for (const id of order) h.act(id, { type: "play", card: h.state.hands[id][0] });
    expect(h.state.phase).toBe("handEnd");
    expect(h.state.history[0].scores).toEqual({ p0: 0, p1: 26, p2: 26 });
    expect(h.state.history[0].moon).toBe("p0");
  });
});

// ---------------------------------------------------------------------------
// End of game
// ---------------------------------------------------------------------------

describe("end of game", () => {
  it("ends immediately when a total reaches the target (≥), lowest wins, ties share", () => {
    const h = mk(4, { passPattern: "none" });
    const s = playFinalTrick(h, { ...SCENARIO_A, totals: { p0: 0, p1: 95, p2: 10, p3: 20 } });
    expect(s.totals).toEqual({ p0: 15, p1: 101, p2: 15, p3: 20 });
    expect(s.phase).toBe("over");
    expect(plugin.isOver(s)).toBe(true);
    expect(h.match.over).toBe(true);
    expect(plugin.activePlayers(s)).toEqual([]);
    for (const id of s.order) {
      expect(h.legal(id)).toEqual([]);
      expect(plugin.legalActions(s, { id, isHost: true })).toEqual([]);
    }
    expect(h.tryAct("p0", { type: "nextHand" })).not.toBeNull();
    const rank = Object.fromEntries(plugin.scores(s).map((l) => [l.playerId, l.rank]));
    expect(rank).toEqual({ p0: 1, p2: 1, p3: 3, p1: 4 });
    const score = Object.fromEntries(plugin.scores(s).map((l) => [l.playerId, l.score]));
    expect(score).toEqual(s.totals);
    expect(plugin.deadline?.(s) ?? null).toBeNull();
    expect(h.view(null).phase).toBe("over");
    expect(h.view(null).lastHand).toEqual(s.history[0]);
    checkNoLeaks(h);
  });

  it("exactly the target ends the game", () => {
    const h = mk(4, { passPattern: "none" });
    const s = playFinalTrick(h, { ...SCENARIO_A, totals: { p0: 0, p1: 94, p2: 0, p3: 0 } });
    expect(s.totals.p1).toBe(100);
    expect(s.phase).toBe("over");
  });

  it("one below the target continues", () => {
    const h = mk(4, { passPattern: "none" });
    const s = playFinalTrick(h, { ...SCENARIO_A, totals: { p0: 0, p1: 93, p2: 0, p3: 0 } });
    expect(s.totals.p1).toBe(99);
    expect(s.phase).toBe("handEnd");
    expect(h.match.over).toBe(false);
  });

  it("targetScore setting changes when the game ends", () => {
    const a = mk(4, { passPattern: "none", targetScore: 50 });
    expect(a.state.settings.targetScore).toBe(50);
    expect(a.view(null).targetScore).toBe(50);
    expect(playFinalTrick(a, { ...SCENARIO_A, totals: { p0: 0, p1: 44, p2: 0, p3: 0 } }).phase).toBe("over");
    const b = mk(4, { passPattern: "none" });
    expect(playFinalTrick(b, { ...SCENARIO_A, totals: { p0: 0, p1: 44, p2: 0, p3: 0 } }).phase).toBe("handEnd");
  });

  it("a moon can push the others over the target; the shooter wins alone", () => {
    const h = mk(4, { passPattern: "none" });
    const s = playFinalTrick(h, { ...moonScenario("p1"), totals: { p0: 60, p1: 80, p2: 50, p3: 40 } });
    expect(s.totals).toEqual({ p0: 60, p1: 106, p2: 76, p3: 66 });
    expect(s.phase).toBe("over");
    const rank = Object.fromEntries(plugin.scores(s).map((l) => [l.playerId, l.rank]));
    expect(rank).toEqual({ p0: 1, p3: 2, p2: 3, p1: 4 });
  });

  it("live scores mid-game rank by lower total", () => {
    const h = mk(4);
    h.setState({ ...h.state, totals: { p0: 30, p1: 10, p2: 10, p3: 5 } });
    expect(plugin.scores(h.state)).toEqual(rankScores({ p0: 30, p1: 10, p2: 10, p3: 5 }, false));
    const rank = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, l.rank]));
    expect(rank).toEqual({ p3: 1, p1: 2, p2: 2, p0: 4 });
    expect(h.envelope("p1").scores).toEqual(plugin.scores(h.state));
  });
});

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

describe("turn timer", () => {
  it("no deadline when the timer is off", () => {
    const h = mk(4);
    expect(plugin.deadline?.(h.state) ?? null).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
    expect(h.state.phase).toBe("pass");
  });

  it("pass phase: one deadline for everyone; timeout completes and commits every pass", () => {
    const h = mk(4, { turnTimer: 30 }, 6);
    expect(plugin.deadline!(h.state)).toBe(T0 + 30_000);
    expect(h.envelope("p1").deadline).toBe(T0 + 30_000);
    const before = byId(h.state.order, (id) => [...h.state.hands[id]]);
    // p1 pre-selects one card, p2 confirms a full pass
    h.now = T0 + 5_000;
    const keep = before.p1[4];
    h.act("p1", { type: "togglePass", card: keep });
    const p2pass = sorted(before.p2).slice(0, 3);
    for (const card of p2pass) h.act("p2", { type: "togglePass", card });
    h.act("p2", { type: "confirmPass" });
    expect(plugin.deadline!(h.state)).toBe(T0 + 30_000);
    expect(h.advanceTime(10_000)).toBe(false);
    expect(h.state.phase).toBe("pass");
    expect(h.advanceTime(15_000)).toBe(true);
    const s = h.state;
    expect(s.phase).toBe("play");
    for (const id of s.order) {
      expect(s.hands[id]).toHaveLength(13);
      const v = h.view(id);
      expect(v.myPassed).toHaveLength(3);
      for (const c of v.myPassed!) expect(before[id]).toContain(c);
      expect(sorted(v.received!)).toEqual(sorted(h.view(passSource(s.order, id, "left")!).myPassed!));
    }
    expect(h.view("p1").myPassed).toContain(keep);
    expect(sorted(h.view("p2").myPassed!)).toEqual(p2pass);
    checkNoLeaks(h);
    checkInvariants(h);
  });

  it("play phase: deadline is previous play + timer; timeout plays a legal card", () => {
    const h = mk(4, { turnTimer: 30, passPattern: "none" }, 6);
    expect(h.state.phase).toBe("play");
    expect(plugin.deadline!(h.state)).toBe(T0 + 30_000);
    const holder = h.state.turn!;
    expect(h.advanceTime(29_999)).toBe(false);
    expect(h.advanceTime(1)).toBe(true);
    expect(h.state.trick).toEqual([{ playerId: holder, card: "2C" }]);
    const t1 = h.now;
    expect(plugin.deadline!(h.state)).toBe(t1 + 30_000);
    // a manual play resets the clock
    h.now = t1 + 7_000;
    const next = h.state.turn!;
    const card = playsOf(h.legal(next))[0];
    h.act(next, { type: "play", card });
    expect(plugin.deadline!(h.state)).toBe(t1 + 7_000 + 30_000);
    // timeout plays a legal card for the current player
    const who = h.state.turn!;
    const legal = playsOf(h.legal(who));
    expect(h.advanceTime(30_000)).toBe(true);
    const last = h.state.trick[h.state.trick.length - 1];
    expect(last.playerId).toBe(who);
    expect(legal).toContain(last.card);
  });

  it("no deadline in handEnd/over", () => {
    const h = mk(4, { turnTimer: 30, passPattern: "none" });
    playFinalTrick(h, SCENARIO_A);
    expect(h.state.phase).toBe("handEnd");
    expect(plugin.deadline!(h.state)).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
  });

  it.each([3, 6])("timeouts alone (host only deals) finish a %i-player game", (n) => {
    const h = mk(n, { turnTimer: 15, targetScore: 50 }, 3);
    for (let i = 0; i < 5000 && !h.match.over; i++) {
      if (h.state.phase === "handEnd") h.act("p0", { type: "nextHand" });
      else expect(h.advanceTime(15_000)).toBe(true);
      checkInvariants(h);
    }
    expect(h.match.over).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hidden information across whole games
// ---------------------------------------------------------------------------

describe("viewFor / legal never leak", () => {
  const cases: [number, Partial<Settings>][] = [
    [4, {}],
    [3, {}],
    [5, { firstLead: "leftOfDealer" }],
    [6, { jackOfDiamonds: true, passPattern: "leftRight" }],
    [4, { passPattern: "left", moon: "self", queenBreaksHearts: true }],
  ];
  it.each(cases)("%i players %j: every state of a bot game", (n, settings) => {
    const h = mk(n, { targetScore: 60, ...settings }, 21);
    const phases = new Set<string>();
    checkNoLeaks(h);
    for (let i = 0; i < 20_000 && botStep(h); i++) {
      phases.add(h.state.phase);
      checkInvariants(h);
      checkNoLeaks(h);
    }
    expect(h.match.over).toBe(true);
    for (const p of ["pass", "play", "handEnd", "over"]) expect(phases.has(p)).toBe(true);
  });

  it("the passed cards stay secret in the receiver's hand (only receiver and passer know)", () => {
    const h = mk(4, {}, 13);
    const chosen = passAll(h);
    // p1 received p0's cards; p2/p3/spectator must not see them, p0 legitimately does
    for (const viewer of ["p2", "p3", null]) expect(findLeaks(h.view(viewer), chosen.p0)).toEqual([]);
    expect(sorted(h.view("p0").myPassed!)).toEqual(sorted(chosen.p0));
    expect(sorted(h.view("p1").received!)).toEqual(sorted(chosen.p0));
  });
});

// ---------------------------------------------------------------------------
// Determinism and bots
// ---------------------------------------------------------------------------

function checkHistory(s: State): void {
  const st = s.settings;
  const n = s.order.length;
  const running = byId(s.order, () => 0);
  s.history.forEach((r, i) => {
    expect(r.hand).toBe(i + 1);
    const pts = s.order.map((id) => r.points[id]);
    const sc = s.order.map((id) => r.scores[id]);
    const jd = st.jackOfDiamonds ? -10 : 0;
    expect(pts.reduce((a, b) => a + b, 0)).toBe(26 + jd);
    if (st.moon === "off") expect(r.moon).toBeNull();
    if (r.moon === null) expect(r.scores).toEqual(r.points);
    else if (st.moon === "others") expect(sc.reduce((a, b) => a + b, 0)).toBe(26 * (n - 1) + jd);
    else if (st.moon === "self") expect(sc.reduce((a, b) => a + b, 0)).toBe(-26 + jd);
    if (!st.jackOfDiamonds && st.moon !== "off") {
      const shooter = s.order.find((id) => r.points[id] === 26) ?? null;
      expect(r.moon).toBe(shooter);
    }
    for (const id of s.order) running[id] += r.scores[id];
    expect(r.totals).toEqual(running);
    const reached = Object.values(r.totals).some((t) => t >= st.targetScore);
    expect(reached).toBe(i === s.history.length - 1);
  });
  expect(s.totals).toEqual(running);
}

describe("determinism", () => {
  it("same seed, same game; different seed, different game", () => {
    const a = simulateGame(plugin, { players: 4, seed: 42 });
    const b = simulateGame(plugin, { players: 4, seed: 42 });
    const c = simulateGame(plugin, { players: 4, seed: 43 });
    expect(a.log).toEqual(b.log);
    expect(a.match.state).toEqual(b.match.state);
    expect(c.log).not.toEqual(a.log);
  });

  it("reduce does not mutate state (harness freezes every state)", () => {
    const h = mk(4, {}, 8);
    for (let i = 0; i < 200 && botStep(h); i++) {
      expect(Object.isFrozen(h.state)).toBe(true);
    }
  });
});

describe("bots finish games", () => {
  const variants: Partial<Settings>[] = [
    {},
    { passPattern: "none" },
    { passPattern: "left" },
    { passPattern: "leftRight" },
    { firstLead: "leftOfDealer" },
    { noPointsFirstTrick: false, heartsMustBreak: false },
    { queenBreaksHearts: true },
    { moon: "self", jackOfDiamonds: true },
    { moon: "off", jackOfDiamonds: true, targetScore: 50 },
    { turnTimer: 30, firstLead: "leftOfDealer", passPattern: "none", heartsMustBreak: false },
  ];
  const cases: [number, number, Partial<Settings>][] = [];
  for (const n of ALL_COUNTS) variants.forEach((v, i) => cases.push([n, i, v]));

  it.each(cases)("%i players, variant %i", (n, _i, settings) => {
    for (const seed of [1, 2, 3]) {
      const res = simulateGame(plugin, { players: n, settings, seed });
      const s = res.match.state as State;
      expect(res.match.over).toBe(true);
      expect(s.phase).toBe("over");
      expect(plugin.isOver(s)).toBe(true);
      expect(s.history.length).toBeGreaterThan(0);
      checkHistory(s);
      const lines = plugin.scores(s);
      expect(lines).toHaveLength(n);
      const best = Math.min(...Object.values(s.totals));
      for (const l of lines) expect(l.rank === 1).toBe(l.score === best);
    }
  });
});
