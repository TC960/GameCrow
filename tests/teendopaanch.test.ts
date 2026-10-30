/**
 * Teen Do Paanch (3-2-5) tests, written from games/teendopaanch/BRIEF.md + types.ts + ENGINE_CONTRACT.md
 * (not from rules.ts).
 */
import { describe, expect, it } from "vitest";
import plugin from "../games/teendopaanch/rules";
import type { Action, HandResult, PullStep, Settings, State, View } from "../games/teendopaanch/types";
import { followSuitOptions, makeDeck, rankValue, suitOf, trickWinner, type Card, type Suit } from "../engine";
import { createRng } from "../engine/rng";
import { startMatch } from "../engine/match";
import { defaultSettings, lintSchema } from "../engine/settings";
import { assertJsonSafe, createHarness, findLeaks, makePlayers, simulateGame, type Harness } from "../engine/testing";

type Pid = "p0" | "p1" | "p2";
type Rec = Record<string, number>;
type H = Harness<State, Action, View>;

const ORDER: Pid[] = ["p0", "p1", "p2"];
const VIEWERS: (Pid | null)[] = ["p0", "p1", "p2", null];
const ZERO: Rec = { p0: 0, p1: 0, p2: 0 };
const DEFAULTS: Settings = {
  hands: 6,
  endRule: "hands",
  targetPoints: 5,
  removedSevens: "clubsDiamonds",
  trumpCallAfter: "five",
  pullRule: "highest",
};
const ALL_SUITS: Suit[] = ["S", "H", "D", "C"];

const harness = (settings: Partial<Settings> = {}, seed = 1, host?: Pid): H =>
  createHarness<State, Action, View>(plugin, { players: 3, settings, seed, host });

const next = (p: string, k = 1) => ORDER[(ORDER.indexOf(p as Pid) + k) % 3];
const sorted = (cards: readonly Card[]) => [...cards].sort();

function deckFor(removed: string): Card[] {
  const gone =
    removed === "heartsDiamonds" ? ["7H", "7D"] : removed === "spadesClubs" ? ["7S", "7C"] : ["7C", "7D"];
  return makeDeck({ ranks: ["7", "8", "9", "T", "J", "Q", "K", "A"] }).filter((c) => !gone.includes(c));
}

/** Seats per BRIEF §2 for hand h. */
function seatsFor(hand: number) {
  const tm = ORDER[(hand - 1) % 3];
  const three = ORDER[hand % 3];
  const dealer = ORDER[(hand + 1) % 3];
  return { trumpMaker: tm, dealer, targets: { [tm]: 5, [three]: 3, [dealer]: 2 } as Rec };
}

/** A complete, consistent State; fields can be overridden. Default: hand 1 play phase, trump S. */
function mk(o: Omit<Partial<State>, "settings"> & { settings?: Partial<Settings> } = {}): State {
  const hand = o.hand ?? 1;
  const s = seatsFor(hand);
  const { settings, ...rest } = o;
  return {
    order: [...ORDER],
    phase: "play",
    hand,
    dealer: s.dealer,
    targets: s.targets,
    trumpMaker: s.trumpMaker,
    trump: "S",
    hands: { p0: [], p1: [], p2: [] },
    secondBatch: { p0: [], p1: [], p2: [] },
    pullQueue: [],
    exchanges: [],
    owed: { ...ZERO },
    leader: s.trumpMaker,
    turn: s.trumpMaker,
    trick: [],
    lastTrick: null,
    tricksWon: { ...ZERO },
    totals: { ...ZERO },
    history: [],
    ...rest,
    settings: { ...DEFAULTS, ...(settings ?? {}) },
  };
}

/** n fabricated completed hands whose diffs sum to `totals` (all in the first entry). */
function fakeHistory(n: number, totals: Rec = ZERO): HandResult[] {
  return Array.from({ length: n }, (_, i) => {
    const s = seatsFor(i + 1);
    const diffs = i === 0 ? { ...totals } : { ...ZERO };
    const tricks = Object.fromEntries(ORDER.map((p) => [p, s.targets[p] + diffs[p]]));
    return { hand: i + 1, dealer: s.dealer, trump: "S" as Suit, targets: s.targets, tricks, diffs };
  });
}

/**
 * Hand `hand` with 9 tricks done and the last trick about to be led by `winner`, who holds AS (trump S)
 * while the others hold hearts, so `winner` takes the 10th trick and ends with `finalTricks`.
 */
function lastTrickState(o: {
  hand: number;
  finalTricks: Rec;
  winner: Pid;
  totals?: Rec;
  history?: HandResult[];
  settings?: Partial<Settings>;
  owed?: Rec;
}): State {
  const sum = ORDER.reduce((a, p) => a + o.finalTricks[p], 0);
  if (sum !== 10) throw new Error("finalTricks must sum to 10");
  const before = { ...o.finalTricks, [o.winner]: o.finalTricks[o.winner] - 1 };
  const totals = o.totals ?? { ...ZERO };
  return mk({
    hand: o.hand,
    settings: o.settings,
    trump: "S",
    hands: { [o.winner]: ["AS"], [next(o.winner)]: ["8H"], [next(o.winner, 2)]: ["9H"] },
    leader: o.winner,
    turn: o.winner,
    tricksWon: before,
    totals,
    owed: o.owed ?? { ...ZERO },
    history: o.history ?? fakeHistory(o.hand - 1, totals),
  });
}

function playLastTrick(h: H, winner: Pid) {
  h.act(winner, { type: "play", card: "AS" });
  h.act(next(winner), { type: "play", card: "8H" });
  h.act(next(winner, 2), { type: "play", card: "9H" });
}

/** A full 30-card default deal (used for crafted exchange/play positions). */
const EX_HANDS: Record<Pid, Card[]> = {
  p0: ["7S", "KH", "QH", "JH", "TH", "9D", "8D", "AC", "KC", "QC"],
  p1: ["AS", "KS", "9S", "AH", "9H", "8H", "7H", "AD", "KD", "QD"],
  p2: ["QS", "JS", "TS", "8S", "JD", "TD", "JC", "TC", "9C", "8C"],
};

/** Hand 2 exchange-phase position (trump maker p1). */
function exchangeState(queue: PullStep[], owed: Rec): State {
  return mk({
    hand: 2,
    phase: "exchange",
    trump: "D",
    hands: EX_HANDS,
    pullQueue: queue,
    owed,
    turn: null,
    leader: "p1",
    totals: { ...owed },
    history: fakeHistory(1, owed),
  });
}

/** Expected pull queue per BRIEF §4. */
function expectedQueue(trumpMaker: string, owed: Rec): PullStep[] {
  const short: Rec = Object.fromEntries(ORDER.map((p) => [p, Math.max(0, -owed[p])]));
  const q: PullStep[] = [];
  for (let i = 0; i < 3; i++) {
    const puller = next(trumpMaker, i);
    let surplus = Math.max(0, owed[puller]);
    for (let j = 1; j <= 2 && surplus > 0; j++) {
      const victim = next(puller, j);
      while (surplus > 0 && short[victim] > 0) {
        q.push({ puller, victim });
        surplus--;
        short[victim]--;
      }
    }
  }
  return q;
}

const highestOfSuit = (cards: Card[], suit: Suit): Card =>
  cards.filter((c) => suitOf(c) === suit).sort((a, b) => rankValue(b) - rankValue(a))[0];

/** Everything a viewer must not see in the current state. */
function secretsFor(st: State, viewer: Pid | null): Card[] {
  // Legitimately visible: played cards (lastTrick may still show the previous hand's last trick, whose
  // card strings were re-dealt) and the cards of exchanges the viewer took part in.
  const ok = new Set<Card>((st.lastTrick?.plays ?? []).map((p) => p.card));
  for (const e of st.exchanges) {
    if (viewer !== null && (e.puller === viewer || e.victim === viewer)) {
      if (e.given) ok.add(e.given);
      if (e.returned) ok.add(e.returned);
    }
  }
  const out: Card[] = [];
  for (const p of ORDER) {
    if (p !== viewer) out.push(...st.hands[p].filter((c) => !ok.has(c)));
    out.push(...st.secondBatch[p]); // never visible, not even to the owner
  }
  return out;
}

function assertNoLeaks(h: H, label = "") {
  const st = h.state;
  for (const v of VIEWERS) {
    const secrets = secretsFor(st, v);
    const view = h.view(v);
    assertJsonSafe(view, `view ${v}`);
    expect(findLeaks(view, secrets), `${label} view leak to ${v} in ${st.phase}`).toEqual([]);
    expect(findLeaks(h.envelope(v), secrets), `${label} envelope leak to ${v} in ${st.phase}`).toEqual([]);
    // Stricter: without lastTrick and exchange cards, nothing of another hand may appear at all.
    const raw = ORDER.flatMap((p) => [...(p !== v ? st.hands[p] : []), ...st.secondBatch[p]]);
    const stripped = {
      ...view,
      lastTrick: null,
      exchanges: view.exchanges.map((e) => ({ ...e, given: null, returned: null })),
    };
    expect(findLeaks(stripped, raw), `${label} strict leak to ${v} in ${st.phase}`).toEqual([]);
    if (v !== null) {
      expect(findLeaks(h.legal(v), secrets), `${label} legal leak to ${v}`).toEqual([]);
      expect(sorted(view.myHand)).toEqual(sorted(st.hands[v]));
    } else {
      expect(view.myHand).toEqual([]);
    }
    for (const e of view.exchanges) {
      if (v !== e.puller && v !== e.victim) {
        expect(e.given, `${label} exchange given visible to ${v}`).toBeNull();
        expect(e.returned, `${label} exchange returned visible to ${v}`).toBeNull();
      }
    }
    for (const p of ORDER) expect(view.handCounts[p]).toBe(st.hands[p].length);
  }
}

function lcg(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

/**
 * Drive a game through the real engine with random legal moves, checking at every step: no leaks,
 * follow-suit legality, trick resolution, pull mechanics, deals and hand results against the brief.
 */
function driveAndCheck(h: H, seed: number, maxSteps = 5000) {
  const pick = lcg(seed);
  let pulls = 0;
  let steps = 0;
  while (!h.match.over) {
    if (steps++ > maxSteps) throw new Error("did not finish");
    const st = h.state;
    assertNoLeaks(h, `step ${steps}`);
    let actor: Pid | null = null;
    let legal: Action[] = [];
    for (const id of ORDER) {
      const l = h.legal(id);
      if (l.length) {
        expect(actor, "only one player may have legal actions at a time").toBeNull();
        actor = id;
        legal = l;
      }
    }
    expect(actor, `stalled in ${st.phase}`).not.toBeNull();
    const a = legal[pick(legal.length)];
    const active = plugin.activePlayers(st);

    if (st.phase === "trump") {
      expect(actor).toBe(st.trumpMaker);
      expect(active).toEqual([st.trumpMaker]);
    } else if (st.phase === "exchange") {
      expect(actor).toBe(st.pullQueue[0].puller);
      expect(active).toEqual([st.pullQueue[0].puller]);
      expect(sorted(legal.map((x) => (x as { card: Card }).card))).toEqual(sorted(st.hands[actor!]));
    } else if (st.phase === "play") {
      expect(actor).toBe(st.turn);
      expect(active).toEqual([st.turn]);
      const led = st.trick.length ? suitOf(st.trick[0].card) : null;
      expect(sorted(legal.map((x) => (x as { card: Card }).card))).toEqual(
        sorted(followSuitOptions(st.hands[actor!], led)),
      );
    } else if (st.phase === "handEnd") {
      expect(actor).toBe(h.host);
      expect(active).toEqual([]);
      expect(legal).toEqual([{ type: "nextHand" }]);
    }

    h.act(actor!, a);
    const af = h.state;

    if (a.type === "trump") {
      if (st.settings.trumpCallAfter === "five") {
        for (const p of ORDER) {
          expect(sorted(af.hands[p])).toEqual(sorted([...st.hands[p], ...st.secondBatch[p]]));
        }
      }
      for (const p of ORDER) {
        expect(af.hands[p]).toHaveLength(10);
        expect(af.secondBatch[p]).toEqual([]);
      }
      expect(af.trump).toBe(a.suit);
      const q = st.settings.pullRule === "highest" && st.hand > 1 ? expectedQueue(st.trumpMaker, st.owed) : [];
      expect(af.pullQueue).toEqual(q);
      expect(af.phase).toBe(q.length ? "exchange" : "play");
      if (!q.length) {
        expect(af.turn).toBe(st.trumpMaker);
        expect(af.leader).toBe(st.trumpMaker);
      }
    } else if (a.type === "pull") {
      pulls++;
      const { puller, victim } = st.pullQueue[0];
      const received = [...st.hands[victim], a.card];
      const ret = highestOfSuit(received, suitOf(a.card));
      const pullerAfter = [...st.hands[puller]];
      pullerAfter.splice(pullerAfter.indexOf(a.card), 1);
      pullerAfter.push(ret);
      const victimAfter = [...received];
      victimAfter.splice(victimAfter.indexOf(ret), 1);
      expect(sorted(af.hands[puller])).toEqual(sorted(pullerAfter));
      expect(sorted(af.hands[victim])).toEqual(sorted(victimAfter));
      expect(af.exchanges).toEqual([...st.exchanges, { puller, victim, given: a.card, returned: ret }]);
      expect(af.pullQueue).toEqual(st.pullQueue.slice(1));
      if (af.pullQueue.length === 0) {
        expect(af.phase).toBe("play");
        expect(af.turn).toBe(st.trumpMaker);
      } else expect(af.phase).toBe("exchange");
    } else if (a.type === "play") {
      const plays = [...st.trick, { playerId: actor!, card: a.card }];
      if (plays.length < 3) {
        expect(af.trick).toEqual(plays);
        expect(af.turn).toBe(next(actor!));
      } else {
        const winner = plays[trickWinner(plays.map((p) => p.card), st.trump)].playerId;
        expect(af.lastTrick).toEqual({ plays, winner });
        expect(af.trick).toEqual([]);
        const tricks = { ...st.tricksWon, [winner]: st.tricksWon[winner] + 1 };
        const done = ORDER.reduce((s, p) => s + tricks[p], 0);
        if (done < 10) {
          expect(af.tricksWon).toEqual(tricks);
          expect(af.turn).toBe(winner);
          expect(af.leader).toBe(winner);
          expect(h.view(null).trickNumber).toBe(done + 1);
        } else {
          const diffs = Object.fromEntries(ORDER.map((p) => [p, tricks[p] - st.targets[p]]));
          const res = af.history[af.history.length - 1];
          expect(af.history).toHaveLength(st.history.length + 1);
          expect(res).toEqual({
            hand: st.hand,
            dealer: st.dealer,
            trump: st.trump,
            targets: st.targets,
            tricks,
            diffs,
          });
          for (const p of ORDER) expect(af.totals[p]).toBe(st.totals[p] + diffs[p]);
          expect(["handEnd", "over"]).toContain(af.phase);
          expect(h.view(null).trickNumber).toBe(10);
        }
      }
    } else if (a.type === "nextHand") {
      const s = seatsFor(st.hand + 1);
      expect(af.hand).toBe(st.hand + 1);
      expect(af.phase).toBe("trump");
      expect(af.trumpMaker).toBe(s.trumpMaker);
      expect(af.dealer).toBe(s.dealer);
      expect(af.targets).toEqual(s.targets);
      expect(af.trump).toBeNull();
      expect(af.tricksWon).toEqual(ZERO);
      expect(af.exchanges).toEqual([]);
      expect(h.view("p0").exchanges).toEqual([]);
      expect(af.owed).toEqual(st.history[st.history.length - 1].diffs);
      const all = ORDER.flatMap((p) => [...af.hands[p], ...af.secondBatch[p]]);
      expect(sorted(all)).toEqual(sorted(deckFor(st.settings.removedSevens)));
      const five = st.settings.trumpCallAfter === "five";
      for (const p of ORDER) {
        expect(af.hands[p]).toHaveLength(five ? 5 : 10);
        expect(af.secondBatch[p]).toHaveLength(five ? 5 : 0);
      }
    }
  }
  assertNoLeaks(h, "final");
  return { pulls };
}

// ---------------------------------------------------------------------------

describe("teendopaanch: meta and settings schema", () => {
  it("has the right meta", () => {
    expect(plugin.meta.id).toBe("teendopaanch");
    expect(plugin.meta.category).toBe("cards");
    expect(plugin.meta.minPlayers).toBe(3);
    expect(plugin.meta.maxPlayers).toBe(3);
    expect(plugin.meta.hidden).toBeFalsy();
    expect(plugin.meta.howToPlay.length).toBeGreaterThanOrEqual(3);
    expect(plugin.meta.howToPlay.length).toBeLessThanOrEqual(6);
  });

  it("needs exactly 3 players", () => {
    expect(() => startMatch(plugin, makePlayers(2), {}, 1, 0)).toThrow();
    expect(() => startMatch(plugin, makePlayers(4), {}, 1, 0)).toThrow();
    expect(() => startMatch(plugin, makePlayers(3), {}, 1, 0)).not.toThrow();
  });

  it("settings schema matches the brief", () => {
    expect(lintSchema(plugin.settings)).toEqual([]);
    expect(defaultSettings(plugin.settings)).toEqual(DEFAULTS);
    const f = Object.fromEntries(plugin.settings.map((x) => [x.key, x]));
    expect(f.hands).toMatchObject({ type: "number", min: 1, max: 30 });
    expect(f.targetPoints).toMatchObject({ type: "number", min: 1, max: 20, visibleIf: { key: "endRule", in: ["points"] } });
    const opts = (k: string) => (f[k] as { options: { value: string }[] }).options.map((o) => o.value).sort();
    expect(f.endRule.type).toBe("select");
    expect(opts("endRule")).toEqual(["hands", "points"]);
    expect(opts("removedSevens")).toEqual(["clubsDiamonds", "heartsDiamonds", "spadesClubs"]);
    expect(opts("trumpCallAfter")).toEqual(["all", "five"]);
    expect(opts("pullRule")).toEqual(["highest", "off"]);
  });

  it("clamps out-of-range settings", () => {
    expect(harness({ hands: 99 }).state.settings.hands).toBe(30);
    expect(harness({ hands: 0 }).state.settings.hands).toBe(1);
    expect(harness({ targetPoints: 50 }).state.settings.targetPoints).toBe(20);
  });
});

describe("teendopaanch: setup and dealing", () => {
  it("hand 1: targets 5/3/2, p0 calls trump, dealer p2, nothing owed", () => {
    const h = harness();
    const st = h.state;
    expect(st.order).toEqual(ORDER);
    expect(st.settings).toEqual(DEFAULTS);
    expect(st.phase).toBe("trump");
    expect(st.hand).toBe(1);
    expect(st.targets).toEqual({ p0: 5, p1: 3, p2: 2 });
    expect(st.trumpMaker).toBe("p0");
    expect(st.dealer).toBe("p2");
    expect(st.trump).toBeNull();
    expect(st.turn).toBeNull();
    expect(st.owed).toEqual(ZERO);
    expect(st.totals).toEqual(ZERO);
    expect(st.tricksWon).toEqual(ZERO);
    expect(st.history).toEqual([]);
    expect(st.pullQueue).toEqual([]);
    expect(st.exchanges).toEqual([]);
    expect(st.trick).toEqual([]);
    expect(st.lastTrick).toBeNull();
    expect(plugin.activePlayers(st)).toEqual(["p0"]);
    expect(h.match.over).toBe(false);
    expect(plugin.scores(st).map((s) => [s.playerId, s.score, s.rank]).sort()).toEqual([
      ["p0", 0, 1],
      ["p1", 0, 1],
      ["p2", 0, 1],
    ]);
  });

  it("default deal: 5 in hand + 5 face down each, 30 distinct cards without 7C 7D", () => {
    for (const seed of [1, 2, 3]) {
      const st = harness({}, seed).state;
      for (const p of ORDER) {
        expect(st.hands[p]).toHaveLength(5);
        expect(st.secondBatch[p]).toHaveLength(5);
      }
      const all = ORDER.flatMap((p) => [...st.hands[p], ...st.secondBatch[p]]);
      expect(new Set(all).size).toBe(30);
      expect(sorted(all)).toEqual(sorted(deckFor("clubsDiamonds")));
      expect(all).not.toContain("7C");
      expect(all).not.toContain("7D");
      expect(all).toContain("7S");
      expect(all).toContain("7H");
      expect(all.some((c) => ["2", "3", "4", "5", "6"].includes(c[0]))).toBe(false);
    }
  });

  it.each([
    ["clubsDiamonds", ["7C", "7D"], ["7S", "7H"]],
    ["heartsDiamonds", ["7H", "7D"], ["7S", "7C"]],
    ["spadesClubs", ["7S", "7C"], ["7H", "7D"]],
  ])("removedSevens=%s removes the right sevens", (removedSevens, gone, kept) => {
    const st = harness({ removedSevens }, 4).state;
    const all = ORDER.flatMap((p) => [...st.hands[p], ...st.secondBatch[p]]);
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
    for (const c of gone) expect(all).not.toContain(c);
    for (const c of kept) expect(all).toContain(c);
    expect(sorted(all)).toEqual(sorted(deckFor(removedSevens)));
  });

  it("trumpCallAfter=all deals all 10 at once", () => {
    const h = harness({ trumpCallAfter: "all" }, 2);
    const st = h.state;
    expect(st.phase).toBe("trump");
    for (const p of ORDER) {
      expect(st.hands[p]).toHaveLength(10);
      expect(st.secondBatch[p]).toEqual([]);
    }
    expect(sorted(ORDER.flatMap((p) => st.hands[p]))).toEqual(sorted(deckFor("clubsDiamonds")));
    const v = h.view("p0");
    expect(v.awaitingSecondBatch).toBe(false);
    expect(v.myHand).toHaveLength(10);
    expect(v.handCounts).toEqual({ p0: 10, p1: 10, p2: 10 });
    expect(h.legal("p0")).toHaveLength(4);
    h.act("p0", { type: "trump", suit: "C" });
    for (const p of ORDER) expect(sorted(h.state.hands[p])).toEqual(sorted(st.hands[p]));
    expect(h.state.phase).toBe("play");
  });

  it("different seeds shuffle differently; same seed is identical", () => {
    expect(harness({}, 11).state).toEqual(harness({}, 11).state);
    expect(harness({}, 11).state.hands).not.toEqual(harness({}, 12).state.hands);
  });
});

describe("teendopaanch: trump phase", () => {
  it("only the trump maker may call, any of 4 suits, after seeing only the first batch", () => {
    const h = harness({}, 3);
    const st = h.state;
    expect(sorted(h.legal("p0").map((a) => JSON.stringify(a)))).toEqual(
      sorted(ALL_SUITS.map((suit) => JSON.stringify({ type: "trump", suit }))),
    );
    expect(h.legal("p1")).toEqual([]);
    expect(h.legal("p2")).toEqual([]);
    expect(h.legal("nobody")).toEqual([]);
    const v = h.view("p0");
    expect(v.phase).toBe("trump");
    expect(v.awaitingSecondBatch).toBe(true);
    expect(sorted(v.myHand)).toEqual(sorted(st.hands.p0));
    expect(v.handCounts).toEqual({ p0: 5, p1: 5, p2: 5 });
    expect(v.totalHands).toBe(6);
    // own second batch is not visible, even to its owner
    expect(findLeaks(v, st.secondBatch.p0)).toEqual([]);
    expect(findLeaks(h.legal("p0"), st.secondBatch.p0)).toEqual([]);
    assertNoLeaks(h);
  });

  it("calling trump joins the second batch and starts play with the trump maker leading", () => {
    const h = harness({}, 3);
    const st = h.state;
    h.act("p0", { type: "trump", suit: "H" });
    const af = h.state;
    expect(af.trump).toBe("H");
    expect(af.phase).toBe("play");
    expect(af.turn).toBe("p0");
    expect(af.leader).toBe("p0");
    expect(af.pullQueue).toEqual([]);
    for (const p of ORDER) {
      expect(sorted(af.hands[p])).toEqual(sorted([...st.hands[p], ...st.secondBatch[p]]));
      expect(af.secondBatch[p]).toEqual([]);
    }
    const v = h.view("p1");
    expect(v.awaitingSecondBatch).toBe(false);
    expect(v.trump).toBe("H");
    expect(v.myHand).toHaveLength(10);
    expect(v.trickNumber).toBe(1);
    expect(plugin.activePlayers(af)).toEqual(["p0"]);
    assertNoLeaks(h);
  });

  it("rejects trump from others, twice, or outside the trump phase", () => {
    const h = harness({}, 3);
    expect(h.tryAct("p1", { type: "trump", suit: "S" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "play", card: h.state.hands.p0[0] })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "pull", card: h.state.hands.p0[0] })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "nextHand" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "trump", suit: "X" as Suit })).toMatch(/isn't allowed/);
    expect(h.tryAct("spectator", { type: "trump", suit: "S" })).toMatch(/not playing/);
    h.act("p0", { type: "trump", suit: "S" });
    expect(h.tryAct("p0", { type: "trump", suit: "D" })).toMatch(/isn't allowed/);
  });

  it("hand 2: p1 is trump maker and others (incl. host p0) cannot call", () => {
    const h = harness({}, 5);
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 5, p1: 3, p2: 2 }, winner: "p0" }));
    playLastTrick(h, "p0");
    h.act("p0", { type: "nextHand" });
    expect(h.state.trumpMaker).toBe("p1");
    expect(h.legal("p1")).toHaveLength(4);
    expect(h.legal("p0")).toEqual([]);
    expect(h.legal("p2")).toEqual([]);
    expect(plugin.activePlayers(h.state)).toEqual(["p1"]);
  });
});

describe("teendopaanch: play, follow suit and trick winners", () => {
  const playState = () => mk({ hand: 1, trump: "H", hands: EX_HANDS, leader: "p0", turn: "p0" });

  it("must follow suit; trick goes to the highest of the led suit; winner leads next", () => {
    const h = harness();
    h.setState(playState());
    expect(sorted(h.legal("p0").map((a) => (a as { card: Card }).card))).toEqual(sorted(EX_HANDS.p0));
    expect(h.legal("p1")).toEqual([]);
    h.act("p0", { type: "play", card: "7S" });
    expect(h.state.turn).toBe("p1");
    expect(sorted(h.legal("p1").map((a) => (a as { card: Card }).card))).toEqual(["9S", "AS", "KS"].sort());
    expect(h.tryAct("p1", { type: "play", card: "AH" })).toMatch(/isn't allowed/); // trump not allowed while holding spades
    expect(h.tryAct("p1", { type: "play", card: "QS" })).toMatch(/isn't allowed/); // not held
    expect(h.tryAct("p2", { type: "play", card: "QS" })).toMatch(/isn't allowed/); // wrong turn
    h.act("p1", { type: "play", card: "9S" });
    expect(h.view(null).trick).toEqual([
      { playerId: "p0", card: "7S" },
      { playerId: "p1", card: "9S" },
    ]);
    expect(sorted(h.legal("p2").map((a) => (a as { card: Card }).card))).toEqual(["8S", "JS", "QS", "TS"].sort());
    h.act("p2", { type: "play", card: "8S" });
    const st = h.state;
    expect(st.lastTrick).toEqual({
      plays: [
        { playerId: "p0", card: "7S" },
        { playerId: "p1", card: "9S" },
        { playerId: "p2", card: "8S" },
      ],
      winner: "p1",
    });
    expect(st.trick).toEqual([]);
    expect(st.turn).toBe("p1");
    expect(st.leader).toBe("p1");
    expect(st.tricksWon).toEqual({ p0: 0, p1: 1, p2: 0 });
    expect(h.view("p2").trickNumber).toBe(2);
    expect(h.view("p2").lastTrick?.winner).toBe("p1");
    expect(plugin.activePlayers(st)).toEqual(["p1"]);
    assertNoLeaks(h);

    // Trick 2: p1 leads KS, p2 must follow, p0 is void in spades and may trump OR discard (never forced).
    h.act("p1", { type: "play", card: "KS" });
    h.act("p2", { type: "play", card: "QS" });
    const p0legal = sorted(h.legal("p0").map((a) => (a as { card: Card }).card));
    expect(p0legal).toEqual(sorted(EX_HANDS.p0.filter((c) => c !== "7S")));
    expect(p0legal).toContain("9D");
    h.act("p0", { type: "play", card: "TH" });
    expect(h.state.lastTrick?.winner).toBe("p0"); // trump beats the led suit
    expect(h.state.turn).toBe("p0");
    expect(h.state.tricksWon).toEqual({ p0: 1, p1: 1, p2: 0 });

    // Trick 3: p0 leads QC; p1 (void) discards an off-suit ace; p2 follows low. Off-suit ace does not win.
    h.act("p0", { type: "play", card: "QC" });
    expect(sorted(h.legal("p1").map((a) => (a as { card: Card }).card))).toHaveLength(8);
    h.act("p1", { type: "play", card: "AD" });
    expect(sorted(h.legal("p2").map((a) => (a as { card: Card }).card))).toEqual(["8C", "9C", "JC", "TC"].sort());
    h.act("p2", { type: "play", card: "8C" });
    expect(h.state.lastTrick?.winner).toBe("p0");

    // Trick 4: p0 leads KC; p1 trumps with the lowest trump; p2 follows clubs. Trump wins.
    h.act("p0", { type: "play", card: "KC" });
    h.act("p1", { type: "play", card: "7H" });
    h.act("p2", { type: "play", card: "9C" });
    expect(h.state.lastTrick?.winner).toBe("p1");
    expect(h.state.turn).toBe("p1");
    expect(h.state.tricksWon).toEqual({ p0: 2, p1: 2, p2: 0 });
    expect(h.view("p0").trickNumber).toBe(5);
    expect(h.view("p0").handCounts).toEqual({ p0: 6, p1: 6, p2: 6 });
  });

  it("higher trump over-trumps; leading player p2 wraps to p0", () => {
    const h = harness();
    h.setState(
      mk({
        hand: 1,
        trump: "H",
        hands: { p0: ["8D", "7H"], p1: ["9H", "QD"], p2: ["KC", "9D"] },
        leader: "p2",
        turn: "p2",
        tricksWon: { p0: 3, p1: 3, p2: 2 },
      }),
    );
    h.act("p2", { type: "play", card: "KC" });
    expect(h.state.turn).toBe("p0");
    h.act("p0", { type: "play", card: "7H" });
    h.act("p1", { type: "play", card: "9H" });
    expect(h.state.lastTrick?.winner).toBe("p1");
    expect(h.state.tricksWon).toEqual({ p0: 3, p1: 4, p2: 2 });
    expect(h.state.turn).toBe("p1");
  });

  it("leading a trump: highest trump wins; following trump suit is forced", () => {
    const h = harness();
    h.setState(
      mk({
        hand: 1,
        trump: "D",
        hands: { p0: ["9D", "AS"], p1: ["KD", "AC"], p2: ["8D", "AH"] },
        leader: "p0",
        turn: "p0",
        tricksWon: { p0: 4, p1: 2, p2: 2 },
      }),
    );
    h.act("p0", { type: "play", card: "9D" });
    expect(h.legal("p1")).toEqual([{ type: "play", card: "KD" }]);
    h.act("p1", { type: "play", card: "KD" });
    expect(h.legal("p2")).toEqual([{ type: "play", card: "8D" }]);
    h.act("p2", { type: "play", card: "8D" });
    expect(h.state.lastTrick?.winner).toBe("p1");
  });

  it("rejects play outside play phase and by spectators", () => {
    const h = harness();
    h.setState(playState());
    expect(h.tryAct("p0", { type: "trump", suit: "S" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "pull", card: "7S" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "nextHand" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "play", card: "AS" })).toMatch(/isn't allowed/); // p1's card
    expect(h.tryAct("p1", { type: "play", card: "AS" })).toMatch(/isn't allowed/); // not p1's turn
    expect(h.tryAct("ghost", { type: "play", card: "7S" })).toMatch(/not playing/);
    expect(h.legal("ghost")).toEqual([]);
  });
});

describe("teendopaanch: scoring and end of hand", () => {
  it("hand 1: 6/2/2 tricks vs 5/3/2 targets gives +1/-1/0", () => {
    const h = harness();
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 6, p1: 2, p2: 2 }, winner: "p0" }));
    playLastTrick(h, "p0");
    const st = h.state;
    expect(st.phase).toBe("handEnd");
    expect(st.tricksWon).toEqual({ p0: 6, p1: 2, p2: 2 });
    expect(st.history).toEqual([
      {
        hand: 1,
        dealer: "p2",
        trump: "S",
        targets: { p0: 5, p1: 3, p2: 2 },
        tricks: { p0: 6, p1: 2, p2: 2 },
        diffs: { p0: 1, p1: -1, p2: 0 },
      },
    ]);
    expect(st.totals).toEqual({ p0: 1, p1: -1, p2: 0 });
    expect(st.turn).toBeNull();
    expect(st.lastTrick).toEqual({
      plays: [
        { playerId: "p0", card: "AS" },
        { playerId: "p1", card: "8H" },
        { playerId: "p2", card: "9H" },
      ],
      winner: "p0",
    });
    expect(h.view("p1").trickNumber).toBe(10);
    expect(plugin.activePlayers(st)).toEqual([]);
    expect(h.legal("p0")).toEqual([{ type: "nextHand" }]); // host
    expect(h.legal("p1")).toEqual([]);
    expect(h.legal("p2")).toEqual([]);
    expect(h.tryAct("p1", { type: "nextHand" })).toMatch(/isn't allowed/);
    const sc = plugin.scores(st);
    expect(sc.find((s) => s.playerId === "p0")).toMatchObject({ score: 1, rank: 1 });
    expect(sc.find((s) => s.playerId === "p2")).toMatchObject({ score: 0, rank: 2 });
    expect(sc.find((s) => s.playerId === "p1")).toMatchObject({ score: -1, rank: 3 });
    assertNoLeaks(h);
  });

  it("hand 2 accumulates totals: targets p1 5, p2 3, p0 2; tricks 1/7/2 -> -1/+2/-1", () => {
    const h = harness();
    h.setState(
      lastTrickState({
        hand: 2,
        finalTricks: { p0: 1, p1: 7, p2: 2 },
        winner: "p1",
        totals: { p0: 1, p1: -1, p2: 0 },
        owed: { p0: 1, p1: -1, p2: 0 },
      }),
    );
    expect(h.state.targets).toEqual({ p0: 2, p1: 5, p2: 3 });
    playLastTrick(h, "p1");
    const st = h.state;
    expect(st.phase).toBe("handEnd");
    const res = st.history[st.history.length - 1];
    expect(res).toMatchObject({
      hand: 2,
      dealer: "p0",
      targets: { p0: 2, p1: 5, p2: 3 },
      tricks: { p0: 1, p1: 7, p2: 2 },
      diffs: { p0: -1, p1: 2, p2: -1 },
    });
    expect(st.totals).toEqual({ p0: 0, p1: 1, p2: -1 });
    const sc = Object.fromEntries(plugin.scores(st).map((s) => [s.playerId, [s.score, s.rank]]));
    expect(sc).toEqual({ p1: [1, 1], p0: [0, 2], p2: [-1, 3] });
  });

  it("exact targets give 0 diffs; ties share rank", () => {
    const h = harness();
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 5, p1: 3, p2: 2 }, winner: "p2" }));
    playLastTrick(h, "p2");
    expect(h.state.history[0].diffs).toEqual(ZERO);
    expect(h.state.totals).toEqual(ZERO);
    expect(plugin.scores(h.state).map((s) => s.rank)).toEqual([1, 1, 1]);
  });

  it("tie for first shares rank 1, next is rank 3", () => {
    const st = mk({ phase: "handEnd", turn: null, totals: { p0: 2, p1: 2, p2: -4 }, history: fakeHistory(1, { p0: 2, p1: 2, p2: -4 }) });
    const sc = Object.fromEntries(plugin.scores(st).map((s) => [s.playerId, s.rank]));
    expect(sc).toEqual({ p0: 1, p1: 1, p2: 3 });
  });

  it("mid-hand scores count completed hands only", () => {
    const st = mk({
      hand: 2,
      hands: { p0: ["AS"], p1: ["8H"], p2: ["9H"] },
      leader: "p1",
      turn: "p1",
      tricksWon: { p0: 0, p1: 0, p2: 9 },
      totals: { p0: 1, p1: -1, p2: 0 },
      history: fakeHistory(1, { p0: 1, p1: -1, p2: 0 }),
    });
    const sc = Object.fromEntries(plugin.scores(st).map((s) => [s.playerId, s.score]));
    expect(sc).toEqual({ p0: 1, p1: -1, p2: 0 });
  });

  it("nextHand rotates seats and keeps totals/history", () => {
    const h = harness({}, 8);
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 6, p1: 2, p2: 2 }, winner: "p0" }));
    playLastTrick(h, "p0");
    h.act("p0", { type: "nextHand" });
    const st = h.state;
    expect(st.hand).toBe(2);
    expect(st.phase).toBe("trump");
    expect(st.targets).toEqual({ p0: 2, p1: 5, p2: 3 });
    expect(st.dealer).toBe("p0");
    expect(st.trumpMaker).toBe("p1");
    expect(st.totals).toEqual({ p0: 1, p1: -1, p2: 0 });
    expect(st.history).toHaveLength(1);
    expect(st.owed).toEqual({ p0: 1, p1: -1, p2: 0 });
    expect(st.tricksWon).toEqual(ZERO);
    expect(st.trick).toEqual([]);
    expect(st.trump).toBeNull();
    for (const p of ORDER) {
      expect(st.hands[p]).toHaveLength(5);
      expect(st.secondBatch[p]).toHaveLength(5);
    }
    expect(sorted(ORDER.flatMap((p) => [...st.hands[p], ...st.secondBatch[p]]))).toEqual(sorted(deckFor("clubsDiamonds")));
    expect(h.view("p2").owed).toEqual({ p0: 1, p1: -1, p2: 0 });
    assertNoLeaks(h);
  });

  it("hand 3 seats: p2 = 5, p0 = 3, p1 = 2 (dealer); hand 4 repeats hand 1", () => {
    const h = harness({}, 9);
    h.setState(lastTrickState({ hand: 2, finalTricks: { p0: 2, p1: 5, p2: 3 }, winner: "p1" }));
    playLastTrick(h, "p1");
    h.act("p0", { type: "nextHand" });
    expect(h.state).toMatchObject({ hand: 3, trumpMaker: "p2", dealer: "p1", targets: { p2: 5, p0: 3, p1: 2 } });
    h.setState(lastTrickState({ hand: 3, finalTricks: { p0: 3, p1: 2, p2: 5 }, winner: "p2" }));
    playLastTrick(h, "p2");
    h.act("p0", { type: "nextHand" });
    expect(h.state).toMatchObject({ hand: 4, trumpMaker: "p0", dealer: "p2", targets: { p0: 5, p1: 3, p2: 2 } });
  });

  it("a non-p0 host is the one who deals the next hand", () => {
    const h = harness({}, 1, "p1");
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 5, p1: 3, p2: 2 }, winner: "p0" }));
    playLastTrick(h, "p0");
    expect(h.legal("p1")).toEqual([{ type: "nextHand" }]);
    expect(h.legal("p0")).toEqual([]);
    expect(h.tryAct("p0", { type: "nextHand" })).toMatch(/isn't allowed/);
    h.act("p1", { type: "nextHand" });
    expect(h.state.hand).toBe(2);
  });
});

describe("teendopaanch: pulling (card exchange)", () => {
  const cases: [string, number, Rec, Pid, PullStep[]][] = [
    ["+1/-1/0 after hand 1", 1, { p0: 6, p1: 2, p2: 2 }, "p0", [{ puller: "p0", victim: "p1" }]],
    [
      "+2/-1/-1 after hand 1",
      1,
      { p0: 7, p1: 2, p2: 1 },
      "p0",
      [
        { puller: "p0", victim: "p1" },
        { puller: "p0", victim: "p2" },
      ],
    ],
    [
      "-2/+1/+1 after hand 1 (pullers from trump maker p1)",
      1,
      { p0: 3, p1: 4, p2: 3 },
      "p1",
      [
        { puller: "p1", victim: "p0" },
        { puller: "p2", victim: "p0" },
      ],
    ],
    [
      "-1/+2/-1 after hand 1 (victims start after the puller)",
      1,
      { p0: 4, p1: 5, p2: 1 },
      "p1",
      [
        { puller: "p1", victim: "p2" },
        { puller: "p1", victim: "p0" },
      ],
    ],
    [
      "+3/-1/-2 after hand 2 (hand 3, trump maker p2)",
      2,
      { p0: 5, p1: 4, p2: 1 },
      "p0",
      [
        { puller: "p0", victim: "p1" },
        { puller: "p0", victim: "p2" },
        { puller: "p0", victim: "p2" },
      ],
    ],
    [
      "+1/+1/-2 after hand 2 (p0 pulls before p1, clockwise from p2)",
      2,
      { p0: 3, p1: 6, p2: 1 },
      "p1",
      [
        { puller: "p0", victim: "p2" },
        { puller: "p1", victim: "p2" },
      ],
    ],
  ];

  it.each(cases)("pull queue: %s", (_name, hand, finalTricks, winner, queue) => {
    const h = harness({}, 21);
    h.setState(lastTrickState({ hand, finalTricks, winner }));
    playLastTrick(h, winner);
    const diffs = h.state.history[h.state.history.length - 1].diffs;
    h.act("p0", { type: "nextHand" });
    expect(h.state.owed).toEqual(diffs);
    const tm = h.state.trumpMaker;
    expect(tm).toBe(seatsFor(hand + 1).trumpMaker);
    h.act(tm as Pid, { type: "trump", suit: "S" });
    const st = h.state;
    expect(expectedQueue(tm, diffs)).toEqual(queue); // sanity of the test's own model
    expect(st.phase).toBe("exchange");
    expect(st.pullQueue).toEqual(queue);
    expect(h.view(null).pullQueue).toEqual(queue);
    expect(st.turn).toBeNull();
    for (const p of ORDER) expect(st.hands[p]).toHaveLength(10);
    const puller = queue[0].puller as Pid;
    expect(plugin.activePlayers(st)).toEqual([puller]);
    const legal = h.legal(puller);
    expect(legal).toHaveLength(10);
    expect(legal.every((a) => a.type === "pull")).toBe(true);
    expect(sorted(legal.map((a) => (a as { card: Card }).card))).toEqual(sorted(st.hands[puller]));
    for (const p of ORDER) if (p !== puller) expect(h.legal(p)).toEqual([]);
    assertNoLeaks(h);
    // finish all pulls with the first legal card; then play starts with the trump maker
    let guard = 0;
    while (h.state.phase === "exchange" && guard++ < 10) {
      const pl = h.state.pullQueue[0].puller as Pid;
      h.act(pl, h.legal(pl)[0]);
      assertNoLeaks(h);
    }
    expect(h.state.phase).toBe("play");
    expect(h.state.exchanges).toHaveLength(queue.length);
    expect(h.state.exchanges.map((e) => ({ puller: e.puller, victim: e.victim }))).toEqual(queue);
    expect(h.state.turn).toBe(tm);
    expect(h.state.leader).toBe(tm);
    for (const p of ORDER) expect(h.state.hands[p]).toHaveLength(10);
  });

  it("no pulls when the previous hand was exact", () => {
    const h = harness({}, 22);
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 5, p1: 3, p2: 2 }, winner: "p0" }));
    playLastTrick(h, "p0");
    h.act("p0", { type: "nextHand" });
    h.act("p1", { type: "trump", suit: "D" });
    expect(h.state.phase).toBe("play");
    expect(h.state.pullQueue).toEqual([]);
    expect(h.state.turn).toBe("p1");
  });

  it("hand 1 never has an exchange", () => {
    const h = harness({}, 6);
    expect(h.state.owed).toEqual(ZERO);
    h.act("p0", { type: "trump", suit: "S" });
    expect(h.state.phase).toBe("play");
    expect(h.state.pullQueue).toEqual([]);
  });

  it("victim returns the highest card of the given suit (7S for AS)", () => {
    const h = harness();
    const owed = { p0: 1, p1: -1, p2: 0 };
    h.setState(exchangeState([{ puller: "p0", victim: "p1" }], owed));
    expect(plugin.activePlayers(h.state)).toEqual(["p0"]);
    expect(h.tryAct("p1", { type: "pull", card: "AS" })).toMatch(/isn't allowed/); // victim takes no action
    expect(h.tryAct("p2", { type: "pull", card: "QS" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "pull", card: "AS" })).toMatch(/isn't allowed/); // not held
    expect(h.tryAct("p0", { type: "play", card: "7S" })).toMatch(/isn't allowed/); // wrong phase
    expect(h.tryAct("p0", { type: "trump", suit: "S" })).toMatch(/isn't allowed/);
    expect(h.tryAct("p0", { type: "nextHand" })).toMatch(/isn't allowed/);
    h.act("p0", { type: "pull", card: "7S" });
    const st = h.state;
    expect(sorted(st.hands.p0)).toEqual(sorted([...EX_HANDS.p0.filter((c) => c !== "7S"), "AS"]));
    expect(sorted(st.hands.p1)).toEqual(sorted([...EX_HANDS.p1.filter((c) => c !== "AS"), "7S"]));
    expect(sorted(st.hands.p2)).toEqual(sorted(EX_HANDS.p2));
    expect(st.exchanges).toEqual([{ puller: "p0", victim: "p1", given: "7S", returned: "AS" }]);
    expect(st.pullQueue).toEqual([]);
    expect(st.phase).toBe("play");
    expect(st.turn).toBe("p1"); // hand 2 trump maker leads
    expect(st.leader).toBe("p1");

    // views: participants see the cards, third player and spectators do not
    expect(h.view("p0").exchanges).toEqual([{ puller: "p0", victim: "p1", given: "7S", returned: "AS" }]);
    expect(h.view("p1").exchanges).toEqual([{ puller: "p0", victim: "p1", given: "7S", returned: "AS" }]);
    expect(h.view("p2").exchanges).toEqual([{ puller: "p0", victim: "p1", given: null, returned: null }]);
    expect(h.view(null).exchanges).toEqual([{ puller: "p0", victim: "p1", given: null, returned: null }]);
    expect(findLeaks(h.view("p2"), ["7S", "AS"])).toEqual([]);
    expect(findLeaks(h.view(null), ["7S", "AS"])).toEqual([]);
    assertNoLeaks(h);

    // exchanges stay visible during play (to the right people only)
    h.act("p1", { type: "play", card: "AD" });
    expect(h.view("p2").exchanges).toEqual([{ puller: "p0", victim: "p1", given: null, returned: null }]);
    expect(h.view("p0").exchanges[0]).toMatchObject({ given: "7S", returned: "AS" });
    assertNoLeaks(h);
  });

  it("victim with no card of the suit returns the received card (nothing changes)", () => {
    const h = harness();
    h.setState(exchangeState([{ puller: "p0", victim: "p1" }], { p0: 1, p1: -1, p2: 0 }));
    h.act("p0", { type: "pull", card: "AC" });
    expect(sorted(h.state.hands.p0)).toEqual(sorted(EX_HANDS.p0));
    expect(sorted(h.state.hands.p1)).toEqual(sorted(EX_HANDS.p1));
    expect(h.state.exchanges).toEqual([{ puller: "p0", victim: "p1", given: "AC", returned: "AC" }]);
    expect(h.view("p2").exchanges).toEqual([{ puller: "p0", victim: "p1", given: null, returned: null }]);
    expect(findLeaks(h.view("p2"), ["AC"])).toEqual([]);
  });

  it("victim holding only lower cards of the suit returns the received card", () => {
    const h = harness();
    h.setState(exchangeState([{ puller: "p0", victim: "p2" }], { p0: 1, p1: 0, p2: -1 }));
    h.act("p0", { type: "pull", card: "KC" });
    expect(sorted(h.state.hands.p0)).toEqual(sorted(EX_HANDS.p0));
    expect(sorted(h.state.hands.p2)).toEqual(sorted(EX_HANDS.p2));
    expect(h.state.exchanges).toEqual([{ puller: "p0", victim: "p2", given: "KC", returned: "KC" }]);
    expect(h.view("p1").exchanges).toEqual([{ puller: "p0", victim: "p2", given: null, returned: null }]);
  });

  it("puller may give a trump card", () => {
    const h = harness();
    h.setState(exchangeState([{ puller: "p0", victim: "p1" }], { p0: 1, p1: -1, p2: 0 })); // trump D
    expect(h.legal("p0")).toContainEqual({ type: "pull", card: "9D" });
    h.act("p0", { type: "pull", card: "9D" });
    expect(h.state.exchanges[0]).toEqual({ puller: "p0", victim: "p1", given: "9D", returned: "AD" });
    expect(h.state.hands.p0).toContain("AD");
    expect(h.state.hands.p1).toContain("9D");
  });

  it("two pullers in queue order; each sees only their own exchange", () => {
    const h = harness();
    h.setState(
      exchangeState(
        [
          { puller: "p1", victim: "p0" },
          { puller: "p2", victim: "p0" },
        ],
        { p0: -2, p1: 1, p2: 1 },
      ),
    );
    expect(plugin.activePlayers(h.state)).toEqual(["p1"]);
    expect(h.legal("p2")).toEqual([]);
    expect(h.tryAct("p2", { type: "pull", card: "8S" })).toMatch(/isn't allowed/);
    h.act("p1", { type: "pull", card: "9H" }); // p0 hearts KH QH JH TH + 9H -> returns KH
    expect(h.state.phase).toBe("exchange");
    expect(h.state.pullQueue).toEqual([{ puller: "p2", victim: "p0" }]);
    expect(plugin.activePlayers(h.state)).toEqual(["p2"]);
    expect(h.state.hands.p1).toContain("KH");
    expect(h.state.hands.p0).toContain("9H");
    expect(h.view("p2").exchanges).toEqual([{ puller: "p1", victim: "p0", given: null, returned: null }]);
    assertNoLeaks(h);
    h.act("p2", { type: "pull", card: "8S" }); // p0 has 7S, 8S is highest -> returns 8S
    expect(h.state.exchanges).toEqual([
      { puller: "p1", victim: "p0", given: "9H", returned: "KH" },
      { puller: "p2", victim: "p0", given: "8S", returned: "8S" },
    ]);
    expect(h.view("p0").exchanges).toEqual(h.state.exchanges);
    expect(h.view("p1").exchanges).toEqual([
      { puller: "p1", victim: "p0", given: "9H", returned: "KH" },
      { puller: "p2", victim: "p0", given: null, returned: null },
    ]);
    expect(h.view("p2").exchanges).toEqual([
      { puller: "p1", victim: "p0", given: null, returned: null },
      { puller: "p2", victim: "p0", given: "8S", returned: "8S" },
    ]);
    expect(h.view(null).exchanges.every((e) => e.given === null && e.returned === null)).toBe(true);
    expect(h.state.phase).toBe("play");
    expect(h.state.turn).toBe("p1");
    assertNoLeaks(h);
  });

  it("pullRule=off: owed is reported but no exchange happens", () => {
    const h = harness({ pullRule: "off" }, 23);
    h.setState(
      lastTrickState({ hand: 1, finalTricks: { p0: 7, p1: 2, p2: 1 }, winner: "p0", settings: { pullRule: "off" } }),
    );
    playLastTrick(h, "p0");
    h.act("p0", { type: "nextHand" });
    expect(h.state.owed).toEqual({ p0: 2, p1: -1, p2: -1 });
    expect(h.view("p1").owed).toEqual({ p0: 2, p1: -1, p2: -1 });
    h.act("p1", { type: "trump", suit: "H" });
    expect(h.state.phase).toBe("play");
    expect(h.state.pullQueue).toEqual([]);
    expect(h.state.exchanges).toEqual([]);
    expect(h.state.turn).toBe("p1");
  });

  it("trumpCallAfter=all still exchanges after trump in hand 2", () => {
    const h = harness({ trumpCallAfter: "all" }, 24);
    h.setState(
      lastTrickState({ hand: 1, finalTricks: { p0: 6, p1: 2, p2: 2 }, winner: "p0", settings: { trumpCallAfter: "all" } }),
    );
    playLastTrick(h, "p0");
    h.act("p0", { type: "nextHand" });
    for (const p of ORDER) expect(h.state.hands[p]).toHaveLength(10);
    expect(h.state.phase).toBe("trump");
    h.act("p1", { type: "trump", suit: "C" });
    expect(h.state.phase).toBe("exchange");
    expect(h.state.pullQueue).toEqual([{ puller: "p0", victim: "p1" }]);
  });

  it("exchanges are cleared at the next deal", () => {
    const h = harness();
    h.setState({
      ...lastTrickState({ hand: 2, finalTricks: { p0: 2, p1: 5, p2: 3 }, winner: "p1", owed: { p0: 1, p1: -1, p2: 0 } }),
      exchanges: [{ puller: "p0", victim: "p1", given: "7S", returned: "KS" }],
    });
    expect(h.view("p2").exchanges).toEqual([{ puller: "p0", victim: "p1", given: null, returned: null }]);
    playLastTrick(h, "p1");
    h.act("p0", { type: "nextHand" });
    expect(h.state.exchanges).toEqual([]);
    for (const v of VIEWERS) expect(h.view(v).exchanges).toEqual([]);
  });
});

describe("teendopaanch: end of game", () => {
  it("hands=1 ends after hand 1", () => {
    const h = harness({ hands: 1 });
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 4, p1: 4, p2: 2 }, winner: "p0", settings: { hands: 1 } }));
    playLastTrick(h, "p0");
    const st = h.state;
    expect(st.phase).toBe("over");
    expect(plugin.isOver(st)).toBe(true);
    expect(h.match.over).toBe(true);
    expect(st.history).toHaveLength(1);
    expect(st.history[0].diffs).toEqual({ p0: -1, p1: 1, p2: 0 });
    expect(st.lastTrick?.winner).toBe("p0");
    expect(st.lastTrick?.plays).toHaveLength(3);
    expect(plugin.activePlayers(st)).toEqual([]);
    for (const p of ORDER) expect(h.legal(p)).toEqual([]);
    expect(h.tryAct("p0", { type: "nextHand" })).toMatch(/over/);
    const sc = Object.fromEntries(plugin.scores(st).map((s) => [s.playerId, [s.score, s.rank]]));
    expect(sc).toEqual({ p1: [1, 1], p2: [0, 2], p0: [-1, 3] });
    expect(h.view(null).phase).toBe("over");
    assertNoLeaks(h);
  });

  it("default 6 hands: hand 5 ends in handEnd, hand 6 ends the game", () => {
    const h = harness();
    h.setState(lastTrickState({ hand: 5, finalTricks: { p0: 2, p1: 5, p2: 3 }, winner: "p1" }));
    playLastTrick(h, "p1");
    expect(h.state.phase).toBe("handEnd");
    expect(h.match.over).toBe(false);
    h.act("p0", { type: "nextHand" });
    expect(h.state.hand).toBe(6);
    h.setState(lastTrickState({ hand: 6, finalTricks: { p0: 3, p1: 2, p2: 5 }, winner: "p2" }));
    playLastTrick(h, "p2");
    expect(h.state.phase).toBe("over");
    expect(h.match.over).toBe(true);
    expect(h.state.history).toHaveLength(6);
  });

  it("hands mode ignores targetPoints", () => {
    const h = harness({ targetPoints: 1 });
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 9, p1: 0, p2: 1 }, winner: "p0", settings: { targetPoints: 1 } }));
    playLastTrick(h, "p0");
    expect(h.state.totals).toEqual({ p0: 4, p1: -3, p2: -1 });
    expect(h.state.phase).toBe("handEnd");
  });

  const pts = { endRule: "points", targetPoints: 3, hands: 30 } as const;

  it("points mode: ends when a total reaches targetPoints exactly", () => {
    const h = harness(pts);
    h.setState(
      lastTrickState({ hand: 2, finalTricks: { p0: 3, p1: 4, p2: 3 }, winner: "p0", settings: pts, totals: { p0: 2, p1: -1, p2: -1 } }),
    );
    playLastTrick(h, "p0");
    // hand 2 targets p0 2, p1 5, p2 3 -> diffs +1, -1, 0 -> totals 3, -2, -1
    expect(h.state.totals).toEqual({ p0: 3, p1: -2, p2: -1 });
    expect(h.state.phase).toBe("over");
    expect(h.match.over).toBe(true);
    expect(plugin.scores(h.state).find((s) => s.rank === 1)?.playerId).toBe("p0");
  });

  it("points mode: overshooting also ends; below target continues", () => {
    const h = harness(pts);
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 9, p1: 0, p2: 1 }, winner: "p0", settings: pts }));
    playLastTrick(h, "p0");
    expect(h.state.totals.p0).toBe(4);
    expect(h.state.phase).toBe("over");

    const h2 = harness(pts);
    h2.setState(lastTrickState({ hand: 1, finalTricks: { p0: 7, p1: 2, p2: 1 }, winner: "p0", settings: pts }));
    playLastTrick(h2, "p0");
    expect(h2.state.totals).toEqual({ p0: 2, p1: -1, p2: -1 });
    expect(h2.state.phase).toBe("handEnd");
    expect(h2.match.over).toBe(false);
  });

  it("points mode: a large negative total never triggers the end", () => {
    const s = { endRule: "points", targetPoints: 2, hands: 30 } as const;
    const h = harness(s);
    h.setState(lastTrickState({ hand: 1, finalTricks: { p0: 3, p1: 4, p2: 3 }, winner: "p0", settings: s }));
    playLastTrick(h, "p0");
    expect(h.state.totals).toEqual({ p0: -2, p1: 1, p2: 1 });
    expect(h.state.phase).toBe("handEnd");
  });

  it("points mode: `hands` is a cap", () => {
    const s = { endRule: "points", targetPoints: 20, hands: 2 } as const;
    const h = harness(s);
    h.setState(lastTrickState({ hand: 2, finalTricks: { p0: 2, p1: 5, p2: 3 }, winner: "p1", settings: s }));
    playLastTrick(h, "p1");
    expect(h.state.phase).toBe("over");
    expect(h.match.over).toBe(true);
  });
});

describe("teendopaanch: hidden information across a whole game", () => {
  it.each([
    [1, {}],
    [2, {}],
    [3, { trumpCallAfter: "all" }],
    [4, { removedSevens: "spadesClubs", hands: 4 }],
    [5, { pullRule: "off", hands: 3 }],
  ] as [number, Partial<Settings>][])("seed %i %j: rules hold and nothing leaks at any step", (seed, settings) => {
    const h = harness({ hands: 6, ...settings }, seed);
    const { pulls } = driveAndCheck(h, seed);
    expect(h.state.phase).toBe("over");
    expect(h.state.history).toHaveLength(h.state.settings.hands);
    if (h.state.settings.pullRule === "off") expect(pulls).toBe(0);
  });

  it("random games with default settings do include exchanges", () => {
    let total = 0;
    for (const seed of [7, 8, 9]) total += driveAndCheck(harness({}, seed), seed).pulls;
    expect(total).toBeGreaterThan(0);
  });

  it("trump phase: no one sees any second batch, spectator sees no cards", () => {
    const h = harness({}, 31);
    const st = h.state;
    const allSecond = ORDER.flatMap((p) => st.secondBatch[p]);
    for (const v of VIEWERS) {
      expect(findLeaks(h.view(v), allSecond)).toEqual([]);
      expect(findLeaks(h.envelope(v), allSecond)).toEqual([]);
      if (v) expect(findLeaks(h.legal(v), allSecond)).toEqual([]);
    }
    const all = ORDER.flatMap((p) => st.hands[p]);
    expect(findLeaks(h.view(null), all)).toEqual([]);
    expect(h.view(null).myHand).toEqual([]);
    expect(h.view(null).awaitingSecondBatch).toBe(true);
  });
});

describe("teendopaanch: determinism and purity", () => {
  it("the same seed and actions give the same states", () => {
    const run = () => {
      const h = harness({}, 77);
      driveAndCheck(h, 77);
      return h.state;
    };
    expect(run()).toEqual(run());
  });

  it("simulateGame is reproducible", () => {
    const a = simulateGame(plugin, { players: 3, seed: 5 });
    const b = simulateGame(plugin, { players: 3, seed: 5 });
    expect(a.log).toEqual(b.log);
    expect(a.match.state).toEqual(b.match.state);
  });

  it("setup state and views are JSON-safe", () => {
    const h = harness();
    assertJsonSafe(h.state);
    for (const v of VIEWERS) assertJsonSafe(h.view(v));
  });
});

describe("teendopaanch: bots", () => {
  const combos: Partial<Settings>[] = [
    {},
    { trumpCallAfter: "all" },
    { pullRule: "off" },
    { endRule: "points", targetPoints: 3, hands: 30 },
    { endRule: "points", targetPoints: 1, hands: 5 },
    { removedSevens: "heartsDiamonds" },
    { removedSevens: "spadesClubs", trumpCallAfter: "all", pullRule: "off" },
    { hands: 1 },
    { hands: 12 },
  ];
  it.each(combos)("bot games finish: %j", (settings) => {
    for (const seed of [1, 2, 3, 4]) {
      const { match } = simulateGame(plugin, { players: 3, seed, settings });
      const st = match.state as State;
      expect(match.over).toBe(true);
      expect(st.phase).toBe("over");
      expect(st.history.length).toBeGreaterThanOrEqual(1);
      expect(st.history.length).toBeLessThanOrEqual(st.settings.hands);
      if (st.settings.endRule === "hands") expect(st.history).toHaveLength(st.settings.hands);
      else {
        const reached = ORDER.some((p) => st.totals[p] >= st.settings.targetPoints);
        expect(reached || st.history.length === st.settings.hands).toBe(true);
      }
      const totals: Rec = { ...ZERO };
      st.history.forEach((r, i) => {
        const s = seatsFor(i + 1);
        expect(r.hand).toBe(i + 1);
        expect(r.dealer).toBe(s.dealer);
        expect(r.targets).toEqual(s.targets);
        expect(ORDER.reduce((a, p) => a + r.tricks[p], 0)).toBe(10);
        expect(ORDER.reduce((a, p) => a + r.diffs[p], 0)).toBe(0);
        for (const p of ORDER) {
          expect(r.diffs[p]).toBe(r.tricks[p] - r.targets[p]);
          totals[p] += r.diffs[p];
        }
      });
      expect(st.totals).toEqual(totals);
      const scores = plugin.scores(st);
      expect(scores.map((s) => s.playerId).sort()).toEqual(ORDER);
    }
  });

  const bot = (h: H, id: Pid) => plugin.botAction!(h.view(id), h.legal(id), createRng(1)) as Action;

  it("defines a bot policy", () => {
    expect(typeof plugin.botAction).toBe("function");
  });

  it("trump: longest suit; tie broken by higher total rank", () => {
    const h = harness();
    const base = { phase: "trump" as const, trump: null, turn: null };
    h.setState(
      mk({
        ...base,
        hands: { p0: ["AH", "9S", "8S", "TS", "QD"], p1: ["KS", "JS", "QS", "7S", "AS"], p2: ["KH", "QH", "JH", "TH", "9H"] },
        secondBatch: { p0: ["8H", "7H", "AD", "KD", "JD"], p1: ["TD", "9D", "8D", "AC", "KC"], p2: ["QC", "JC", "TC", "9C", "8C"] },
      }),
    );
    expect(bot(h, "p0")).toEqual({ type: "trump", suit: "S" });
    h.setState(
      mk({
        ...base,
        hands: { p0: ["AH", "KH", "9S", "8S", "QD"], p1: ["KS", "JS", "QS", "7S", "AS"], p2: ["QH", "JH", "TH", "9H", "8H"] },
        secondBatch: { p0: ["TS", "7H", "AD", "KD", "JD"], p1: ["TD", "9D", "8D", "AC", "KC"], p2: ["QC", "JC", "TC", "9C", "8C"] },
      }),
    );
    expect(bot(h, "p0")).toEqual({ type: "trump", suit: "H" });
  });

  it("pull: gives the lowest non-trump card", () => {
    const h = harness();
    h.setState(exchangeState([{ puller: "p0", victim: "p1" }], { p0: 1, p1: -1, p2: 0 })); // trump D
    // p0: 7S KH QH JH TH 9D 8D AC KC QC -> lowest non-trump is 7S
    expect(bot(h, "p0")).toEqual({ type: "pull", card: "7S" });
  });

  it("play: leads an Ace if it is the highest card, else lowest of longest non-trump suit", () => {
    const h = harness();
    const st = (p0: Card[]) =>
      mk({
        trump: "H",
        hands: { p0, p1: ["7S", "QD", "JD", "TD", "9D"], p2: ["8D", "JC", "TC", "9C", "8C"] },
        tricksWon: { p0: 2, p1: 2, p2: 1 },
      });
    h.setState(st(["AD", "8S", "9S", "TS", "KH"]));
    expect(bot(h, "p0")).toEqual({ type: "play", card: "AD" });
    h.setState(st(["KD", "8S", "9S", "TS", "KH"]));
    expect(bot(h, "p0")).toEqual({ type: "play", card: "8S" });
  });

  it("play: follows with the lowest winning card, else lowest legal preferring non-trump", () => {
    const h = harness();
    const st = (p1: Card[], trick: { playerId: string; card: Card }[] = [{ playerId: "p0", card: "KS" }]) =>
      mk({
        trump: "H",
        hands: { p0: ["8D", "7S", "JD"], p1, p2: ["8C", "9C", "TC", "JC"] },
        trick,
        leader: "p0",
        turn: "p1",
        tricksWon: { p0: 3, p1: 2, p2: 1 },
      });
    h.setState(st(["AS", "QS", "8S", "9H"]));
    expect(bot(h, "p1")).toEqual({ type: "play", card: "AS" });
    h.setState(st(["QS", "8S", "9H", "AD"]));
    expect(bot(h, "p1")).toEqual({ type: "play", card: "8S" });
    h.setState(st(["9D", "8H", "AC", "TH"]));
    expect(bot(h, "p1")).toEqual({ type: "play", card: "8H" });
    // p0 led KS, p2... use p2 as follower after a high trump
    h.setState(
      mk({
        trump: "H",
        hands: { p0: ["9S", "8S"], p1: ["QS", "JS"], p2: ["8H", "9D", "TC"] },
        trick: [
          { playerId: "p0", card: "KS" },
          { playerId: "p1", card: "AH" },
        ],
        leader: "p0",
        turn: "p2",
        tricksWon: { p0: 3, p1: 2, p2: 2 },
      }),
    );
    expect(bot(h, "p2")).toEqual({ type: "play", card: "9D" });
  });
});
