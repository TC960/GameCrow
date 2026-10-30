/**
 * Raja Mantri Chor Sipahi — rules tests.
 * Written from SPEC.md, ENGINE_CONTRACT.md, games/rajamantri/BRIEF.md and games/rajamantri/types.ts
 * (not from rules.ts).
 */
import { describe, expect, it } from "vitest";
import plugin from "../games/rajamantri/rules";
import { startMatch } from "../engine/match";
import { assertJsonSafe, createHarness, deepFreeze, findLeaks, makePlayers, simulateGame } from "../engine/testing";
import type { Harness } from "../engine/testing";
import type { PlayerId, SettingsValues } from "../engine/types";
import {
  DEFAULT_ROLE_POINTS,
  EXTRA_ROLES,
  ROLE_EMOJI,
  ROLE_NAMES,
  ROLE_ORDER,
  ROLE_POINTS_KEY,
  type Action,
  type Role,
  type RoundResult,
  type Settings,
  type State,
  type View,
} from "../games/rajamantri/types";

type H = Harness<State, Action, View>;

const DEFAULTS: Settings = {
  rounds: 5,
  guesser: "mantri",
  revealRaja: true,
  wrongGuess: "swap",
  guessSeconds: 90,
  pointsRaja: 1000,
  pointsMantri: 800,
  pointsSipahi: 500,
  pointsChor: 0,
  pointsRani: 900,
  pointsSainik: 300,
  pointsDaku: 100,
  pointsPandit: 600,
};

function harness(players = 4, settings: Partial<Settings> = {}, seed = 1): H {
  return createHarness<State, Action, View>(plugin, { players, settings: settings as Partial<SettingsValues>, seed });
}

const ids = (n: number): PlayerId[] => makePlayers(n).map((p) => p.id);
const sortedJson = (xs: unknown[]): string[] => xs.map((x) => JSON.stringify(x)).sort();
const holderOf = (roles: Record<PlayerId, Role>, role: Role): PlayerId | undefined =>
  Object.keys(roles).find((p) => roles[p] === role);

/** Put the current round in "guess" with exactly these roles (by seat). Keeps history/totals. */
function craft(h: H, roles: Role[], extra: Partial<State> = {}): void {
  const s = h.state;
  const map: Record<PlayerId, Role> = {};
  s.order.forEach((p, i) => (map[p] = roles[i]));
  const guesser = holderOf(map, s.settings.guesser)!;
  const raja = holderOf(map, "raja")!;
  h.setState({ ...s, phase: "guess", roles: map, guesser, raja, ...extra });
}

/** Players whose role is publicly hidden during "guess" according to the brief. */
function expectedHidden(s: State): PlayerId[] {
  return s.order.filter((p) => p !== s.guesser && !(s.settings.revealRaja && p === s.raja));
}

function guessTargets(legal: Action[]): PlayerId[] {
  return legal.filter((a): a is Extract<Action, { type: "guess" }> => a.type === "guess").map((a) => a.target);
}

function pointsOf(s: Settings, role: Role): number {
  return s[ROLE_POINTS_KEY[role]];
}

/** Expected points for one round, computed independently from the brief. */
function expectedRoundPoints(s: Settings, r: RoundResult): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const p of Object.keys(r.roles)) out[p] = pointsOf(s, r.roles[p]);
  if (!r.correct) {
    const guesserPts = pointsOf(s, r.roles[r.guesser]);
    out[r.guesser] = 0;
    out[r.chor] = s.wrongGuess === "swap" ? guesserPts : pointsOf(s, "chor");
  }
  return out;
}

/** Every state that differs only in the roles of players `viewer` can't see (pairwise swaps). */
function indistinguishableVariants(s: State, viewer: PlayerId | null): State[] {
  const visible = new Set<PlayerId>([s.guesser]);
  if (s.settings.revealRaja) visible.add(s.raja);
  if (viewer) visible.add(viewer);
  const others = s.order.filter((p) => !visible.has(p));
  const out: State[] = [];
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const a = others[i], b = others[j];
      const roles = { ...s.roles, [a]: s.roles[b], [b]: s.roles[a] };
      const raja = holderOf(roles, "raja")!;
      out.push(deepFreeze({ ...s, roles, raja }));
    }
  }
  return out;
}

/** Non-interference: the viewer's view and legal actions do not depend on roles they cannot see. */
function expectNoHiddenRoleDependence(s: State, viewer: PlayerId | null, host: PlayerId = "p0"): void {
  const baseView = plugin.viewFor(s, viewer);
  const baseLegal = viewer ? sortedJson(plugin.legalActions(s, { id: viewer, isHost: viewer === host })) : [];
  for (const v of indistinguishableVariants(s, viewer)) {
    expect(plugin.viewFor(v, viewer), `view of ${viewer} depends on hidden roles`).toEqual(baseView);
    if (viewer) {
      expect(sortedJson(plugin.legalActions(v, { id: viewer, isHost: viewer === host })), `legal of ${viewer}`).toEqual(baseLegal);
    }
  }
}

/** Run a guess phase the "obvious" way and return the round result. */
function guessAndGet(h: H, target: PlayerId): RoundResult {
  h.act(h.state.guesser, { type: "guess", target });
  const last = h.state.history[h.state.history.length - 1];
  return last;
}

// ---------------------------------------------------------------------------

describe("meta and settings schema", () => {
  it("has the right id and player range", () => {
    expect(plugin.meta.id).toBe("rajamantri");
    expect(plugin.meta.minPlayers).toBe(4);
    expect(plugin.meta.maxPlayers).toBe(8);
    expect(() => startMatch(plugin, makePlayers(3), {}, 1, 0)).toThrow();
    expect(() => startMatch(plugin, makePlayers(9), {}, 1, 0)).toThrow();
  });

  it("declares every house rule with the brief's defaults", () => {
    const byKey = Object.fromEntries(plugin.settings.map((f) => [f.key, f]));
    expect(byKey.rounds).toMatchObject({ type: "number", default: 5, min: 1, max: 20 });
    expect(byKey.guesser).toMatchObject({ type: "select", default: "mantri" });
    expect((byKey.guesser as { options: { value: string }[] }).options.map((o) => o.value).sort()).toEqual(["mantri", "sipahi"]);
    expect(byKey.revealRaja).toMatchObject({ type: "boolean", default: true });
    expect(byKey.wrongGuess).toMatchObject({ type: "select", default: "swap" });
    expect((byKey.wrongGuess as { options: { value: string }[] }).options.map((o) => o.value).sort()).toEqual(["swap", "zero"]);
    expect(byKey.guessSeconds).toMatchObject({ type: "number", default: 90, min: 0, max: 300, step: 15 });
    for (const role of ROLE_ORDER) {
      expect(byKey[ROLE_POINTS_KEY[role]], role).toMatchObject({ type: "number", default: DEFAULT_ROLE_POINTS[role] });
    }
  });

  it("resolves defaults into state and view", () => {
    const h = harness(4);
    expect(h.state.settings).toEqual(DEFAULTS);
    expect(h.view("p0").settings).toEqual(DEFAULTS);
  });

  it("clamps rounds to 1..20", () => {
    expect(harness(4, { rounds: 0 }).state.settings.rounds).toBe(1);
    expect(harness(4, { rounds: 99 }).state.settings.rounds).toBe(20);
    expect(harness(4, { rounds: 99 }).view("p1").totalRounds).toBe(20);
  });
});

describe("setup", () => {
  it.each([4, 5, 6, 7, 8])("deals exactly the first %i roles of ROLE_ORDER, one per player", (n) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = harness(n, {}, seed);
      const s = h.state;
      expect(s.order).toEqual(ids(n));
      expect(Object.keys(s.roles).sort()).toEqual(ids(n).sort());
      expect(Object.values(s.roles).sort()).toEqual(ROLE_ORDER.slice(0, n).slice().sort());
      expect(s.phase).toBe("guess");
      expect(s.round).toBe(1);
      expect(s.history).toEqual([]);
      expect(s.guessDeadline).toBe(h.now + 90_000);
      expect(s.totals).toEqual(Object.fromEntries(ids(n).map((p) => [p, 0])));
      expect(s.guesser).toBe(holderOf(s.roles, "mantri"));
      expect(s.raja).toBe(holderOf(s.roles, "raja"));
    }
  });

  it("adds extra roles in the order Rani, Sainik, Daku, Pandit", () => {
    expect(EXTRA_ROLES).toEqual(["rani", "sainik", "daku", "pandit"]);
    for (let n = 4; n <= 8; n++) {
      const inPlay = new Set(Object.values(harness(n).state.roles));
      EXTRA_ROLES.forEach((r, i) => expect(inPlay.has(r), `${r} with ${n} players`).toBe(i < n - 4));
    }
  });

  it.each([4, 5, 6, 7, 8])("roleTable lists the %i roles in play with default points", (n) => {
    const v = harness(n).view("p1");
    expect(v.roleTable).toEqual(
      ROLE_ORDER.slice(0, n).map((role) => ({ role, name: ROLE_NAMES[role], emoji: ROLE_EMOJI[role], points: DEFAULT_ROLE_POINTS[role] })),
    );
  });

  it("roleTable uses configured points", () => {
    const pts = { pointsRaja: 2000, pointsMantri: 1500, pointsSipahi: 250, pointsChor: 50, pointsRani: 1200, pointsSainik: 400, pointsDaku: 150, pointsPandit: 700 };
    const v = harness(8, pts).view(null);
    expect(v.roleTable.map((r) => [r.role, r.points])).toEqual(ROLE_ORDER.map((r) => [r, pts[ROLE_POINTS_KEY[r]]]));
  });

  it("shuffles roles between seeds (deal is random, not by seat)", () => {
    const rajas = new Set<string>();
    const guessers = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = harness(4, {}, seed).state;
      rajas.add(s.raja);
      guessers.add(s.guesser);
    }
    expect(rajas.size).toBeGreaterThan(1);
    expect(guessers.size).toBeGreaterThan(1);
  });

  it("with guesser=sipahi the Sipahi holder guesses", () => {
    for (const seed of [1, 2, 3]) {
      const h = harness(5, { guesser: "sipahi" }, seed);
      expect(h.state.guesser).toBe(holderOf(h.state.roles, "sipahi"));
      const v = h.view(null);
      expect(v.guesser).toBe(h.state.guesser);
      expect(v.guesserRole).toBe("sipahi");
      expect(v.roles[h.state.guesser]).toBe("sipahi");
    }
  });

  it("initial view basics", () => {
    const h = harness(4, { rounds: 3 });
    for (const p of [...ids(4), null]) {
      const v = h.view(p);
      expect(v.phase).toBe("guess");
      expect(v.round).toBe(1);
      expect(v.totalRounds).toBe(3);
      expect(v.isLastRound).toBe(false);
      expect(v.lastResult).toBeNull();
      expect(v.history).toEqual([]);
      expect(v.guessDeadline).toBe(h.state.guessDeadline);
      expect(v.guesser).toBe(h.state.guesser);
      expect(v.guesserRole).toBe("mantri");
      expect(v.amGuesser).toBe(p === h.state.guesser);
      expect(v.myRole).toBe(p ? h.state.roles[p] : null);
      expect(v.totals).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
      assertJsonSafe(v, `view ${p}`);
      assertJsonSafe(h.envelope(p), `envelope ${p}`);
    }
    expect(plugin.scores(h.state).every((l) => l.rank === 1 && l.score === 0)).toBe(true);
    expect(plugin.scores(h.state)).toHaveLength(4);
    expect(plugin.isOver(h.state)).toBe(false);
  });
});

describe("guess phase: visibility and legal actions", () => {
  it("Raja and guesser are public (revealRaja on), everyone else hidden", () => {
    const h = harness(6);
    craft(h, ["chor", "raja", "rani", "mantri", "sainik", "sipahi"]);
    // guesser p3 (mantri), raja p1
    const expectedTargets = ["p0", "p2", "p4", "p5"];
    for (const p of [...ids(6), null]) {
      const v = h.view(p);
      expect(v.raja).toBe("p1");
      expect(v.guesser).toBe("p3");
      expect(v.hiddenPlayers.slice().sort()).toEqual(expectedTargets);
      for (const q of ids(6)) {
        const visible = q === "p1" || q === "p3" || q === p;
        expect(v.roles[q], `roles[${q}] for viewer ${p}`).toBe(visible ? h.state.roles[q] : null);
      }
    }
    // same hiddenPlayers list for everyone
    const lists = [...ids(6), null].map((p) => JSON.stringify(h.view(p).hiddenPlayers));
    expect(new Set(lists).size).toBe(1);
    expect(plugin.activePlayers(h.state)).toEqual(["p3"]);
  });

  it("revealRaja off hides the Raja from everyone else and makes him a valid target", () => {
    const h = harness(4, { revealRaja: false });
    craft(h, ["sipahi", "raja", "chor", "mantri"]); // guesser p3, raja p1
    for (const p of ["p0", "p2", "p3", null]) {
      const v = h.view(p);
      expect(v.raja).toBeNull();
      expect(v.roles.p1).toBeNull();
      expect(v.hiddenPlayers.slice().sort()).toEqual(["p0", "p1", "p2"]);
    }
    expect(h.view("p1").myRole).toBe("raja");
    expect(h.view("p1").roles.p1).toBe("raja");
    expect(guessTargets(h.legal("p3")).sort()).toEqual(["p0", "p1", "p2"]);
  });

  it("only the guesser may guess, and only hidden players are valid targets (all of them)", () => {
    const h = harness(5);
    craft(h, ["mantri", "chor", "raja", "rani", "sipahi"]); // guesser p0 (host), raja p2
    const legal = h.legal("p0");
    expect(legal.every((a) => a.type === "guess")).toBe(true);
    expect(sortedJson(legal)).toEqual(sortedJson(["p1", "p3", "p4"].map((target) => ({ type: "guess", target }))));
    for (const p of ["p1", "p2", "p3", "p4"]) {
      expect(guessTargets(h.legal(p))).toEqual([]);
      expect(h.tryAct(p, { type: "guess", target: "p1" })).not.toBeNull();
    }
    expect(h.tryAct("p0", { type: "guess", target: "p0" })).not.toBeNull(); // self
    expect(h.tryAct("p0", { type: "guess", target: "p2" })).not.toBeNull(); // revealed Raja
    expect(h.tryAct("p0", { type: "guess", target: "p9" })).not.toBeNull(); // not seated
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull(); // wrong phase
    expect(h.state.phase).toBe("guess");
  });

  it("guess targets are the same whoever the Chor is (no filtering)", () => {
    const h = harness(4);
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    const a = guessTargets(h.legal("p1")).sort();
    craft(h, ["raja", "mantri", "chor", "sipahi"]);
    const b = guessTargets(h.legal("p1")).sort();
    expect(a).toEqual(["p2", "p3"]);
    expect(b).toEqual(a);
  });

  it("spectators and strangers cannot act", () => {
    const h = harness(4);
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    expect(h.tryAct("p99", { type: "guess", target: "p3" })).not.toBeNull();
    expect(plugin.legalActions(h.state, { id: "p99", isHost: false })).toEqual([]);
    expect(h.envelope(null).legal).toEqual([]);
  });

  it("only the guesser has actions during the guess (the host included, whatever their role)", () => {
    const h = harness(4);
    craft(h, ["raja", "mantri", "sipahi", "chor"]); // guesser p1, host p0
    for (const p of ["p0", "p2", "p3"]) expect(h.legal(p), p).toEqual([]);
    expect(h.tryAct("p0", { type: "guess", target: "p3" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "@timeout" })).not.toBeNull();
    for (const roles of [["sipahi", "mantri", "raja", "chor"], ["chor", "mantri", "sipahi", "raja"]] as Role[][]) {
      craft(h, roles);
      expect(h.legal("p0")).toEqual([]);
    }
  });
});

describe("guess timer (guessSeconds)", () => {
  it("guessSeconds 0: no deadline and nothing ever fires", () => {
    const h = harness(4, { guessSeconds: 0 });
    expect(h.state.guessDeadline).toBeNull();
    expect(plugin.deadline!(h.state)).toBeNull();
    for (const p of [...ids(4), null]) {
      expect(h.envelope(p).deadline).toBeNull();
      expect(h.view(p).guessDeadline).toBeNull();
    }
    expect(h.advanceTime(24 * 3600_000)).toBe(false);
    expect(h.state.phase).toBe("guess");
  });

  it("sets the deadline from the deal time, snapped to 15s steps", () => {
    const h = harness(4, { guessSeconds: 30 });
    expect(h.state.guessDeadline).toBe(h.now + 30_000);
    expect(plugin.deadline!(h.state)).toBe(h.now + 30_000);
    for (const p of [...ids(4), null]) expect(h.envelope(p).deadline).toBe(h.now + 30_000);
    expect(harness(4, { guessSeconds: 20 }).state.settings.guessSeconds).toBe(15);
    expect(harness(4, { guessSeconds: 999 }).state.settings.guessSeconds).toBe(300);
  });

  it("nothing fires 1 ms early; at the deadline the round is voided", () => {
    const h = harness(5, { rounds: 3 });
    craft(h, ["raja", "mantri", "sipahi", "chor", "rani"]);
    expect(h.advanceTime(89_999)).toBe(false);
    expect(h.state.phase).toBe("guess");
    expect(h.advanceTime(1)).toBe(true);
    const s = h.state;
    expect(s.phase).toBe("reveal");
    expect(s.round).toBe(1);
    expect(s.guessDeadline).toBeNull();
    expect(plugin.deadline!(s)).toBeNull();
    expect(s.history).toHaveLength(1);
    const r = s.history[0];
    expect(r).toEqual({
      round: 1,
      roles: { p0: "raja", p1: "mantri", p2: "sipahi", p3: "chor", p4: "rani" },
      guesser: "p1",
      accused: null,
      chor: "p3",
      correct: false,
      voided: true,
      points: { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0 },
    });
    expect(s.totals).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0, p4: 0 });
    for (const p of [...ids(5), null]) {
      const v = h.view(p);
      expect(v.roles).toEqual(s.roles);
      expect(v.hiddenPlayers).toEqual([]);
      expect(v.lastResult).toEqual(r);
      expect(v.guessDeadline).toBeNull();
    }
    expect(plugin.activePlayers(s)).toEqual([]);
    expect(h.legal("p1")).toEqual([]);
    expect(h.tryAct("p1", { type: "guess", target: "p3" })).not.toBeNull();
    expect(h.legal("p0")).toEqual([{ type: "nextRound" }]);
  });

  it("a voided round keeps earlier totals and counts as a round; the next deal gets a fresh deadline", () => {
    const h = harness(4, { rounds: 2, guessSeconds: 15 });
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    h.act("p1", { type: "guess", target: "p3" }); // correct
    expect(h.state.totals).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });
    expect(h.advanceTime(10 * 60_000)).toBe(false); // no timer outside the guess
    h.act("p0", { type: "nextRound" });
    expect(h.state.round).toBe(2);
    expect(h.state.guessDeadline).toBe(h.now + 15_000);
    expect(h.advanceTime(15_000)).toBe(true);
    expect(h.state.totals).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });
    expect(h.state.history.map((x) => x.voided)).toEqual([false, true]);
    expect(h.view("p2").isLastRound).toBe(true);
    h.act("p0", { type: "nextRound" });
    expect(h.match.over).toBe(true);
    expect(plugin.scores(h.state).map((l) => [l.playerId, l.score, l.rank])).toEqual([
      ["p0", 1000, 1],
      ["p1", 800, 2],
      ["p2", 500, 3],
      ["p3", 0, 4],
    ]);
  });

  it("a guess in time clears the deadline", () => {
    const h = harness(4);
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    h.advanceTime(89_000);
    h.act("p1", { type: "guess", target: "p2" });
    expect(h.state.guessDeadline).toBeNull();
    expect(h.advanceTime(60_000)).toBe(false);
    expect(h.state.history[0].voided).toBe(false);
  });

  it("the host gains nothing from a timeout, whatever their role", () => {
    for (const role of ["raja", "sipahi", "chor"] as Role[]) {
      const h = harness(4);
      const rest = (["raja", "sipahi", "chor"] as Role[]).filter((r) => r !== role);
      craft(h, [role, "mantri", ...rest]);
      h.advanceTime(90_000);
      expect(h.state.history[0].points.p0).toBe(0);
      expect(h.state.totals.p0).toBe(0);
    }
  });
});

describe("scoring", () => {
  const roles4: Role[] = ["raja", "mantri", "sipahi", "chor"]; // guesser (mantri) p1, chor p3

  it("correct guess: everyone gets their role's points", () => {
    const h = harness(4);
    craft(h, roles4);
    const r = guessAndGet(h, "p3");
    expect(r).toMatchObject({ round: 1, guesser: "p1", accused: "p3", chor: "p3", correct: true });
    expect(r.roles).toEqual({ p0: "raja", p1: "mantri", p2: "sipahi", p3: "chor" });
    expect(r.points).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });
    expect(h.state.totals).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });
  });

  it("wrong guess, swap (default): Chor takes the guesser's points, guesser gets 0", () => {
    const h = harness(4);
    craft(h, roles4);
    const r = guessAndGet(h, "p2");
    expect(r).toMatchObject({ guesser: "p1", accused: "p2", chor: "p3", correct: false });
    expect(r.points).toEqual({ p0: 1000, p1: 0, p2: 500, p3: 800 });
    expect(h.state.totals).toEqual({ p0: 1000, p1: 0, p2: 500, p3: 800 });
  });

  it("wrong guess, zero: guesser gets 0 and Chor gets the Chor's points", () => {
    const h = harness(4, { wrongGuess: "zero" });
    craft(h, roles4);
    expect(guessAndGet(h, "p2").points).toEqual({ p0: 1000, p1: 0, p2: 500, p3: 0 });
  });

  it("non-zero Chor points: correct -> Chor points; swap -> guesser's points; zero -> Chor points", () => {
    const pts = { pointsChor: 100 };
    let h = harness(4, pts);
    craft(h, roles4);
    expect(guessAndGet(h, "p3").points).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 100 });
    h = harness(4, pts);
    craft(h, roles4);
    expect(guessAndGet(h, "p2").points).toEqual({ p0: 1000, p1: 0, p2: 500, p3: 800 });
    h = harness(4, { ...pts, wrongGuess: "zero" });
    craft(h, roles4);
    expect(guessAndGet(h, "p2").points).toEqual({ p0: 1000, p1: 0, p2: 500, p3: 100 });
  });

  it("guesser=sipahi: correct and wrong (swap and zero)", () => {
    let h = harness(4, { guesser: "sipahi" });
    craft(h, roles4); // guesser p2 (sipahi), hidden p1, p3
    expect(h.state.guesser).toBe("p2");
    expect(guessTargets(h.legal("p2")).sort()).toEqual(["p1", "p3"]);
    expect(guessAndGet(h, "p3").points).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });

    h = harness(4, { guesser: "sipahi" });
    craft(h, roles4);
    const r = guessAndGet(h, "p1");
    expect(r).toMatchObject({ guesser: "p2", accused: "p1", chor: "p3", correct: false });
    expect(r.points).toEqual({ p0: 1000, p1: 800, p2: 0, p3: 500 });

    h = harness(4, { guesser: "sipahi", wrongGuess: "zero" });
    craft(h, roles4);
    expect(guessAndGet(h, "p1").points).toEqual({ p0: 1000, p1: 800, p2: 0, p3: 0 });
  });

  it("revealRaja off: accusing the Raja is a wrong guess and the Raja keeps his points", () => {
    const h = harness(4, { revealRaja: false });
    craft(h, roles4);
    const r = guessAndGet(h, "p0");
    expect(r.correct).toBe(false);
    expect(r.points).toEqual({ p0: 1000, p1: 0, p2: 500, p3: 800 });
  });

  it("8 players: extra roles are bystanders scoring their own points", () => {
    const roles8: Role[] = ["chor", "pandit", "raja", "daku", "mantri", "sainik", "rani", "sipahi"];
    let h = harness(8);
    craft(h, roles8); // guesser p4, raja p2, chor p0
    expect(guessTargets(h.legal("p4")).sort()).toEqual(["p0", "p1", "p3", "p5", "p6", "p7"]);
    expect(guessAndGet(h, "p0").points).toEqual({ p0: 0, p1: 600, p2: 1000, p3: 100, p4: 800, p5: 300, p6: 900, p7: 500 });

    h = harness(8);
    craft(h, roles8);
    const r = guessAndGet(h, "p6");
    expect(r.correct).toBe(false);
    expect(r.points).toEqual({ p0: 800, p1: 600, p2: 1000, p3: 100, p4: 0, p5: 300, p6: 900, p7: 500 });
  });

  it("custom points for every role are used", () => {
    const pts = { pointsRaja: 2000, pointsMantri: 1500, pointsSipahi: 250, pointsChor: 50, pointsRani: 1200, pointsSainik: 400, pointsDaku: 150, pointsPandit: 700 };
    const roles8: Role[] = ["sipahi", "rani", "mantri", "chor", "pandit", "raja", "daku", "sainik"];
    let h = harness(8, pts);
    craft(h, roles8); // guesser p2, chor p3
    expect(guessAndGet(h, "p3").points).toEqual({ p0: 250, p1: 1200, p2: 1500, p3: 50, p4: 700, p5: 2000, p6: 150, p7: 400 });
    h = harness(8, pts);
    craft(h, roles8);
    expect(guessAndGet(h, "p4").points).toEqual({ p0: 250, p1: 1200, p2: 0, p3: 1500, p4: 700, p5: 2000, p6: 150, p7: 400 });
  });
});

describe("reveal phase", () => {
  it("shows every role and the round's points; only the host can continue", () => {
    const h = harness(5, { rounds: 3 });
    craft(h, ["raja", "chor", "sipahi", "mantri", "rani"]); // guesser p3
    h.act("p3", { type: "guess", target: "p4" });
    const s = h.state;
    expect(s.phase).toBe("reveal");
    expect(s.history).toHaveLength(1);
    for (const p of [...ids(5), null]) {
      const v = h.view(p);
      expect(v.phase).toBe("reveal");
      expect(v.roles).toEqual(s.roles);
      expect(v.hiddenPlayers).toEqual([]);
      expect(v.raja).toBe("p0");
      expect(v.lastResult).toEqual(s.history[0]);
      expect(v.history).toEqual(s.history);
      expect(v.totals).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0, p4: 900 });
    }
    expect(plugin.activePlayers(s)).toEqual([]);
    expect(h.legal("p0")).toEqual([{ type: "nextRound" }]);
    for (const p of ["p1", "p2", "p3", "p4"]) {
      expect(h.legal(p)).toEqual([]);
      expect(h.tryAct(p, { type: "nextRound" })).not.toBeNull();
    }
    expect(h.tryAct("p3", { type: "guess", target: "p1" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "@timeout" })).not.toBeNull();
  });

  it("revealRaja off: the Raja becomes public after the guess", () => {
    const h = harness(4, { revealRaja: false });
    craft(h, ["sipahi", "raja", "chor", "mantri"]);
    h.act("p3", { type: "guess", target: "p2" });
    expect(h.view("p0").raja).toBe("p1");
    expect(h.view(null).raja).toBe("p1");
    expect(h.view(null).roles.p1).toBe("raja");
  });

  it("nextRound deals a fresh round and keeps totals and history", () => {
    const h = harness(4, { rounds: 3 });
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    h.act("p1", { type: "guess", target: "p3" });
    h.act("p0", { type: "nextRound" });
    const s = h.state;
    expect(s.phase).toBe("guess");
    expect(s.round).toBe(2);
    expect(s.history).toHaveLength(1);
    expect(s.totals).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });
    expect(Object.values(s.roles).sort()).toEqual(ROLE_ORDER.slice(0, 4).slice().sort());
    expect(s.guesser).toBe(holderOf(s.roles, "mantri"));
    const v = h.view(null);
    expect(v.lastResult).toBeNull();
    expect(v.history).toHaveLength(1);
    expect(v.round).toBe(2);
    expect(v.hiddenPlayers.slice().sort()).toEqual(expectedHidden(s).sort());
    expect(plugin.isOver(s)).toBe(false);
  });

  it("roles are re-dealt each round (assignments vary over rounds)", () => {
    const h = harness(4, { rounds: 20 });
    const seen = new Set<string>();
    while (!h.match.over) {
      seen.add(JSON.stringify(h.state.roles));
      h.act(h.state.guesser, { type: "guess", target: expectedHidden(h.state)[0] });
      h.act("p0", { type: "nextRound" });
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("cumulative totals, ranks and end of game", () => {
  it("3 scripted rounds add up and rank correctly", () => {
    const h = harness(4, { rounds: 3 });
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    expect(guessAndGet(h, "p3").points).toEqual({ p0: 1000, p1: 800, p2: 500, p3: 0 });
    h.act("p0", { type: "nextRound" });

    craft(h, ["chor", "sipahi", "mantri", "raja"]); // guesser p2, hidden p0 p1
    expect(h.view("p1").isLastRound).toBe(false);
    expect(guessAndGet(h, "p1").points).toEqual({ p0: 800, p1: 500, p2: 0, p3: 1000 });
    h.act("p0", { type: "nextRound" });

    craft(h, ["mantri", "raja", "chor", "sipahi"]); // guesser p0 (host)
    expect(h.state.round).toBe(3);
    expect(h.view("p2").isLastRound).toBe(true);
    expect(guessAndGet(h, "p2").points).toEqual({ p0: 800, p1: 1000, p2: 0, p3: 500 });
    expect(h.state.totals).toEqual({ p0: 2600, p1: 2300, p2: 500, p3: 1500 });
    expect(h.match.over).toBe(false);
    expect(h.state.phase).toBe("reveal");

    h.act("p0", { type: "nextRound" });
    expect(h.state.phase).toBe("over");
    expect(h.match.over).toBe(true);
    expect(plugin.isOver(h.state)).toBe(true);
    expect(h.state.round).toBe(3);
    expect(h.state.history.map((r) => r.round)).toEqual([1, 2, 3]);
    const ranks = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, [l.score, l.rank]]));
    expect(ranks).toEqual({ p0: [2600, 1], p1: [2300, 2], p3: [1500, 3], p2: [500, 4] });
  });

  it("ties share a rank", () => {
    const h = harness(4, { rounds: 2 });
    craft(h, ["raja", "mantri", "sipahi", "chor"]);
    guessAndGet(h, "p3");
    // mid-game standings are live
    const mid = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, l.rank]));
    expect(mid).toEqual({ p0: 1, p1: 2, p2: 3, p3: 4 });
    h.act("p0", { type: "nextRound" });
    craft(h, ["mantri", "raja", "chor", "sipahi"]);
    guessAndGet(h, "p2");
    h.act("p0", { type: "nextRound" });
    expect(h.match.over).toBe(true);
    expect(h.state.totals).toEqual({ p0: 1800, p1: 1800, p2: 500, p3: 500 });
    const ranks = Object.fromEntries(plugin.scores(h.state).map((l) => [l.playerId, l.rank]));
    expect(ranks).toEqual({ p0: 1, p1: 1, p2: 3, p3: 3 });
  });

  it("rounds=1: one guess and the host's nextRound end the game; last round stays visible", () => {
    const h = harness(4, { rounds: 1 });
    expect(h.view("p0").isLastRound).toBe(true);
    craft(h, ["sipahi", "chor", "mantri", "raja"]); // guesser p2
    h.act("p2", { type: "guess", target: "p1" });
    expect(h.match.over).toBe(false);
    h.act("p0", { type: "nextRound" });
    expect(h.match.over).toBe(true);
    for (const p of [...ids(4), null]) {
      const v = h.view(p);
      expect(v.phase).toBe("over");
      expect(v.lastResult).toEqual(h.state.history[0]);
      expect(v.roles).toEqual(h.state.roles);
      if (p) expect(h.legal(p)).toEqual([]);
      assertJsonSafe(h.envelope(p), `final envelope ${p}`);
    }
    expect(plugin.activePlayers(h.state)).toEqual([]);
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull();
  });

  it.each([2, 5, 20])("game with rounds=%i ends after exactly that many rounds", (rounds) => {
    const h = harness(5, { rounds }, 7);
    let n = 0;
    while (!h.match.over) {
      expect(h.state.round).toBe(n + 1);
      h.act(h.state.guesser, { type: "guess", target: expectedHidden(h.state)[0] });
      h.act("p0", { type: "nextRound" });
      n++;
      expect(n).toBeLessThanOrEqual(rounds);
    }
    expect(n).toBe(rounds);
    expect(h.state.history).toHaveLength(rounds);
  });
});

describe("viewFor / legal never leak hidden roles", () => {
  const configs: [string, number, Partial<Settings>][] = [
    ["4p default", 4, {}],
    ["6p revealRaja off", 6, { revealRaja: false }],
    ["8p sipahi guesses", 8, { guesser: "sipahi" }],
    ["8p sipahi, no reveal, zero", 8, { guesser: "sipahi", revealRaja: false, wrongGuess: "zero" }],
  ];

  it.each(configs)("%s: no view or legal list depends on roles the viewer can't see (every round)", (_, n, settings) => {
    for (const seed of [1, 2, 3]) {
      const h = harness(n, { ...settings, rounds: 3 }, seed);
      while (!h.match.over) {
        const s = h.state;
        expect(s.phase).toBe("guess");
        for (const viewer of [...ids(n), null]) expectNoHiddenRoleDependence(s, viewer);
        // also with a non-default host
        expectNoHiddenRoleDependence(s, "p2", "p2");
        h.act(s.guesser, { type: "guess", target: expectedHidden(s)[seed % expectedHidden(s).length] });
        // after the guess everything is public; next round re-hides
        h.act("p0", { type: "nextRound" });
      }
    }
  });

  it.each(configs)("%s: round-1 views contain no player->role association for hidden players", (_, n, settings) => {
    for (const seed of [1, 2, 3, 4]) {
      const h = harness(n, settings, seed);
      const s = h.state;
      const publicIds = new Set([s.guesser, ...(s.settings.revealRaja ? [s.raja] : [])]);
      const secretsOf = (p: PlayerId) => [`"${p}":"${s.roles[p]}"`, `"${s.roles[p]}":"${p}"`];
      for (const viewer of [...ids(n), null]) {
        const secrets = ids(n).filter((p) => p !== viewer && !publicIds.has(p)).flatMap(secretsOf);
        const env = h.envelope(viewer);
        expect(findLeaks(env.view, secrets), `view of ${viewer}`).toEqual([]);
        expect(findLeaks(env.legal, secrets), `legal of ${viewer}`).toEqual([]);
        expect(findLeaks(env.active, secrets)).toEqual([]);
        expect(findLeaks(env.scores, secrets)).toEqual([]);
        const v = env.view;
        expect(v.lastResult).toBeNull();
        expect(v.history).toEqual([]);
        for (const p of ids(n)) {
          const visible = publicIds.has(p) || p === viewer;
          expect(v.roles[p], `roles[${p}] for ${viewer}`).toBe(visible ? s.roles[p] : null);
        }
        if (!s.settings.revealRaja && viewer !== s.raja) expect(v.raja).toBeNull();
      }
    }
  });

  it("spectator sees only public roles and has no myRole", () => {
    const h = harness(7, {}, 4);
    const v = h.view(null);
    expect(v.myRole).toBeNull();
    expect(v.amGuesser).toBe(false);
    const nonNull = Object.entries(v.roles).filter(([, r]) => r !== null).map(([p]) => p).sort();
    expect(nonNull).toEqual([h.state.guesser, h.state.raja].sort());
    expect(Object.keys(v.roles).sort()).toEqual(ids(7).sort());
  });

  it("after a voided round the next deal is hidden again", () => {
    const h = harness(6, { revealRaja: false });
    craft(h, ["raja", "chor", "mantri", "sipahi", "rani", "sainik"]);
    expect(h.advanceTime(90_000)).toBe(true);
    h.act("p0", { type: "nextRound" });
    expect(h.state.phase).toBe("guess");
    for (const viewer of [...ids(6), null]) expectNoHiddenRoleDependence(h.state, viewer);
  });

  it("a non-default host (p2) runs the rounds through the harness", () => {
    const h = createHarness<State, Action, View>(plugin, { players: 4, seed: 5, host: "p2", settings: { rounds: 2 } });
    craft(h, ["raja", "sipahi", "chor", "mantri"]); // guesser p3, host p2
    expect(h.legal("p2")).toEqual([]);
    h.act("p3", { type: "guess", target: "p2" });
    expect(h.legal("p0")).toEqual([]);
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull();
    expect(h.legal("p2")).toEqual([{ type: "nextRound" }]);
    expect(h.envelope("p2").legal).toEqual([{ type: "nextRound" }]);
    h.act("p2", { type: "nextRound" });
    expect(h.state.round).toBe(2);
    expect(h.state.phase).toBe("guess");
    expectNoHiddenRoleDependence(h.state, "p2", "p2");
    h.act(h.state.guesser, { type: "guess", target: expectedHidden(h.state)[0] });
    h.act("p2", { type: "nextRound" });
    expect(h.match.over).toBe(true);
  });
});

describe("determinism and purity", () => {
  it("same seed and moves give the same states; different seeds deal differently", () => {
    const run = (seed: number) => {
      const h = harness(6, { rounds: 4 }, seed);
      const states: State[] = [h.state];
      while (!h.match.over) {
        h.act(h.state.guesser, { type: "guess", target: expectedHidden(h.state)[1] });
        states.push(h.state);
        h.act("p0", { type: "nextRound" });
        states.push(h.state);
      }
      return states;
    };
    expect(run(11)).toEqual(run(11));
    const deals = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(harness(6, {}, seed).state.roles)));
    expect(deals.size).toBeGreaterThan(1);
  });

  it("bot games are reproducible per seed", () => {
    expect(simulateGame(plugin, { players: 5, seed: 42 }).log).toEqual(simulateGame(plugin, { players: 5, seed: 42 }).log);
  });
});

describe("bots", () => {
  const combos: Partial<Settings>[] = [
    {},
    { guesser: "sipahi" },
    { revealRaja: false },
    { wrongGuess: "zero" },
    { guesser: "sipahi", revealRaja: false, wrongGuess: "zero", pointsChor: 250 },
    { rounds: 1 },
    { rounds: 20 },
    { guessSeconds: 0 },
  ];

  it.each([4, 5, 6, 7, 8])("bots finish full games with %i players; every round is scored per the rules", (n) => {
    for (const settings of combos) {
      for (const seed of [1, 2, 3]) {
        const { match } = simulateGame(plugin, { players: n, seed, settings: settings as Partial<SettingsValues> });
        expect(match.over).toBe(true);
        const s = match.state as State;
        const cfg = s.settings;
        expect(s.phase).toBe("over");
        expect(s.history).toHaveLength(cfg.rounds);
        const sums: Record<PlayerId, number> = Object.fromEntries(ids(n).map((p) => [p, 0]));
        s.history.forEach((r, i) => {
          expect(r.round).toBe(i + 1);
          expect(Object.values(r.roles).sort()).toEqual(ROLE_ORDER.slice(0, n).slice().sort());
          expect(r.roles[r.guesser]).toBe(cfg.guesser);
          expect(r.roles[r.chor]).toBe("chor");
          expect(r.voided).toBe(false);
          expect(r.accused).not.toBeNull();
          expect(r.accused).not.toBe(r.guesser);
          if (cfg.revealRaja) expect(r.roles[r.accused!]).not.toBe("raja");
          expect(r.correct).toBe(r.accused === r.chor);
          expect(r.points).toEqual(expectedRoundPoints(cfg, r));
          for (const p of ids(n)) sums[p] += r.points[p];
        });
        expect(s.totals).toEqual(sums);
        const scores = plugin.scores(s);
        expect(scores.map((l) => l.playerId).sort()).toEqual(ids(n).sort());
        for (const l of scores) {
          expect(l.score).toBe(sums[l.playerId]);
          expect(l.rank).toBe(1 + Object.values(sums).filter((x) => x > l.score).length);
        }
      }
    }
  });

  it("bot guessers guess randomly among hidden players (not omniscient)", () => {
    let correct = 0, total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { match } = simulateGame(plugin, { players: 4, seed });
      for (const r of (match.state as State).history) {
        total++;
        if (r.correct) correct++;
      }
    }
    // 2 hidden players with 4 players -> about 50% correct
    expect(correct / total).toBeGreaterThan(0.3);
    expect(correct / total).toBeLessThan(0.7);
  });
});
