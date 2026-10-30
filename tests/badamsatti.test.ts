/**
 * Badam Satti / Sevens rules tests. Written from SPEC.md, ENGINE_CONTRACT.md, games/badamsatti/BRIEF.md
 * and games/badamsatti/types.ts only (not from rules.ts).
 */
import { describe, expect, it } from "vitest";
import plugin from "../games/badamsatti/rules";
import {
  BOARD_SUIT_ORDER,
  LOG_LIMIT,
  START_CARD,
  rankLine,
  type Action,
  type RoundResult,
  type State,
  type SuitRange,
  type View,
} from "../games/badamsatti/types";
import { makeDeck, rankOf, suitOf, type Card, type PlayerId, type Rank, type Suit } from "../engine";
import { createRng, type Rng } from "../engine/rng";
import { buildView, startMatch } from "../engine/match";
import {
  assertJsonSafe,
  createHarness,
  deepFreeze,
  findLeaks,
  makePlayers,
  simulateGame,
  type Harness,
} from "../engine/testing";

// ---------------------------------------------------------------------------
// Helpers (spec oracle, crafted positions)
// ---------------------------------------------------------------------------

type H = Harness<State, Action, View>;
type Board = Record<Suit, SuitRange>;
type SettingsIn = Partial<{ firstCard7H: boolean; aceHigh: boolean; allowPassWhenAble: boolean; playToEnd: boolean; rounds: number }>;

const DECK = makeDeck();
const SUITS4: Suit[] = ["S", "H", "D", "C"];

function mk(players: number, settings: SettingsIn = {}, seed = 1): H {
  return createHarness<State, Action, View>(plugin, { players, settings, seed });
}

const sortStr = (xs: readonly string[]) => xs.slice().sort();
const actKey = (a: Action) => JSON.stringify(a, Object.keys(a).sort());
const sortActs = (xs: readonly Action[]) => xs.map(actKey).sort();
const play = (card: Card): Action => ({ type: "play", card });
const PASS: Action = { type: "pass" };
const NEXT: Action = { type: "nextRound" };

/** Cards of `suit` covered by the range (inclusive) on the rank line. */
function rangeCards(suit: Suit, r: SuitRange, aceHigh: boolean): Card[] {
  if (!r) return [];
  const line = rankLine(aceHigh);
  const lo = line.indexOf(r.low), hi = line.indexOf(r.high);
  if (lo < 0 || hi < 0 || lo > hi) throw new Error(`bad range ${suit} ${JSON.stringify(r)}`);
  return line.slice(lo, hi + 1).map((rk) => `${rk}${suit}`);
}
function boardCards(board: Board, aceHigh: boolean): Card[] {
  return SUITS4.flatMap((s) => rangeCards(s, board[s], aceHigh));
}
function offBoard(board: Board, aceHigh: boolean): Card[] {
  const on = new Set(boardCards(board, aceHigh));
  return DECK.filter((c) => !on.has(c));
}

/** Cards of `hand` that the spec allows on `board`: a 7 of a closed suit, or the next rank down/up of an open suit. */
function playable(hand: readonly Card[], board: Board, aceHigh: boolean): Card[] {
  const line = rankLine(aceHigh);
  return hand.filter((c) => {
    const s = suitOf(c), r = rankOf(c), rg = board[s];
    if (!rg) return r === "7";
    const i = line.indexOf(r);
    return i === line.indexOf(rg.low) - 1 || i === line.indexOf(rg.high) + 1;
  });
}

/** The spec's legal action set for a non-host / host actor. */
function expectedLegal(st: State, pid: PlayerId, isHost: boolean): Action[] {
  if (st.phase === "roundOver") return isHost ? [NEXT] : [];
  if (st.phase !== "play" || st.turn !== pid) return [];
  const hand = st.hands[pid] ?? [];
  if (st.playedCount === 0) {
    const opens = st.settings.firstCard7H ? hand.filter((c) => c === START_CARD) : hand.filter((c) => rankOf(c) === "7");
    return opens.map(play);
  }
  const plays = playable(hand, st.board, st.settings.aceHigh).map(play);
  if (plays.length === 0 || st.settings.allowPassWhenAble) return [...plays, PASS];
  return plays;
}

function holderOf(st: State, card: Card): PlayerId {
  const p = st.order.find((id) => st.hands[id].includes(card));
  if (!p) throw new Error(`${card} not in any hand`);
  return p;
}
function nextClockwise(order: readonly PlayerId[], from: PlayerId, skip: (p: PlayerId) => boolean): PlayerId {
  const i = order.indexOf(from);
  for (let k = 1; k <= order.length; k++) {
    const p = order[(i + k) % order.length];
    if (!skip(p)) return p;
  }
  return from;
}
function othersCards(st: State, viewer: PlayerId | null): Card[] {
  return st.order.filter((p) => p !== viewer).flatMap((p) => st.hands[p]);
}
function moveCard(hands: Record<PlayerId, Card[]>, card: Card, to: PlayerId): Record<PlayerId, Card[]> {
  const out: Record<PlayerId, Card[]> = {};
  for (const [p, h] of Object.entries(hands)) out[p] = h.filter((c) => c !== card);
  out[to] = [...out[to], card];
  return out;
}
function zeroMap<T>(order: readonly PlayerId[], v: T): Record<PlayerId, T> {
  return Object.fromEntries(order.map((p) => [p, v]));
}

const CLOSED: Board = { S: null, H: null, D: null, C: null };
const full = (aceHigh: boolean): SuitRange => (aceHigh ? { low: "2", high: "A" } : { low: "A", high: "K" });
const rg = (low: Rank, high: Rank): SuitRange => ({ low, high });

/**
 * A crafted mid-round position: `explicit` hands for some players, the remaining off-board cards dealt
 * round-robin to `restTo`. Checks that every card is on the board or in exactly one hand.
 */
function craft(
  h: H,
  opts: {
    board: Board;
    turn: PlayerId;
    explicit: Record<PlayerId, Card[]>;
    restTo?: PlayerId[];
    patch?: Partial<State>;
  },
): State {
  const base = h.state;
  const aceHigh = (opts.patch?.settings ?? base.settings).aceHigh;
  const hands: Record<PlayerId, Card[]> = zeroMap(base.order, [] as Card[]);
  for (const p of base.order) hands[p] = [...(opts.explicit[p] ?? [])];
  const used = new Set(Object.values(opts.explicit).flat());
  const rest = offBoard(opts.board, aceHigh).filter((c) => !used.has(c));
  const restTo = opts.restTo ?? [];
  if (rest.length && !restTo.length) throw new Error(`craft: ${rest.length} cards unassigned: ${rest.join(",")}`);
  rest.forEach((c, i) => hands[restTo[i % restTo.length]].push(c));
  // Sanity: exactly the 52 cards.
  const all = [...boardCards(opts.board, aceHigh), ...Object.values(hands).flat()];
  expect(sortStr(all)).toEqual(sortStr(DECK));
  const st: State = {
    ...base,
    hands,
    board: opts.board,
    phase: "play",
    turn: opts.turn,
    playedCount: boardCards(opts.board, aceHigh).length,
    finishOrder: [],
    passedLastTurn: zeroMap(base.order, false),
    log: [],
    ...opts.patch,
  };
  h.setState(st);
  return st;
}

function expectNoLeaks(h: H, label: string) {
  const st = h.state;
  for (const viewer of [...st.order, null]) {
    const secrets = othersCards(st, viewer);
    const v = h.view(viewer);
    expect(findLeaks(v, secrets), `${label}: view of ${viewer} leaks`).toEqual([]);
    expect(findLeaks(h.envelope(viewer), secrets), `${label}: envelope of ${viewer} leaks`).toEqual([]);
    if (viewer) expect(findLeaks(h.legal(viewer), secrets), `${label}: legal of ${viewer} leaks`).toEqual([]);
  }
  expect(plugin.legalActions(st, { id: "spectator", isHost: false })).toEqual([]);
  const spec = h.view(null);
  expect(spec.myHand).toEqual([]);
}

function expectedScores(totals: Record<PlayerId, number>) {
  return Object.entries(totals)
    .map(([playerId, score]) => ({
      playerId,
      score,
      rank: 1 + Object.values(totals).filter((o) => o < score).length,
    }))
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
}
function sortedScores(st: State) {
  return plugin
    .scores(st)
    .map((l) => ({ playerId: l.playerId, score: l.score, rank: l.rank }))
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
}
function rankMap(st: State): Record<PlayerId, number> {
  return Object.fromEntries(plugin.scores(st).map((l) => [l.playerId, l.rank]));
}

// ---------------------------------------------------------------------------
// Meta and settings
// ---------------------------------------------------------------------------

describe("badamsatti: meta and settings", () => {
  it("has the right id and player range 3–8", () => {
    expect(plugin.meta.id).toBe("badamsatti");
    expect(plugin.meta.minPlayers).toBe(3);
    expect(plugin.meta.maxPlayers).toBe(8);
    expect(() => mk(2)).toThrow();
    expect(() => mk(9)).toThrow();
  });

  it("declares every house rule with the brief's defaults", () => {
    const byKey = Object.fromEntries(plugin.settings.map((f) => [f.key, f]));
    expect(byKey.firstCard7H).toMatchObject({ type: "boolean", default: true });
    expect(byKey.aceHigh).toMatchObject({ type: "boolean", default: false });
    expect(byKey.allowPassWhenAble).toMatchObject({ type: "boolean", default: false });
    expect(byKey.playToEnd).toMatchObject({ type: "boolean", default: false });
    expect(byKey.rounds).toMatchObject({ type: "number", default: 1, min: 1, max: 10 });
  });

  it("exposes the resolved rules publicly in the view (rounds clamped)", () => {
    expect(mk(4).view("p1").rules).toEqual({
      openWithSevenOfHearts: true,
      aceHigh: false,
      allowPassWhenAble: false,
      playToEnd: false,
      rounds: 1,
    });
    const h = mk(4, { firstCard7H: false, aceHigh: true, allowPassWhenAble: true, playToEnd: true, rounds: 99 });
    expect(h.view(null).rules).toEqual({
      openWithSevenOfHearts: false,
      aceHigh: true,
      allowPassWhenAble: true,
      playToEnd: true,
      rounds: 10,
    });
    expect(h.view(null).totalRounds).toBe(10);
    expect(mk(3, { rounds: 0 }).view("p0").totalRounds).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("badamsatti: setup", () => {
  it.each([3, 4, 5, 6, 7, 8])("deals the full deck to %i players (uneven hands, each card once)", (n) => {
    for (const seed of [1, 2, 3]) {
      const h = mk(n, {}, seed);
      const st = h.state;
      expect(st.order).toEqual(makePlayers(n).map((p) => p.id));
      const all = st.order.flatMap((p) => st.hands[p]);
      expect(all).toHaveLength(52);
      expect(sortStr(all)).toEqual(sortStr(DECK));
      const sizes = st.order.map((p) => st.hands[p].length);
      const lo = Math.floor(52 / n), hi = Math.ceil(52 / n);
      for (const s of sizes) expect(s === lo || s === hi).toBe(true);
      expect(sizes.filter((s) => s === hi && hi !== lo).length).toBe(52 % n);
      expect(Object.keys(st.hands).sort()).toEqual(sortStr(st.order));
      // Views report the same counts.
      const v = h.view(null);
      for (const p of st.order) expect(v.handCounts[p]).toBe(st.hands[p].length);
    }
  });

  it("the 7♥ holder starts; board closed; round 1; nobody has penalty", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = mk(5, {}, seed);
      const st = h.state;
      const holder = holderOf(st, "7H");
      expect(st.phase).toBe("play");
      expect(st.round).toBe(1);
      expect(st.starter).toBe(holder);
      expect(st.turn).toBe(holder);
      expect(plugin.activePlayers(st)).toEqual([holder]);
      expect(st.playedCount).toBe(0);
      expect(st.board).toEqual(CLOSED);
      expect(st.finishOrder).toEqual([]);
      expect(st.history).toEqual([]);
      expect(st.totals).toEqual(zeroMap(st.order, 0));
      expect(plugin.isOver(st)).toBe(false);
      expect(h.match.over).toBe(false);
      const v = h.view("p0");
      expect(v.phase).toBe("play");
      expect(v.round).toBe(1);
      expect(v.totalRounds).toBe(1);
      expect(v.turn).toBe(holder);
      expect(v.starter).toBe(holder);
      expect(v.openingMove).toBe(true);
      expect(v.order).toEqual(st.order);
      expect(v.log).toEqual([]);
      expect(v.finishOrder).toEqual([]);
      expect(v.history).toEqual([]);
      expect(v.totals).toEqual(zeroMap(st.order, 0));
      expect(v.board.map((r) => r.suit)).toEqual([...BOARD_SUIT_ORDER]);
      for (const row of v.board) {
        expect(row).toMatchObject({ open: false, low: null, high: null, played: [], nextDown: null, nextUp: null, complete: false });
      }
    }
  });

  it("initial scores: everyone 0 and tied at rank 1", () => {
    const h = mk(6);
    expect(sortedScores(h.state)).toEqual(expectedScores(zeroMap(h.state.order, 0)));
    expect(h.envelope("p2").scores).toHaveLength(6);
  });

  it("each player's view shows exactly their own hand", () => {
    const h = mk(4, {}, 7);
    for (const p of h.state.order) {
      expect(sortStr(h.view(p).myHand)).toEqual(sortStr(h.state.hands[p]));
    }
    expect(h.view(null).myHand).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Opening the round
// ---------------------------------------------------------------------------

describe("badamsatti: opening move", () => {
  it("(firstCard7H on) the only legal action is the 7♥ for the holder, nothing for others", () => {
    const h = mk(4, {}, 3);
    const starter = h.state.starter;
    // Give the starter every other 7 too, so the rule actually restricts something.
    let hands = h.state.hands;
    for (const c of ["7S", "7D", "7C"]) hands = moveCard(hands, c, starter);
    h.setState({ ...h.state, hands });
    expect(h.legal(starter)).toEqual([play("7H")]);
    for (const p of h.state.order.filter((x) => x !== starter)) expect(h.legal(p)).toEqual([]);
    expect(h.tryAct(starter, play("7S"))).not.toBeNull();
    expect(h.tryAct(starter, PASS)).not.toBeNull();
    const other = h.state.order.find((p) => p !== starter)!;
    expect(h.tryAct(other, play("7H"))).not.toBeNull();
    expect(h.state.playedCount).toBe(0);
  });

  it("(firstCard7H on) even with allowPassWhenAble the opening card is forced", () => {
    const h = mk(3, { allowPassWhenAble: true }, 2);
    expect(h.legal(h.state.starter)).toEqual([play("7H")]);
    expect(h.tryAct(h.state.starter, PASS)).not.toBeNull();
  });

  it("playing the 7♥ opens hearts and passes the turn clockwise", () => {
    for (const seed of [1, 2, 3, 4]) {
      const h = mk(5, {}, seed);
      const starter = h.state.starter;
      const before = h.state.hands[starter].length;
      h.act(starter, play("7H"));
      const st = h.state;
      expect(st.board).toEqual({ ...CLOSED, H: { low: "7", high: "7" } });
      expect(st.hands[starter]).not.toContain("7H");
      expect(st.hands[starter]).toHaveLength(before - 1);
      expect(st.playedCount).toBe(1);
      const next = nextClockwise(st.order, starter, () => false);
      expect(st.turn).toBe(next);
      expect(plugin.activePlayers(st)).toEqual([next]);
      const v = h.view(null);
      expect(v.openingMove).toBe(false);
      const hearts = v.board.find((r) => r.suit === "H")!;
      expect(hearts).toEqual({ suit: "H", open: true, low: "7", high: "7", played: ["7"], nextDown: "6", nextUp: "8", complete: false });
      expect(v.log).toHaveLength(1);
      expect(v.log[0]).toMatchObject({ playerId: starter, kind: "play", card: "7H", wentOut: null });
      expect(v.handCounts[starter]).toBe(before - 1);
    }
  });

  it("(firstCard7H off) the 7♥ holder may open with any 7 they hold, and must play one", () => {
    const h = mk(4, { firstCard7H: false }, 5);
    const starter = h.state.starter;
    const next = nextClockwise(h.state.order, starter, () => false);
    let hands = h.state.hands;
    hands = moveCard(hands, "7S", starter);
    hands = moveCard(hands, "7D", starter);
    hands = moveCard(hands, "7C", next);
    h.setState({ ...h.state, hands });
    expect(sortActs(h.legal(starter))).toEqual(sortActs([play("7H"), play("7S"), play("7D")]));
    expect(h.legal(next)).toEqual([]);
    expect(h.tryAct(starter, PASS)).not.toBeNull();
    h.act(starter, play("7S"));
    expect(h.state.board).toEqual({ ...CLOSED, S: { low: "7", high: "7" } });
    expect(h.state.turn).toBe(next);
    // Next player can open clubs with their 7♣.
    expect(sortActs(h.legal(next))).toContainEqual(actKey(play("7C")));
  });

  it("(firstCard7H off) the 7♥ holder still starts", () => {
    for (const seed of [1, 2, 3]) {
      const h = mk(6, { firstCard7H: false }, seed);
      expect(h.state.turn).toBe(holderOf(h.state, "7H"));
      expect(h.state.starter).toBe(holderOf(h.state, "7H"));
    }
  });
});

// ---------------------------------------------------------------------------
// Extending and illegal plays
// ---------------------------------------------------------------------------

describe("badamsatti: legal plays", () => {
  // Spades 6..8 and hearts 7 are on the table; clubs and diamonds closed.
  const BOARD_X: Board = { S: rg("6", "8"), H: rg("7", "7"), C: null, D: null };
  const P1_X = ["5S", "4S", "TS", "6H", "8H", "2H", "7C", "7D", "AC", "KD"];

  function posX(settings: SettingsIn = {}) {
    const h = mk(4, settings, 1);
    craft(h, { board: BOARD_X, turn: "p1", explicit: { p1: P1_X, p2: ["9S"] }, restTo: ["p0", "p2", "p3"] });
    return h;
  }

  it("may open a closed suit with its 7 or extend an open suit by exactly one rank", () => {
    const h = posX();
    expect(sortActs(h.legal("p1"))).toEqual(sortActs(["5S", "6H", "8H", "7C", "7D"].map(play)));
    for (const p of ["p0", "p2", "p3"]) expect(h.legal(p)).toEqual([]);
    expect(plugin.activePlayers(h.state)).toEqual(["p1"]);
  });

  it("rejects gaps, non-7 cards of closed suits, cards not held and plays out of turn", () => {
    const h = posX();
    const snapshot = JSON.stringify(h.state);
    expect(h.tryAct("p1", play("4S"))).not.toBeNull(); // gap below 6♠
    expect(h.tryAct("p1", play("TS"))).not.toBeNull(); // gap above 8♠
    expect(h.tryAct("p1", play("2H"))).not.toBeNull(); // far from 7♥
    expect(h.tryAct("p1", play("AC"))).not.toBeNull(); // clubs not open
    expect(h.tryAct("p1", play("KD"))).not.toBeNull(); // diamonds not open
    expect(h.tryAct("p1", play("9S"))).not.toBeNull(); // fits, but p2 holds it
    expect(h.tryAct("p1", play("7S"))).not.toBeNull(); // already on the table
    expect(h.tryAct("p1", play("ZZ"))).not.toBeNull(); // not a card
    expect(h.tryAct("p1", { type: "play", card: "5S", extra: 1 } as unknown as Action)).not.toBeNull();
    expect(h.tryAct("p2", play("9S"))).not.toBeNull(); // not p2's turn
    expect(h.tryAct("p2", PASS)).not.toBeNull();
    expect(h.tryAct("p0", NEXT)).not.toBeNull(); // host action in the wrong phase
    expect(h.tryAct("nobody", play("5S"))).toMatch(/not playing/);
    expect(JSON.stringify(h.state)).toBe(snapshot);
  });

  it("extending updates the suit range and the board row", () => {
    const h = posX();
    h.act("p1", play("8H"));
    expect(h.state.board.H).toEqual({ low: "7", high: "8" });
    expect(h.state.turn).toBe("p2");
    expect(h.state.playedCount).toBe(5);
    const row = h.view("p2").board.find((r) => r.suit === "H")!;
    expect(row).toEqual({ suit: "H", open: true, low: "7", high: "8", played: ["7", "8"], nextDown: "6", nextUp: "9", complete: false });
    // p2 can now extend spades upward with the 9♠.
    expect(sortActs(h.legal("p2"))).toContainEqual(actKey(play("9S")));
    h.act("p2", play("9S"));
    expect(h.state.board.S).toEqual({ low: "6", high: "9" });
    h.act("p3", h.legal("p3")[0]);
    expect(h.state.turn).toBe("p0");
    const spades = h.view(null).board.find((r) => r.suit === "S")!;
    expect(spades.played).toEqual(["6", "7", "8", "9"]);
    expect(spades.nextDown).toBe("5");
    expect(spades.nextUp).toBe("T");
    expect(h.view(null).log.map((e) => e.playerId).slice(0, 2)).toEqual(["p1", "p2"]);
    const ns = h.view(null).log.map((e) => e.n);
    for (let i = 1; i < ns.length; i++) expect(ns[i]).toBeGreaterThan(ns[i - 1]);
  });

  it("opening another suit with its 7", () => {
    const h = posX();
    h.act("p1", play("7D"));
    expect(h.state.board.D).toEqual({ low: "7", high: "7" });
    expect(h.state.board.C).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Must play if able / pass
// ---------------------------------------------------------------------------

describe("badamsatti: must play if able", () => {
  const SEVENS: Board = { S: rg("7", "7"), H: rg("7", "7"), C: rg("7", "7"), D: rg("7", "7") };
  // p1 holds nothing next to a 7.
  const P1_STUCK = ["2S", "3S", "QH", "KH", "AC", "2C", "TD"];

  function stuck(settings: SettingsIn = {}) {
    const h = mk(3, settings, 1);
    craft(h, { board: SEVENS, turn: "p1", explicit: { p1: P1_STUCK }, restTo: ["p0", "p2"] });
    return h;
  }

  it("pass is the only legal action when no card fits", () => {
    const h = stuck();
    expect(h.legal("p1")).toEqual([PASS]);
    for (const c of P1_STUCK) expect(h.tryAct("p1", play(c))).not.toBeNull();
  });

  it("passing moves the turn, reveals nothing and changes no cards", () => {
    const h = stuck();
    const before = h.state;
    h.act("p1", PASS);
    const st = h.state;
    expect(st.turn).toBe("p2");
    expect(st.hands).toEqual(before.hands);
    expect(st.board).toEqual(before.board);
    expect(st.playedCount).toBe(before.playedCount);
    expect(st.passedLastTurn.p1).toBe(true);
    const v = h.view("p0");
    expect(v.passedLastTurn.p1).toBe(true);
    expect(v.log[v.log.length - 1]).toMatchObject({ playerId: "p1", kind: "pass", card: null, wentOut: null });
    expect(findLeaks(v, before.hands.p1)).toEqual([]);
    expect(findLeaks(h.view(null), [...before.hands.p1, ...before.hands.p2, ...before.hands.p0])).toEqual([]);
  });

  it("passedLastTurn resets when that player later plays", () => {
    const h = stuck();
    h.act("p1", PASS);
    // Give p1 a playable card for their next turn by playing around the table.
    let guard = 0;
    while (h.state.turn !== "p1" && guard++ < 10) {
      const t = h.state.turn!;
      h.act(t, h.legal(t)[0]);
    }
    expect(h.state.turn).toBe("p1");
    const plays = h.legal("p1").filter((a) => a.type === "play");
    if (plays.length) {
      h.act("p1", plays[0]);
      expect(h.state.passedLastTurn.p1).toBe(false);
    }
  });

  it("pass is illegal while holding a playable card (default)", () => {
    const h = mk(3, {}, 1);
    craft(h, { board: SEVENS, turn: "p1", explicit: { p1: [...P1_STUCK, "8D"] }, restTo: ["p0", "p2"] });
    expect(h.legal("p1")).toEqual([play("8D")]);
    expect(h.tryAct("p1", PASS)).not.toBeNull();
  });

  it("(allowPassWhenAble) pass is legal alongside plays", () => {
    const h = mk(3, { allowPassWhenAble: true }, 1);
    craft(h, { board: SEVENS, turn: "p1", explicit: { p1: [...P1_STUCK, "8D", "6S"] }, restTo: ["p0", "p2"] });
    expect(sortActs(h.legal("p1"))).toEqual(sortActs([play("8D"), play("6S"), PASS]));
    h.act("p1", PASS);
    expect(h.state.turn).toBe("p2");
    expect(h.state.hands.p1).toContain("8D");
  });

  it("(allowPassWhenAble) pass is still the only action when nothing fits", () => {
    const h = stuck({ allowPassWhenAble: true });
    expect(h.legal("p1")).toEqual([PASS]);
  });
});

// ---------------------------------------------------------------------------
// Ace low / high
// ---------------------------------------------------------------------------

describe("badamsatti: ace placement", () => {
  // Spades 2..Q on the table, the other suits around (hearts/clubs complete, diamonds just the 7).
  function aceBoard(aceHigh: boolean, spades: SuitRange): Board {
    return { S: spades, H: full(aceHigh), C: full(aceHigh), D: rg("7", "7") };
  }

  it("default (ace low): A goes below the 2, nothing goes above the K", () => {
    const h = mk(3, {}, 1);
    craft(h, { board: aceBoard(false, rg("2", "Q")), turn: "p1", explicit: { p1: ["AS", "KS", "5D", "9D"] }, restTo: ["p0", "p2"] });
    expect(sortActs(h.legal("p1"))).toEqual(sortActs([play("AS"), play("KS")]));
    const row = h.view(null).board.find((r) => r.suit === "S")!;
    expect(row.played).toEqual(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q"]);
    expect(row.nextDown).toBe("A");
    expect(row.nextUp).toBe("K");
    h.act("p1", play("KS"));
    const after = h.view(null).board.find((r) => r.suit === "S")!;
    expect(after.nextUp).toBeNull();
    expect(after.nextDown).toBe("A");
    expect(after.complete).toBe(false);
    const hearts = h.view(null).board.find((r) => r.suit === "H")!;
    expect(hearts).toMatchObject({ open: true, low: "A", high: "K", nextDown: null, nextUp: null, complete: true });
    expect(hearts.played).toEqual(["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]);
  });

  it("default (ace low): with spades 3..K only the 2 fits (not the ace)", () => {
    const h = mk(3, {}, 1);
    craft(h, { board: aceBoard(false, rg("3", "K")), turn: "p1", explicit: { p1: ["AS", "2S", "5D", "9D"] }, restTo: ["p0", "p2"] });
    expect(h.legal("p1")).toEqual([play("2S")]);
    expect(h.tryAct("p1", play("AS"))).not.toBeNull();
  });

  it("(aceHigh) A goes above the K, nothing below the 2", () => {
    const h = mk(3, { aceHigh: true }, 1);
    craft(h, { board: aceBoard(true, rg("2", "Q")), turn: "p1", explicit: { p1: ["AS", "KS", "5D", "9D"] }, restTo: ["p0", "p2"] });
    expect(h.legal("p1")).toEqual([play("KS")]);
    expect(h.tryAct("p1", play("AS"))).not.toBeNull();
    const row = h.view(null).board.find((r) => r.suit === "S")!;
    expect(row.nextDown).toBeNull();
    expect(row.nextUp).toBe("K");
    h.act("p1", play("KS"));
    expect(h.state.board.S).toEqual({ low: "2", high: "K" });
    const after = h.view(null).board.find((r) => r.suit === "S")!;
    expect(after.nextUp).toBe("A");
    expect(after.nextDown).toBeNull();
    const hearts = h.view(null).board.find((r) => r.suit === "H")!;
    expect(hearts).toMatchObject({ open: true, low: "2", high: "A", nextDown: null, nextUp: null, complete: true });
    expect(hearts.played).toEqual(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
  });

  it("(aceHigh) with spades 3..K both the 2 and the A fit", () => {
    const h = mk(3, { aceHigh: true }, 1);
    craft(h, { board: aceBoard(true, rg("3", "K")), turn: "p1", explicit: { p1: ["AS", "2S", "5D", "9D"] }, restTo: ["p0", "p2"] });
    expect(sortActs(h.legal("p1"))).toEqual(sortActs([play("2S"), play("AS")]));
    h.act("p1", play("AS"));
    expect(h.state.board.S).toEqual({ low: "3", high: "A" });
  });
});

// ---------------------------------------------------------------------------
// Winning, scoring, rounds
// ---------------------------------------------------------------------------

// Spades 5..K, hearts and clubs complete, diamonds 7..9. Off the table: A–4♠, A–6♦, 10–K♦ (14 cards).
const END_BOARD: Board = { S: rg("5", "K"), H: full(false), C: full(false), D: rg("7", "9") };
// Same but diamonds 7..10: off the table A–4♠, A–6♦, J–K♦ (13 cards).
const END_BOARD_T: Board = { S: rg("5", "K"), H: full(false), C: full(false), D: rg("7", "T") };

describe("badamsatti: first to empty their hand wins (single round)", () => {
  function w1(settings: SettingsIn = {}) {
    const h = mk(3, settings, 1);
    craft(h, {
      board: END_BOARD,
      turn: "p0",
      explicit: { p0: ["4S"], p1: ["AS", "2S", "3S", "AD", "2D", "3D"], p2: ["4D", "5D", "6D", "TD", "JD", "QD", "KD"] },
    });
    return h;
  }

  it("the game is not over before anyone empties their hand", () => {
    const h = w1();
    expect(plugin.isOver(h.state)).toBe(false);
    expect(sortedScores(h.state)).toEqual(expectedScores({ p0: 0, p1: 0, p2: 0 }));
  });

  it("ends the moment a player plays their last card; penalty = cards left", () => {
    const h = w1();
    h.act("p0", play("4S"));
    const st = h.state;
    expect(st.phase).toBe("over");
    expect(plugin.isOver(st)).toBe(true);
    expect(h.match.over).toBe(true);
    expect(st.turn).toBeNull();
    expect(plugin.activePlayers(st)).toEqual([]);
    for (const p of st.order) expect(h.legal(p)).toEqual([]);
    expect(plugin.legalActions(st, { id: "p0", isHost: true })).toEqual([]);
    expect(st.finishOrder).toEqual(["p0"]);
    expect(st.history).toHaveLength(1);
    const r = st.history[0];
    expect(r.round).toBe(1);
    expect(r.finishOrder).toEqual(["p0"]);
    expect(r.cardsLeft).toEqual({ p0: 0, p1: 6, p2: 7 });
    expect(r.penalty).toEqual({ p0: 0, p1: 6, p2: 7 });
    expect(r.places.p0).toBe(1);
    expect(st.totals).toEqual({ p0: 0, p1: 6, p2: 7 });
    const v = h.view("p1");
    expect(v.phase).toBe("over");
    expect(v.totals).toEqual({ p0: 0, p1: 6, p2: 7 });
    expect(v.finishOrder).toEqual(["p0"]);
    expect(v.log[v.log.length - 1]).toMatchObject({ playerId: "p0", kind: "play", card: "4S", wentOut: 1 });
    expect(h.tryAct("p1", play("3S"))).not.toBeNull();
  });

  it("final scores rank the winner first, then by cards left", () => {
    const h = w1();
    h.act("p0", play("4S"));
    expect(rankMap(h.state)).toEqual({ p0: 1, p1: 2, p2: 3 });
    expect(sortedScores(h.state)).toEqual(expectedScores({ p0: 0, p1: 6, p2: 7 }));
    expect(h.envelope("p2").over).toBe(true);
    expect(h.envelope("p2").legal).toEqual([]);
  });

  it("round places follow cards left; equal cards share a place and a rank", () => {
    const h = mk(3, {}, 1);
    craft(h, {
      board: END_BOARD_T,
      turn: "p0",
      explicit: { p0: ["4S"], p1: ["AS", "2S", "3S", "AD", "2D", "3D"], p2: ["4D", "5D", "6D", "JD", "QD", "KD"] },
    });
    h.act("p0", play("4S"));
    const r = h.state.history[0];
    expect(r.cardsLeft).toEqual({ p0: 0, p1: 6, p2: 6 });
    expect(r.places).toEqual({ p0: 1, p1: 2, p2: 2 });
    expect(rankMap(h.state)).toEqual({ p0: 1, p1: 2, p2: 2 });
    expect(sortedScores(h.state)).toEqual(expectedScores({ p0: 0, p1: 6, p2: 6 }));
  });

  it("places for a 3-way split of cards left (1, 2, 3)", () => {
    const h = w1();
    h.act("p0", play("4S"));
    expect(h.state.history[0].places).toEqual({ p0: 1, p1: 2, p2: 3 });
  });
});

describe("badamsatti: playToEnd", () => {
  function p3() {
    const h = mk(3, { playToEnd: true }, 1);
    craft(h, {
      board: END_BOARD_T,
      turn: "p0",
      explicit: { p0: ["4S"], p1: ["3S", "JD"], p2: ["AS", "2S", "AD", "2D", "3D", "4D", "5D", "6D", "QD", "KD"] },
    });
    return h;
  }

  it("keeps playing after the first player goes out, skipping them", () => {
    const h = p3();
    h.act("p0", play("4S"));
    let st = h.state;
    expect(st.phase).toBe("play");
    expect(plugin.isOver(st)).toBe(false);
    expect(st.finishOrder).toEqual(["p0"]);
    expect(st.turn).toBe("p1");
    expect(h.legal("p0")).toEqual([]);
    expect(h.view(null).log.at(-1)).toMatchObject({ playerId: "p0", wentOut: 1 });
    expect(sortActs(h.legal("p1"))).toEqual(sortActs([play("3S"), play("JD")]));
    h.act("p1", play("3S"));
    expect(h.state.turn).toBe("p2");
    h.act("p2", play("2S"));
    st = h.state;
    expect(st.turn).toBe("p1"); // p0 is out and skipped
    expect(plugin.activePlayers(st)).toEqual(["p1"]);
    h.act("p1", play("JD"));
    st = h.state;
    // Only p2 still has cards: the round (and the 1-round game) is over.
    expect(st.phase).toBe("over");
    expect(plugin.isOver(st)).toBe(true);
    expect(st.finishOrder).toEqual(["p0", "p1"]);
    const r = st.history[0];
    expect(r.finishOrder).toEqual(["p0", "p1"]);
    expect(r.places).toEqual({ p0: 1, p1: 2, p2: 3 });
    expect(r.cardsLeft).toEqual({ p0: 0, p1: 0, p2: 9 });
    expect(r.penalty).toEqual({ p0: 0, p1: 1, p2: 2 });
    expect(st.totals).toEqual({ p0: 0, p1: 1, p2: 2 });
    expect(sortedScores(st)).toEqual(expectedScores({ p0: 0, p1: 1, p2: 2 }));
    expect(h.view(null).log.at(-1)).toMatchObject({ playerId: "p1", card: "JD", wentOut: 2 });
  });

  it("without playToEnd the same position ends after the first player goes out", () => {
    const h = mk(3, {}, 1);
    craft(h, {
      board: END_BOARD_T,
      turn: "p0",
      explicit: { p0: ["4S"], p1: ["3S", "JD"], p2: ["AS", "2S", "AD", "2D", "3D", "4D", "5D", "6D", "QD", "KD"] },
    });
    h.act("p0", play("4S"));
    expect(h.state.phase).toBe("over");
    expect(h.state.history[0].penalty).toEqual({ p0: 0, p1: 2, p2: 10 });
    expect(rankMap(h.state)).toEqual({ p0: 1, p1: 2, p2: 3 });
  });
});

describe("badamsatti: multiple rounds", () => {
  function round1(h: H) {
    craft(h, {
      board: END_BOARD,
      turn: "p0",
      explicit: { p0: ["4S"], p1: ["AS", "2S", "3S", "AD", "2D", "3D"], p2: ["4D", "5D", "6D", "TD", "JD", "QD", "KD"] },
    });
    h.act("p0", play("4S"));
  }

  it("after a round with more to come: roundOver, only the host may start the next", () => {
    const h = mk(3, { rounds: 2 }, 1);
    round1(h);
    const st = h.state;
    expect(st.phase).toBe("roundOver");
    expect(plugin.isOver(st)).toBe(false);
    expect(h.match.over).toBe(false);
    expect(st.turn).toBeNull();
    expect(plugin.activePlayers(st)).toEqual([]);
    expect(h.legal("p0")).toEqual([NEXT]);
    expect(h.legal("p1")).toEqual([]);
    expect(h.legal("p2")).toEqual([]);
    expect(h.tryAct("p1", NEXT)).not.toBeNull();
    expect(h.tryAct("p1", play("3S"))).not.toBeNull();
    expect(h.tryAct("p0", PASS)).not.toBeNull();
    expect(st.totals).toEqual({ p0: 0, p1: 6, p2: 7 });
    expect(sortedScores(st)).toEqual(expectedScores({ p0: 0, p1: 6, p2: 7 }));
    expect(h.view("p2").phase).toBe("roundOver");
    expect(h.view("p2").history).toHaveLength(1);
    expectNoLeaks(h, "roundOver");
  });

  it("nextRound deals a fresh full deck and the new 7♥ holder starts", () => {
    const h = mk(3, { rounds: 2 }, 1);
    round1(h);
    h.act("p0", NEXT);
    const st = h.state;
    expect(st.phase).toBe("play");
    expect(st.round).toBe(2);
    expect(sortStr(st.order.flatMap((p) => st.hands[p]))).toEqual(sortStr(DECK));
    for (const p of st.order) expect([17, 18]).toContain(st.hands[p].length);
    expect(st.board).toEqual(CLOSED);
    expect(st.playedCount).toBe(0);
    expect(st.finishOrder).toEqual([]);
    expect(st.passedLastTurn).toEqual(zeroMap(st.order, false));
    expect(st.log).toEqual([]);
    const holder = holderOf(st, "7H");
    expect(st.starter).toBe(holder);
    expect(st.turn).toBe(holder);
    expect(h.legal(holder)).toEqual([play("7H")]);
    expect(st.totals).toEqual({ p0: 0, p1: 6, p2: 7 });
    expect(st.history).toHaveLength(1);
    expect(h.view("p1").round).toBe(2);
    expect(h.view("p1").openingMove).toBe(true);
  });

  it("totals add up across rounds and the lowest total wins", () => {
    const h = mk(3, { rounds: 2 }, 1);
    round1(h);
    h.act("p0", NEXT);
    craft(h, {
      board: END_BOARD_T,
      turn: "p2",
      explicit: { p2: ["4S"], p0: ["AS", "2S", "3S", "AD", "2D", "3D"], p1: ["4D", "5D", "6D", "JD", "QD", "KD"] },
    });
    h.act("p2", play("4S"));
    const st = h.state;
    expect(st.phase).toBe("over");
    expect(plugin.isOver(st)).toBe(true);
    expect(st.history).toHaveLength(2);
    expect(st.history[1]).toMatchObject({
      round: 2,
      finishOrder: ["p2"],
      cardsLeft: { p0: 6, p1: 6, p2: 0 },
      penalty: { p0: 6, p1: 6, p2: 0 },
    });
    expect(st.totals).toEqual({ p0: 6, p1: 12, p2: 7 });
    expect(rankMap(st)).toEqual({ p0: 1, p2: 2, p1: 3 });
    expect(sortedScores(st)).toEqual(expectedScores({ p0: 6, p1: 12, p2: 7 }));
    expect(h.view(null).totals).toEqual({ p0: 6, p1: 12, p2: 7 });
    for (const p of st.order) expect(h.legal(p)).toEqual([]);
  });

  it("equal totals share a rank", () => {
    const h = mk(3, { rounds: 2 }, 1);
    round1(h);
    h.act("p0", NEXT);
    craft(h, {
      board: END_BOARD_T,
      turn: "p1",
      explicit: { p1: ["4S"], p0: ["AS", "2S", "3S", "AD", "2D", "3D"], p2: ["4D", "5D", "6D", "JD", "QD", "KD"] },
    });
    h.act("p1", play("4S"));
    const st = h.state;
    expect(st.totals).toEqual({ p0: 6, p1: 6, p2: 13 });
    expect(rankMap(st)).toEqual({ p0: 1, p1: 1, p2: 3 });
  });

  it("(playToEnd, 2 rounds) penalty is place − 1 per round", () => {
    const h = mk(3, { rounds: 2, playToEnd: true }, 1);
    craft(h, {
      board: END_BOARD_T,
      turn: "p0",
      explicit: { p0: ["4S"], p1: ["3S", "JD"], p2: ["AS", "2S", "AD", "2D", "3D", "4D", "5D", "6D", "QD", "KD"] },
    });
    h.act("p0", play("4S"));
    h.act("p1", play("3S"));
    h.act("p2", play("2S"));
    h.act("p1", play("JD"));
    expect(h.state.phase).toBe("roundOver");
    expect(h.state.totals).toEqual({ p0: 0, p1: 1, p2: 2 });
    h.act("p0", NEXT);
    // Round 2: p2 out first, then p0; p1 left holding cards.
    craft(h, {
      board: END_BOARD_T,
      turn: "p2",
      explicit: { p2: ["4S"], p0: ["3S", "JD"], p1: ["AS", "2S", "AD", "2D", "3D", "4D", "5D", "6D", "QD", "KD"] },
    });
    h.act("p2", play("4S"));
    expect(h.state.turn).toBe("p0");
    h.act("p0", play("3S"));
    h.act("p1", play("2S"));
    expect(h.state.turn).toBe("p0");
    h.act("p0", play("JD"));
    const st = h.state;
    expect(st.phase).toBe("over");
    expect(st.history[1].penalty).toEqual({ p2: 0, p0: 1, p1: 2 });
    expect(st.totals).toEqual({ p0: 1, p1: 3, p2: 2 });
    expect(rankMap(st)).toEqual({ p0: 1, p2: 2, p1: 3 });
  });
});

// ---------------------------------------------------------------------------
// Spec-oracle walk: every step of many games checked against the rules
// ---------------------------------------------------------------------------

interface WalkStats {
  steps: number;
  passes: number;
  rounds: number;
}

function checkView(h: H, viewer: PlayerId | null) {
  const st = h.state;
  const v = h.view(viewer);
  assertJsonSafe(v, `view(${viewer})`);
  expect(v.phase).toBe(st.phase);
  expect(v.round).toBe(st.round);
  expect(v.turn).toBe(st.turn);
  expect(v.order).toEqual(st.order);
  expect(v.finishOrder).toEqual(st.finishOrder);
  expect(v.totals).toEqual(st.totals);
  expect(v.history).toHaveLength(st.history.length);
  expect(v.openingMove).toBe(st.phase === "play" && st.playedCount === 0);
  if (viewer) expect(sortStr(v.myHand)).toEqual(sortStr(st.hands[viewer]));
  else expect(v.myHand).toEqual([]);
  for (const p of st.order) expect(v.handCounts[p]).toBe(st.hands[p].length);
  expect(v.log.length).toBeLessThanOrEqual(LOG_LIMIT);
  expect(v.board.map((r) => r.suit)).toEqual([...BOARD_SUIT_ORDER]);
  const line = rankLine(st.settings.aceHigh);
  for (const row of v.board) {
    const r = st.board[row.suit];
    if (!r) {
      expect(row).toMatchObject({ open: false, low: null, high: null, played: [], nextDown: null, nextUp: null, complete: false });
      continue;
    }
    const lo = line.indexOf(r.low), hi = line.indexOf(r.high);
    expect(row.open).toBe(true);
    expect(row.low).toBe(r.low);
    expect(row.high).toBe(r.high);
    expect(row.played).toEqual(line.slice(lo, hi + 1));
    expect(row.nextDown).toBe(lo > 0 ? line[lo - 1] : null);
    expect(row.nextUp).toBe(hi < 12 ? line[hi + 1] : null);
    expect(row.complete).toBe(lo === 0 && hi === 12);
  }
}

function checkResult(r: RoundResult, st: State, round: number) {
  const n = st.order.length;
  expect(r.round).toBe(round);
  const holding = st.order.filter((p) => r.cardsLeft[p] > 0);
  if (st.settings.playToEnd) {
    expect(r.finishOrder).toHaveLength(n - 1);
    expect(holding).toHaveLength(1);
    r.finishOrder.forEach((p, i) => expect(r.places[p]).toBe(i + 1));
    expect(r.places[holding[0]]).toBe(n);
    for (const p of st.order) expect(r.penalty[p]).toBe(r.places[p] - 1);
  } else {
    expect(r.finishOrder).toHaveLength(1);
    const w = r.finishOrder[0];
    expect(r.cardsLeft[w]).toBe(0);
    expect(r.places[w]).toBe(1);
    for (const p of st.order) {
      expect(r.penalty[p]).toBe(r.cardsLeft[p]);
      if (p !== w) {
        expect(r.cardsLeft[p]).toBeGreaterThan(0);
        expect(r.places[p]).toBeGreaterThan(1);
      }
    }
  }
}

function walk(n: number, settings: SettingsIn, seed: number): WalkStats {
  const h = mk(n, settings, seed);
  const rng: Rng = createRng(seed * 7919 + n, 11);
  const stats: WalkStats = { steps: 0, passes: 0, rounds: 1 };
  const totalRounds = h.state.settings.rounds;
  let roundStarts = true;

  for (let guard = 0; guard < 20000; guard++) {
    const st = h.state;
    assertJsonSafe(st, "state");
    // Every card on the table or in exactly one hand.
    expect(sortStr([...boardCards(st.board, st.settings.aceHigh), ...st.order.flatMap((p) => st.hands[p])])).toEqual(sortStr(DECK));
    if (st.phase === "play") expect(st.playedCount).toBe(boardCards(st.board, st.settings.aceHigh).length);
    // Legal actions match the spec for every seat (host-aware), spectators get nothing.
    for (const p of st.order) {
      expect(sortActs(h.legal(p)), `legal(${p}) at step ${stats.steps}`).toEqual(sortActs(expectedLegal(st, p, p === h.host)));
    }
    expect(plugin.legalActions(st, { id: "ghost", isHost: false })).toEqual([]);
    // Active players.
    const active = plugin.activePlayers(st);
    expect(active).toEqual(st.phase === "play" ? [st.turn] : []);
    // Scores are always the competition ranking of totals (lower is better).
    expect(sortedScores(st)).toEqual(expectedScores(st.totals));
    // Views are consistent and never leak.
    expectNoLeaks(h, `n=${n} seed=${seed} step=${stats.steps}`);
    for (const viewer of [...st.order, null]) checkView(h, viewer);

    if (roundStarts && st.phase === "play") {
      expect(st.turn).toBe(holderOf(st, "7H"));
      expect(st.starter).toBe(st.turn);
      expect(st.board).toEqual(CLOSED);
      roundStarts = false;
    }

    if (st.phase === "over") {
      expect(plugin.isOver(st)).toBe(true);
      expect(h.match.over).toBe(true);
      expect(st.history).toHaveLength(totalRounds);
      break;
    }
    expect(plugin.isOver(st)).toBe(false);

    if (st.phase === "roundOver") {
      expect(st.round).toBeLessThan(totalRounds);
      h.act(h.host, NEXT);
      stats.rounds++;
      expect(h.state.round).toBe(st.round + 1);
      roundStarts = true;
      continue;
    }

    const actor = st.turn!;
    const legal = expectedLegal(st, actor, actor === h.host);
    expect(legal.length).toBeGreaterThan(0);
    // Mostly play (so games finish), sometimes pass when allowed.
    const plays = legal.filter((a) => a.type === "play");
    const action = plays.length && (legal.length === plays.length || rng.next() < 0.8) ? rng.pick(plays) : rng.pick(legal);
    h.act(actor, action);
    stats.steps++;
    const nx = h.state;
    const last = h.view(null).log.at(-1)!;
    expect(last.playerId).toBe(actor);

    if (action.type === "pass") {
      stats.passes++;
      expect(nx.hands).toEqual(st.hands);
      expect(nx.board).toEqual(st.board);
      expect(nx.passedLastTurn[actor]).toBe(true);
      expect(last).toMatchObject({ kind: "pass", card: null, wentOut: null });
      expect(nx.turn).toBe(nextClockwise(st.order, actor, (p) => nx.hands[p].length === 0));
      continue;
    }

    if (action.type !== "play") throw new Error(`unexpected ${action.type} in play phase`);
    const card = action.card;
    expect(nx.hands[actor]).not.toContain(card);
    expect(nx.hands[actor]).toHaveLength(st.hands[actor].length - 1);
    expect(nx.passedLastTurn[actor]).toBe(false);
    expect(last.kind).toBe("play");
    expect(last.card).toBe(card);
    // Board grew by exactly that card.
    const s = suitOf(card);
    const before = st.board[s];
    const line = rankLine(st.settings.aceHigh);
    if (!before) expect(nx.board[s]).toEqual({ low: "7", high: "7" });
    else {
      const r = rankOf(card);
      expect(nx.board[s]).toEqual(line.indexOf(r) < line.indexOf(before.low) ? { low: r, high: before.high } : { low: before.low, high: r });
    }
    for (const other of SUITS4.filter((x) => x !== s)) expect(nx.board[other]).toEqual(st.board[other]);

    const wentOut = nx.hands[actor].length === 0;
    if (wentOut) expect(last.wentOut).toBe(st.finishOrder.length + 1);
    else expect(last.wentOut).toBeNull();

    const holders = st.order.filter((p) => nx.hands[p].length > 0);
    const roundEnds = wentOut && (!st.settings.playToEnd || holders.length <= 1);
    if (roundEnds) {
      expect(nx.history).toHaveLength(st.history.length + 1);
      const res = nx.history.at(-1)!;
      checkResult(res, nx, st.round);
      expect(res.finishOrder.at(-1)).toBe(actor);
      for (const p of st.order) {
        expect(res.cardsLeft[p]).toBe(nx.hands[p].length);
        expect(nx.totals[p]).toBe(st.totals[p] + res.penalty[p]);
      }
      expect(nx.phase).toBe(st.round < totalRounds ? "roundOver" : "over");
      expect(nx.turn).toBeNull();
    } else {
      expect(nx.phase).toBe("play");
      expect(nx.totals).toEqual(st.totals);
      expect(nx.history).toEqual(st.history);
      if (wentOut) expect(nx.finishOrder).toEqual([...st.finishOrder, actor]);
      expect(nx.turn).toBe(nextClockwise(st.order, actor, (p) => nx.hands[p].length === 0));
    }
  }
  expect(h.state.phase).toBe("over");
  return stats;
}

describe("badamsatti: spec-oracle walk (legal moves, transitions, views, leaks, scores)", () => {
  it.each([3, 4, 5, 6, 7, 8])("default rules, %i players", (n) => {
    for (const seed of [1, 2]) walk(n, {}, seed);
  });
  it.each([3, 5, 8])("playToEnd, %i players", (n) => {
    walk(n, { playToEnd: true }, 3);
  });
  it.each([3, 6])("aceHigh, %i players", (n) => {
    walk(n, { aceHigh: true }, 4);
  });
  it.each([4, 7])("firstCard7H off, %i players", (n) => {
    walk(n, { firstCard7H: false }, 5);
  });
  it("allowPassWhenAble actually produces voluntary passes", () => {
    const stats = walk(4, { allowPassWhenAble: true }, 6);
    expect(stats.passes).toBeGreaterThan(0);
  });
  it("3 rounds, 3 and 5 players", () => {
    expect(walk(3, { rounds: 3 }, 7).rounds).toBe(3);
    expect(walk(5, { rounds: 3 }, 8).rounds).toBe(3);
  });
  it("everything on, 2 rounds, 5 players", () => {
    walk(5, { rounds: 2, playToEnd: true, aceHigh: true, firstCard7H: false, allowPassWhenAble: true }, 9);
  });
});

// ---------------------------------------------------------------------------
// Leaks in every phase (explicit)
// ---------------------------------------------------------------------------

describe("badamsatti: viewFor never leaks hidden hands", () => {
  it("at the start, mid-round, at roundOver and at game over, to every other player and spectators", () => {
    const h = mk(4, { rounds: 2 }, 12);
    expectNoLeaks(h, "start");
    for (let i = 0; i < 15 && h.state.phase === "play"; i++) {
      const t = h.state.turn!;
      h.act(t, h.legal(t)[0]);
      expectNoLeaks(h, `mid ${i}`);
    }
    // Finish rounds with first-legal play.
    let guard = 0;
    while (!h.match.over && guard++ < 2000) {
      const st = h.state;
      if (st.phase === "roundOver") {
        expectNoLeaks(h, "roundOver");
        h.act(h.host, NEXT);
        continue;
      }
      const t = st.turn!;
      h.act(t, h.legal(t)[0]);
    }
    expect(h.match.over).toBe(true);
    expectNoLeaks(h, "over");
    // Final envelopes are JSON-safe for everyone.
    for (const p of [...h.state.order, null]) assertJsonSafe(buildView(plugin, h.match, p, p === "p0"), `final ${p}`);
  });

  it("a spectator view contains no card that is still in a hand", () => {
    const h = mk(8, {}, 4);
    const all = h.state.order.flatMap((p) => h.state.hands[p]);
    expect(findLeaks(h.view(null), all)).toEqual([]);
    expect(findLeaks(h.envelope(null), all)).toEqual([]);
    expect(h.envelope(null).legal).toEqual([]);
    expect(h.envelope(null).me).toBeNull();
  });

  it("the starter's legal list only names the starter's own card", () => {
    const h = mk(5, {}, 9);
    const s = h.state.starter;
    const others = othersCards(h.state, s);
    expect(findLeaks(h.legal(s), others)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Determinism and purity
// ---------------------------------------------------------------------------

describe("badamsatti: determinism and purity", () => {
  it("same seed gives the same deal; different seeds differ", () => {
    expect(startMatch(plugin, makePlayers(5), {}, 42, 0).state).toEqual(startMatch(plugin, makePlayers(5), {}, 42, 0).state);
    expect(startMatch(plugin, makePlayers(5), {}, 42, 0).state).not.toEqual(startMatch(plugin, makePlayers(5), {}, 43, 0).state);
  });

  it("same seed gives the same full bot game", () => {
    const a = simulateGame(plugin, { players: 4, seed: 77, settings: { rounds: 2 } });
    const b = simulateGame(plugin, { players: 4, seed: 77, settings: { rounds: 2 } });
    expect(a.log).toEqual(b.log);
    expect(a.match.state).toEqual(b.match.state);
  });

  it("replaying a game's actions reproduces it", () => {
    const sim = simulateGame(plugin, { players: 5, seed: 31, settings: { rounds: 2, playToEnd: true } });
    const h = createHarness<State, Action, View>(plugin, { players: 5, seed: 31, settings: { rounds: 2, playToEnd: true } });
    for (const [p, a] of sim.log) h.act(p, a as Action);
    expect(h.state).toEqual(sim.match.state);
  });

  it("reduce does not mutate its input state", () => {
    const h = mk(4, {}, 2);
    const st = h.state;
    const frozen = deepFreeze(JSON.parse(JSON.stringify(st)) as State);
    const text = JSON.stringify(frozen);
    const next = plugin.reduce(frozen, play("7H"), { actor: { id: st.starter, isHost: false }, rng: createRng(1), now: 0 });
    expect(JSON.stringify(frozen)).toBe(text);
    expect(next).not.toBe(frozen);
    expect((next as State).playedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

describe("badamsatti: bots finish games", () => {
  const combos: SettingsIn[] = [
    {},
    { playToEnd: true },
    { rounds: 3 },
    { allowPassWhenAble: true },
    { aceHigh: true },
    { firstCard7H: false },
    { rounds: 2, playToEnd: true, aceHigh: true, firstCard7H: false, allowPassWhenAble: true },
  ];
  it.each([3, 5, 8])("%i players, every flow-changing setting, several seeds", (n) => {
    for (const settings of combos) {
      for (const seed of [1, 2, 3]) {
        const { match } = simulateGame(plugin, { players: n, seed, settings });
        expect(match.over).toBe(true);
        const st = match.state as State;
        expect(st.phase).toBe("over");
        expect(st.history).toHaveLength(settings.rounds ?? 1);
        st.history.forEach((r, i) => checkResult(r, st, i + 1));
        for (const p of st.order) {
          expect(st.totals[p]).toBe(st.history.reduce((sum, r) => sum + r.penalty[p], 0));
        }
        const scores = plugin.scores(st);
        expect(scores.map((s) => s.playerId).sort()).toEqual(sortStr(st.order));
        expect(Math.min(...scores.map((s) => s.rank))).toBe(1);
        expect(sortedScores(st)).toEqual(expectedScores(st.totals));
      }
    }
  });
});
