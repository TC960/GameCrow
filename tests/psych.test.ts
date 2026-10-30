/**
 * Psych rules tests. Written from SPEC.md, ENGINE_CONTRACT.md, games/psych/BRIEF.md and games/psych/types.ts
 * only (not from rules.ts). Real answers are read from the State, never from prompts.ts.
 */
import { describe, expect, it } from "vitest";
import plugin from "../games/psych/rules";
import {
  assertJsonSafe,
  createHarness,
  findLeaks,
  makePlayers,
  simulateGame,
  type Harness,
  type HarnessOptions,
} from "../engine/testing";
import { defaultSettings } from "../engine/settings";
import type { PlayerId } from "../engine";
import {
  BLANK,
  MAX_ANSWER_LENGTH,
  PACK_IDS,
  PLAYER_PLACEHOLDER,
  type Action,
  type Mode,
  type RoundPrompt,
  type State,
  type View,
} from "../games/psych/types";

type H = Harness<State, Action, View>;

const mk = (opts: HarnessOptions = {}): H => createHarness<State, Action, View>(plugin, { players: 4, ...opts });

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const cur = (h: H): RoundPrompt => h.state.prompts[h.state.round - 1];

/** A trivia prompt with a known real answer, so validation tests don't depend on prompts.ts. */
const TEST_PROMPT: RoundPrompt = {
  text: "The test animal of Testland is the ___",
  answer: "Unicorn",
  alts: ["A unicorn"],
  subject: null,
  truth: "fact",
  source: "general",
};

/** Replace the current round's prompt (only before anyone has answered). */
function withPrompt(h: H, patch: Partial<RoundPrompt>): void {
  const prompts = h.state.prompts.slice();
  prompts[h.state.round - 1] = { ...prompts[h.state.round - 1], ...patch };
  h.setState({ ...h.state, prompts });
}

function answer(h: H, p: PlayerId, text: string) {
  return h.act(p, { type: "answer", text });
}

/** Everyone still answering answers (with `texts[p]` or a distinctive default). */
function answerAll(h: H, texts: Partial<Record<PlayerId, string>> = {}) {
  for (const p of h.state.order) {
    if (h.state.phase !== "answer") return;
    if (h.state.answers[p] !== null) continue;
    answer(h, p, texts[p] ?? `s-${p}-${h.state.round}-x`);
  }
}

function optionId(h: H, viewer: PlayerId | null, text: string): string {
  const o = h.view(viewer).options?.find((x) => x.text === text);
  if (!o) throw new Error(`no option "${text}" in ${JSON.stringify(h.view(viewer).options)}`);
  return o.id;
}

const realOptionId = (h: H) => h.state.options.find((o) => o.isReal)?.id ?? null;

/** Every string (values and keys) inside a JSON value. */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      allStrings(x, out);
    }
  }
  return out;
}
/** Public labels that may legitimately equal a short answer (e.g. the "India" pack label). */
const PUBLIC_LABELS = new Set(["General knowledge", "Animals", "Food & drink", "Science & space", "History", "India", "Custom", "About the players"].map(norm));
/** True when some string in `v` equals `secret` ignoring case/spaces/punctuation. */
function exposes(v: unknown, secret: string): boolean {
  const n = norm(secret);
  return n.length > 0 && !PUBLIC_LABELS.has(n) && allStrings(v).some((s) => norm(s) === n);
}

function blobFor(h: H, viewer: PlayerId | null) {
  return { view: h.view(viewer), envelope: h.envelope(viewer), legal: viewer ? h.legal(viewer) : [] };
}

/** Points a round should give, computed independently from the (revealed) state. */
function expectedRoundPoints(st: State): Record<PlayerId, number> {
  const pts: Record<PlayerId, number> = Object.fromEntries(st.order.map((p) => [p, 0]));
  const { fooledPoints, truthPoints } = st.settings;
  for (const [voter, oid] of Object.entries(st.votes)) {
    if (!oid) continue;
    const o = st.options.find((x) => x.id === oid)!;
    if (o.isReal) pts[voter] += truthPoints;
    else for (const a of o.authors) pts[a] += fooledPoints;
  }
  const prompt = st.prompts[st.round - 1];
  if (prompt.truth === "subject") {
    const real = st.options.find((o) => o.isReal);
    if (real) for (const a of real.authors) if (a !== prompt.subject) pts[a] += truthPoints;
  }
  return pts;
}

/** Nothing secret is visible to anyone (other players, spectator) in the answer and vote phases. */
function assertNoLeaks(h: H, where = "") {
  const st = h.state;
  if (st.phase !== "answer" && st.phase !== "vote") return;
  const prompt = st.prompts[st.round - 1];
  for (const viewer of [...st.order, null]) {
    const tag = `${where} round ${st.round} ${st.phase} viewer ${viewer}`;
    const blob = blobFor(h, viewer);
    const v = blob.view;
    expect(v.reveal, tag).toBeNull();
    const json = JSON.stringify(blob);
    expect(json, tag).not.toContain('"isReal"');
    expect(json, tag).not.toContain('"authors"');
    expect(json, tag).not.toContain(PLAYER_PLACEHOLDER);
    // Future prompts' answers never appear.
    for (const p of st.prompts.slice(st.round)) {
      for (const s of [p.answer, ...p.alts]) {
        if (s && !(st.phase === "vote" && st.options.some((o) => norm(o.text) === norm(s)))) {
          expect(exposes(blob, s), `${tag}: future answer ${s}`).toBe(false);
        }
      }
    }
    for (const val of Object.values(v.answered)) expect(typeof val).toBe("boolean");
    expect(v.myAnswer, tag).toBe(viewer ? st.answers[viewer] ?? null : null);
    if (st.phase === "answer") {
      expect(v.options, tag).toBeNull();
      for (const s of [prompt.answer, ...prompt.alts]) if (s) expect(exposes(blob, s), `${tag}: real answer`).toBe(false);
      const mine = viewer ? st.answers[viewer] : null;
      for (const p of st.order) {
        const a = st.answers[p];
        if (p === viewer || !a || (mine && norm(mine) === norm(a))) continue;
        expect(exposes(blob, a), `${tag}: answer of ${p}`).toBe(false);
        expect(findLeaks(blob, [a]), `${tag}: answer of ${p}`).toEqual([]);
      }
    } else {
      for (const o of v.options!) {
        expect(Object.keys(o).sort(), tag).toEqual(["id", "isMine", "text"]);
        const rec = st.options.find((r) => r.id === o.id)!;
        expect(rec, tag).toBeDefined();
        expect(o.isMine, `${tag}: isMine of ${o.id}`).toBe(viewer !== null && rec.authors.includes(viewer));
      }
      expect(v.myVote, tag).toBe(viewer ? st.votes[viewer] ?? null : null);
      for (const val of Object.values(v.voted)) expect(typeof val).toBe("boolean");
    }
  }
}

/**
 * Plays the whole game through the engine: distinctive answers, deterministic votes, host taps next round.
 * Checks leaks after every action and the scoring of every reveal. Returns the prompt text of each round.
 */
function playGame(h: H, opts: { checkLeaks?: boolean } = {}): string[] {
  const texts: string[] = [];
  let before: Record<PlayerId, number> = { ...h.state.scores };
  let guard = 0;
  let lastRound = 0;
  if (opts.checkLeaks !== false) assertNoLeaks(h, "setup");
  while (!h.match.over) {
    if (guard++ > 5000) throw new Error("playGame: too many steps");
    const st = h.state;
    if (st.round !== lastRound) {
      texts.push(h.view("p0").promptText);
      lastRound = st.round;
    }
    if (st.phase === "answer") {
      const p = st.order.find((id) => st.answers[id] === null)!;
      answer(h, p, `s-${p}-${st.round}-x`);
    } else if (st.phase === "vote") {
      const p = st.voters.find((id) => st.votes[id] === null)!;
      const votes = h.legal(p).filter((a) => a.type === "vote");
      expect(votes.length).toBeGreaterThan(0);
      h.act(p, votes[(st.order.indexOf(p) + st.round) % votes.length]);
    } else if (st.phase === "reveal") {
      const exp = expectedRoundPoints(st);
      const v = h.view("p1");
      expect(v.reveal).not.toBeNull();
      for (const p of st.order) {
        expect(st.scores[p] - before[p], `round ${st.round} delta ${p}`).toBe(exp[p]);
        expect(v.reveal!.roundPoints[p] ?? 0, `round ${st.round} roundPoints ${p}`).toBe(exp[p]);
      }
      expect(v.isLastRound).toBe(st.round === st.settings.rounds);
      before = { ...st.scores };
      h.act(h.host, { type: "nextRound" });
    } else {
      throw new Error(`unexpected phase ${st.phase}`);
    }
    if (opts.checkLeaks !== false) assertNoLeaks(h);
  }
  return texts;
}

// ---------------------------------------------------------------------------

describe("psych: meta and settings", () => {
  it("has the right id, player range and defaults", () => {
    expect(plugin.meta.id).toBe("psych");
    expect(plugin.meta.minPlayers).toBe(3);
    expect(plugin.meta.maxPlayers).toBe(12);
    const d = defaultSettings(plugin.settings);
    expect(d.mode).toBe("trivia");
    expect(d.rounds).toBe(7);
    expect(d.friendsRealAnswer).toBe("none");
    expect(d.answerSeconds).toBe(0);
    expect(d.voteSeconds).toBe(0);
    expect(d.customPrompts).toBe("");
    expect(d.fooledPoints).toBe(1);
    expect(d.truthPoints).toBe(2);
    const rounds = plugin.settings.find((f) => f.key === "rounds");
    expect(rounds).toMatchObject({ type: "number", min: 3, max: 20 });
    expect(plugin.settings.find((f) => f.key === "packs")?.type).toBe("multiselect");
    expect(plugin.settings.find((f) => f.key === "customPrompts")).toMatchObject({ type: "text", multiline: true });
  });

  it("rejects too few / too many players", () => {
    expect(() => mk({ players: 2 })).toThrow();
    expect(() => mk({ players: 13 })).toThrow();
    expect(() => mk({ players: 3 })).not.toThrow();
    expect(() => mk({ players: 12 })).not.toThrow();
  });
});

describe("psych: setup", () => {
  it("starts round 1 in the answer phase with zero scores", () => {
    const h = mk({ players: 4, seed: 3 });
    const st = h.state;
    assertJsonSafe(st);
    expect(st.phase).toBe("answer");
    expect(st.round).toBe(1);
    expect(st.order).toEqual(["p0", "p1", "p2", "p3"]);
    expect(st.scores).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
    expect(Object.values(st.answers).every((a) => a === null)).toBe(true);
    expect(st.prompts).toHaveLength(7);
    expect(st.deadline).toBeNull();
    expect(cur(h).truth).toBe("fact");
    expect(typeof cur(h).answer).toBe("string");
    expect(plugin.activePlayers(st).slice().sort()).toEqual(["p0", "p1", "p2", "p3"]);
    const env = h.envelope("p1");
    expect(env.deadline).toBeNull();
    expect(env.scores).toHaveLength(4);
    expect(env.scores.every((s) => s.score === 0 && s.rank === 1)).toBe(true);
    const v = h.view("p1");
    expect(v).toMatchObject({
      phase: "answer",
      round: 1,
      totalRounds: 7,
      kind: "trivia",
      truth: "fact",
      writeTruth: false,
      iAmSubject: false,
      subject: null,
      answeredCount: 0,
      answerTarget: 4,
      myAnswer: null,
      options: null,
      myVote: null,
      reveal: null,
      isLastRound: false,
    });
    expect(v.rules).toMatchObject({ mode: "trivia", fooledPoints: 1, truthPoints: 2, maxAnswerLength: MAX_ANSWER_LENGTH });
    expect(v.promptText.length).toBeGreaterThan(0);
    expect(v.promptText).toContain(BLANK);
  });

  it("uses the rounds setting (clamped 3..20)", () => {
    expect(mk({ settings: { rounds: 3 } }).state.prompts).toHaveLength(3);
    expect(mk({ settings: { rounds: 2 } }).state.settings.rounds).toBe(3);
    expect(mk({ settings: { rounds: 50 } }).state.settings.rounds).toBe(20);
    expect(mk({ settings: { rounds: 12 } }).view("p0").totalRounds).toBe(12);
  });

  it("only picks trivia prompts from the selected packs", () => {
    const a = mk({ settings: { packs: ["animals"], rounds: 3 }, seed: 4 });
    expect(a.state.prompts.every((p) => p.source === "animals")).toBe(true);
    const b = mk({ settings: { packs: ["food", "india"], rounds: 5 }, seed: 5 });
    expect(b.state.prompts.every((p) => p.source === "food" || p.source === "india")).toBe(true);
    for (const p of [...a.state.prompts, ...b.state.prompts]) {
      expect(p.truth).toBe("fact");
      expect(p.answer && p.answer.trim().length).toBeTruthy();
    }
  });

  it("different seeds choose different prompts; the same seed the same", () => {
    const t = (seed: number) => mk({ seed }).state.prompts.map((p) => p.text);
    expect(t(1)).toEqual(t(1));
    expect(t(1)).not.toEqual(t(2));
  });

  it("never repeats a prompt within a game (every mode, 20 rounds, 12 players)", () => {
    for (const mode of ["trivia", "friends", "mixed"] as Mode[]) {
      for (const seed of [1, 2, 3]) {
        const h = mk({ players: 12, seed, settings: { mode, rounds: 20, packs: PACK_IDS } });
        const texts = h.state.prompts.map((p) => p.text);
        expect(texts, `${mode} seed ${seed}`).toHaveLength(20);
        expect(new Set(texts).size, `${mode} seed ${seed}`).toBe(20);
      }
    }
  });

  it("the shown prompt text is different every round of a played game", () => {
    for (const mode of ["trivia", "friends", "mixed"] as Mode[]) {
      const h = mk({ players: 3, seed: 8, settings: { mode, rounds: 10, packs: PACK_IDS } });
      const texts = playGame(h, { checkLeaks: false });
      expect(texts).toHaveLength(10);
      expect(new Set(texts).size).toBe(10);
      for (const t of texts) {
        expect(t).toContain(BLANK);
        expect(t).not.toContain(PLAYER_PLACEHOLDER);
      }
    }
  });
});

describe("psych: answer phase", () => {
  it("trims answers and records who answered (never what)", () => {
    const h = mk({ seed: 2 });
    withPrompt(h, TEST_PROMPT);
    answer(h, "p1", "   my fake   ");
    expect(h.state.answers.p1).toBe("my fake");
    expect(h.view("p1").myAnswer).toBe("my fake");
    const v0 = h.view("p0");
    expect(v0.answered.p1).toBe(true);
    expect(v0.answered.p0).toBe(false);
    expect(v0.answeredCount).toBe(1);
    expect(v0.myAnswer).toBeNull();
    expect(plugin.activePlayers(h.state)).not.toContain("p1");
    expect(plugin.activePlayers(h.state)).toContain("p0");
  });

  it("rejects empty and whitespace-only answers", () => {
    const h = mk();
    withPrompt(h, TEST_PROMPT);
    expect(h.tryAct("p1", { type: "answer", text: "" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "answer", text: "    " })).not.toBeNull();
    expect(h.tryAct("p1", { type: "answer", text: "\n\t " })).not.toBeNull();
    expect(h.state.answers.p1).toBeNull();
  });

  it("enforces the 60 character maximum after trimming", () => {
    const h = mk();
    withPrompt(h, TEST_PROMPT);
    expect(MAX_ANSWER_LENGTH).toBe(60);
    expect(h.tryAct("p1", { type: "answer", text: "x".repeat(61) })).not.toBeNull();
    expect(h.state.answers.p1).toBeNull();
    expect(h.tryAct("p1", { type: "answer", text: "x".repeat(60) })).toBeNull();
    expect(h.tryAct("p2", { type: "answer", text: `   ${"y".repeat(60)}   ` })).toBeNull();
    expect(h.state.answers.p2).toBe("y".repeat(60));
    expect(h.tryAct("p3", { type: "answer", text: "a" })).toBeNull();
  });

  it("rejects non-string answers", () => {
    const h = mk();
    expect(h.tryAct("p1", { type: "answer", text: 5 } as unknown as Action)).not.toBeNull();
    expect(h.tryAct("p1", { type: "answer" } as unknown as Action)).not.toBeNull();
  });

  it("lets each player answer only once", () => {
    const h = mk();
    withPrompt(h, TEST_PROMPT);
    answer(h, "p1", "first");
    expect(h.legal("p1").some((a) => a.type === "answer")).toBe(false);
    expect(h.tryAct("p1", { type: "answer", text: "second" })).not.toBeNull();
    expect(h.state.answers.p1).toBe("first");
  });

  it("rejects the real answer ignoring case, spaces and punctuation (and alternate spellings)", () => {
    const h = mk();
    withPrompt(h, TEST_PROMPT);
    for (const text of ["Unicorn", "unicorn", "UNICORN", "  Unicorn  ", "Unicorn!", "unicorn.", "'Unicorn'", "a unicorn", "A  Unicorn!!"]) {
      const err = h.tryAct("p1", { type: "answer", text });
      expect(err, text).not.toBeNull();
      expect(err!, text).toMatch(/real answer/i);
    }
    expect(h.state.answers.p1).toBeNull();
    expect(h.tryAct("p1", { type: "answer", text: "Unicorn horn" })).toBeNull();
  });

  it("rejects the real answer of a real (non-crafted) trivia prompt", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = mk({ seed });
      const real = cur(h).answer!;
      expect(h.tryAct("p2", { type: "answer", text: `  ${real.toUpperCase()} ` }), real).toMatch(/real answer/i);
      expect(h.tryAct("p2", { type: "answer", text: real.toLowerCase() + "!" }), real).toMatch(/real answer/i);
      for (const alt of cur(h).alts) expect(h.tryAct("p2", { type: "answer", text: alt }), alt).toMatch(/real answer/i);
    }
  });

  it("legal actions: answer for everyone, skip only for the host, nothing for spectators", () => {
    const h = mk();
    expect(h.legal("p1").map((a) => a.type)).toEqual(["answer"]);
    expect(h.legal("p0").map((a) => a.type).sort()).toEqual(["answer", "skip"]);
    expect(h.legal("ghost")).toEqual([]);
    expect(h.tryAct("ghost", { type: "answer", text: "boo" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "skip" })).not.toBeNull();
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "vote", option: "o1" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "@timeout" })).not.toBeNull();
    for (const p of ["p0", "p1", "p2", "p3"]) expect(h.legal(p).some((a) => a.type === "@timeout")).toBe(false);
  });

  it("moves to voting once everyone has answered", () => {
    const h = mk();
    withPrompt(h, TEST_PROMPT);
    answer(h, "p0", "Alpha");
    answer(h, "p1", "Bravo");
    answer(h, "p2", "Charlie");
    expect(h.state.phase).toBe("answer");
    answer(h, "p3", "Delta");
    expect(h.state.phase).toBe("vote");
    expect(h.state.voters.slice().sort()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(plugin.activePlayers(h.state).slice().sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });
});

describe("psych: vote phase", () => {
  function toVote(seed = 7) {
    const h = mk({ seed });
    withPrompt(h, TEST_PROMPT);
    answerAll(h, { p0: "Alpha", p1: "Bravo", p2: "Charlie", p3: "Delta" });
    return h;
  }

  it("shows every fake answer plus the real one, anonymously", () => {
    const h = toVote();
    const v = h.view("p2");
    expect(v.phase).toBe("vote");
    expect(v.options!.map((o) => o.text).sort()).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Unicorn"]);
    expect(v.options!.filter((o) => o.isMine).map((o) => o.text)).toEqual(["Charlie"]);
    expect(h.view(null).options!.every((o) => !o.isMine)).toBe(true);
    expect(v.voters.slice().sort()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(v.reveal).toBeNull();
  });

  it("option ids are o1..oN in display order and the order is the same for everyone", () => {
    const h = toVote();
    const ids = h.view("p0").options!.map((o) => o.id);
    expect(ids).toEqual(ids.map((_, i) => `o${i + 1}`));
    const order = JSON.stringify(h.view("p0").options!.map((o) => [o.id, o.text]));
    for (const p of ["p1", "p2", "p3", null]) {
      expect(JSON.stringify(h.view(p).options!.map((o) => [o.id, o.text]))).toBe(order);
    }
    expect(h.state.options.map((o) => o.id)).toEqual(ids);
  });

  it("legal votes are every option except your own", () => {
    const h = toVote();
    for (const p of ["p0", "p1", "p2", "p3"]) {
      const v = h.view(p);
      const expected = v.options!.filter((o) => !o.isMine).map((o) => o.id).sort();
      const legal = h.legal(p).filter((a) => a.type === "vote").map((a) => (a as { option: string }).option).sort();
      expect(legal, p).toEqual(expected);
      expect(legal, p).toHaveLength(4);
      expect(legal, p).toContain(realOptionId(h));
    }
    expect(h.legal("p1").some((a) => a.type === "skip")).toBe(false);
    expect(h.legal("p0").some((a) => a.type === "skip")).toBe(true);
    expect(h.legal("ghost")).toEqual([]);
  });

  it("rejects voting for your own answer, unknown options, voting twice, answering now, spectators", () => {
    const h = toVote();
    expect(h.tryAct("p1", { type: "vote", option: optionId(h, "p1", "Bravo") })).not.toBeNull();
    expect(h.tryAct("p1", { type: "vote", option: "o99" })).not.toBeNull();
    expect(h.tryAct("p1", { type: "answer", text: "late" })).not.toBeNull();
    expect(h.tryAct("ghost", { type: "vote", option: optionId(h, null, "Bravo") })).not.toBeNull();
    expect(h.tryAct("p1", { type: "vote", option: optionId(h, "p1", "Alpha") })).toBeNull();
    expect(h.view("p1").myVote).toBe(optionId(h, "p1", "Alpha"));
    expect(h.view("p0").voted.p1).toBe(true);
    expect(h.view("p0").myVote).toBeNull();
    expect(h.legal("p1")).toEqual([]);
    expect(h.tryAct("p1", { type: "vote", option: optionId(h, "p1", "Charlie") })).not.toBeNull();
    expect(h.state.votes.p1).toBe(optionId(h, "p1", "Alpha"));
    expect(plugin.activePlayers(h.state)).not.toContain("p1");
    expect(h.tryAct("p0", { type: "nextRound" })).not.toBeNull();
  });

  it("shuffles options so position does not reveal the author (or the real answer)", () => {
    const posOf: Record<string, Set<number>> = {};
    let sortedCount = 0;
    const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
    for (const seed of seeds) {
      const h = mk({ seed });
      withPrompt(h, { ...TEST_PROMPT, answer: "Eagle", alts: [] });
      // Seat order == alphabetical order, so sorting by author or by text would both be visible.
      answerAll(h, { p0: "Apple", p1: "Banana", p2: "Cherry", p3: "Date" });
      const texts = h.view("p0").options!.map((o) => o.text);
      if (JSON.stringify(texts) === JSON.stringify(texts.slice().sort())) sortedCount++;
      texts.forEach((t, i) => (posOf[t] ??= new Set()).add(i));
      // ids carry no seat / player id
      expect(JSON.stringify(h.view(null).options)).not.toMatch(/p[0-3]/);
    }
    expect(sortedCount).toBeLessThan(seeds.length / 2);
    for (const t of ["Apple", "Banana", "Cherry", "Date", "Eagle"]) expect(posOf[t].size, t).toBeGreaterThanOrEqual(3);
  });

  it("goes to reveal when every voter has voted", () => {
    const h = toVote();
    for (const p of ["p0", "p1", "p2"]) h.act(p, h.legal(p).find((a) => a.type === "vote")!);
    expect(h.state.phase).toBe("vote");
    h.act("p3", h.legal("p3").find((a) => a.type === "vote")!);
    expect(h.state.phase).toBe("reveal");
    expect(plugin.activePlayers(h.state)).toEqual([]);
    expect(h.legal("p1")).toEqual([]);
    expect(h.legal("p0")).toContainEqual({ type: "nextRound" });
    expect(h.legal("p0").some((a) => a.type === "skip")).toBe(false);
  });
});

describe("psych: scoring", () => {
  it("+1 per vote received, +2 for picking the real answer (hand computed)", () => {
    const h = mk({ seed: 11 });
    withPrompt(h, TEST_PROMPT);
    answerAll(h, { p0: "Alpha", p1: "Bravo", p2: "Charlie", p3: "Delta" });
    const voteOrder = h.view("p0").options!.map((o) => o.id);
    h.act("p0", { type: "vote", option: optionId(h, "p0", "Bravo") });
    h.act("p1", { type: "vote", option: optionId(h, "p1", "Unicorn") });
    h.act("p2", { type: "vote", option: optionId(h, "p2", "Bravo") });
    h.act("p3", { type: "vote", option: optionId(h, "p3", "Alpha") });
    expect(h.state.phase).toBe("reveal");
    // p0: 1 vote (p3) = 1. p1: 2 votes (p0, p2) + real = 4. p2, p3: 0.
    expect(h.state.scores).toEqual({ p0: 1, p1: 4, p2: 0, p3: 0 });
    const r = h.view("p2").reveal!;
    expect(r.realAnswer).toBe("Unicorn");
    expect(r.roundPoints).toMatchObject({ p0: 1, p1: 4, p2: 0, p3: 0 });
    expect(r.options.map((o) => o.id)).toEqual(voteOrder);
    const byText = (t: string) => r.options.find((o) => o.text === t)!;
    expect(byText("Bravo")).toMatchObject({ isReal: false, authors: ["p1"], pointsPerAuthor: 2 });
    expect(byText("Bravo").voters.slice().sort()).toEqual(["p0", "p2"]);
    expect(byText("Alpha")).toMatchObject({ authors: ["p0"], voters: ["p3"], pointsPerAuthor: 1 });
    expect(byText("Charlie")).toMatchObject({ authors: ["p2"], voters: [], pointsPerAuthor: 0, isMine: true });
    expect(byText("Unicorn")).toMatchObject({ isReal: true, authors: [], voters: ["p1"], pointsPerAuthor: 0 });
    expect(r.noAnswer).toEqual([]);
    expect(r.noVote).toEqual([]);
    expect(r.voteSkipped).toBe(false);
    const ranks = Object.fromEntries(h.envelope("p0").scores.map((s) => [s.playerId, [s.score, s.rank]]));
    expect(ranks).toEqual({ p1: [4, 1], p0: [1, 2], p2: [0, 3], p3: [0, 3] });
  });

  it("identical fake answers merge into one option credited to every author", () => {
    const h = mk({ seed: 12 });
    withPrompt(h, TEST_PROMPT);
    answerAll(h, { p0: "Alpha", p1: "Pizza", p2: "  Pizza ", p3: "Delta" });
    const v = h.view("p0");
    expect(v.options!.map((o) => o.text).sort()).toEqual(["Alpha", "Delta", "Pizza", "Unicorn"]);
    const pizza = optionId(h, "p0", "Pizza");
    expect(h.view("p1").options!.find((o) => o.id === pizza)!.isMine).toBe(true);
    expect(h.view("p2").options!.find((o) => o.id === pizza)!.isMine).toBe(true);
    expect(h.legal("p1").some((a) => a.type === "vote" && a.option === pizza)).toBe(false);
    expect(h.legal("p2").some((a) => a.type === "vote" && a.option === pizza)).toBe(false);
    expect(h.tryAct("p2", { type: "vote", option: pizza })).not.toBeNull();
    h.act("p0", { type: "vote", option: pizza });
    h.act("p3", { type: "vote", option: pizza });
    h.act("p1", { type: "vote", option: optionId(h, "p1", "Unicorn") });
    h.act("p2", { type: "vote", option: optionId(h, "p2", "Alpha") });
    // p1: 2 votes + real = 4. p2: 2 votes = 2. p0: 1 (p2). p3: 0.
    expect(h.state.scores).toEqual({ p0: 1, p1: 4, p2: 2, p3: 0 });
    const opt = h.view("p3").reveal!.options.find((o) => o.id === pizza)!;
    expect(opt.authors.slice().sort()).toEqual(["p1", "p2"]);
    expect(opt.pointsPerAuthor).toBe(2);
    expect(opt.voters.slice().sort()).toEqual(["p0", "p3"]);
  });

  it("uses the fooledPoints / truthPoints settings", () => {
    const h = mk({ seed: 13, settings: { fooledPoints: 2, truthPoints: 3 } });
    const f = h.state.settings.fooledPoints, t = h.state.settings.truthPoints;
    expect([f, t]).not.toEqual([1, 2]);
    withPrompt(h, TEST_PROMPT);
    answerAll(h, { p0: "Alpha", p1: "Bravo", p2: "Charlie", p3: "Delta" });
    h.act("p0", { type: "vote", option: optionId(h, "p0", "Unicorn") });
    h.act("p1", { type: "vote", option: optionId(h, "p1", "Alpha") });
    h.act("p2", { type: "vote", option: optionId(h, "p2", "Alpha") });
    h.act("p3", { type: "vote", option: optionId(h, "p3", "Unicorn") });
    expect(h.state.scores).toEqual({ p0: 2 * f + t, p1: 0, p2: 0, p3: t });
    expect(h.view("p0").rules).toMatchObject({ fooledPoints: f, truthPoints: t });
  });

  it("scores accumulate across rounds", () => {
    const h = mk({ seed: 14, settings: { rounds: 3 } });
    withPrompt(h, TEST_PROMPT);
    answerAll(h, { p0: "Alpha", p1: "Bravo", p2: "Charlie", p3: "Delta" });
    for (const p of ["p0", "p1", "p2", "p3"]) h.act(p, { type: "vote", option: optionId(h, p, p === "p1" ? "Alpha" : "Bravo") });
    // Bravo (p1): 3 votes. Alpha (p0): 1 vote.
    expect(h.state.scores).toEqual({ p0: 1, p1: 3, p2: 0, p3: 0 });
    h.act("p0", { type: "nextRound" });
    expect(h.state.round).toBe(2);
    withPrompt(h, { ...TEST_PROMPT, text: "Second test ___", answer: "Zebra", alts: [] });
    answerAll(h, { p0: "Wolf", p1: "Lion", p2: "Bear", p3: "Fox" });
    for (const p of ["p0", "p1", "p2", "p3"]) h.act(p, { type: "vote", option: optionId(h, p, "Zebra") });
    expect(h.state.scores).toEqual({ p0: 3, p1: 5, p2: 2, p3: 2 });
    expect(h.view("p3").reveal!.roundPoints).toMatchObject({ p0: 2, p1: 2, p2: 2, p3: 2 });
  });
});

describe("psych: rounds and end of game", () => {
  it("next round is host-only and resets the round", () => {
    const h = mk({ seed: 15, settings: { rounds: 3 } });
    const round1Text = h.view("p1").promptText;
    answerAll(h);
    for (const p of h.state.voters) h.act(p, h.legal(p).find((a) => a.type === "vote")!);
    expect(h.state.phase).toBe("reveal");
    expect(h.view("p1").isLastRound).toBe(false);
    expect(h.tryAct("p1", { type: "nextRound" })).not.toBeNull();
    h.act("p0", { type: "nextRound" });
    const v = h.view("p1");
    expect(v).toMatchObject({ phase: "answer", round: 2, myAnswer: null, myVote: null, options: null, reveal: null, answeredCount: 0 });
    expect(Object.values(v.answered).every((x) => x === false)).toBe(true);
    expect(Object.values(h.state.answers).every((x) => x === null)).toBe(true);
    expect(v.promptText).not.toBe(round1Text);
  });

  it("ends exactly after `rounds` rounds", () => {
    const h = mk({ seed: 16, settings: { rounds: 3 } });
    for (let r = 1; r <= 3; r++) {
      expect(h.state.round).toBe(r);
      expect(h.match.over).toBe(false);
      answerAll(h);
      for (const p of h.state.voters) h.act(p, h.legal(p).find((a) => a.type === "vote")!);
      expect(h.state.phase).toBe("reveal");
      expect(h.view("p2").isLastRound).toBe(r === 3);
      h.act("p0", { type: "nextRound" });
    }
    expect(h.match.over).toBe(true);
    expect(plugin.isOver(h.state)).toBe(true);
    expect(h.state.phase).toBe("over");
    expect(h.view("p1").phase).toBe("over");
    for (const p of ["p0", "p1", "p2", "p3", "ghost"]) expect(h.legal(p)).toEqual([]);
    expect(plugin.activePlayers(h.state)).toEqual([]);
    const scores = h.envelope("p0").scores;
    expect(scores.map((s) => s.playerId).sort()).toEqual(["p0", "p1", "p2", "p3"]);
    for (const s of scores) {
      expect(s.score).toBe(h.state.scores[s.playerId]);
      expect(s.rank).toBe(1 + scores.filter((o) => o.score > s.score).length);
    }
  });
});

describe("psych: host skip", () => {
  it("in the answer phase with >= 2 answers moves on to voting with those answers", () => {
    const h = mk({ seed: 17 });
    withPrompt(h, TEST_PROMPT);
    answer(h, "p1", "Bravo");
    answer(h, "p2", "Charlie");
    expect(h.tryAct("p1", { type: "skip" })).not.toBeNull();
    h.act("p0", { type: "skip" });
    expect(h.state.phase).toBe("vote");
    expect(h.view("p1").options!.map((o) => o.text).sort()).toEqual(["Bravo", "Charlie", "Unicorn"]);
    expect(h.tryAct("p3", { type: "answer", text: "too late" })).not.toBeNull();
    // Finish voting via the host's skip as well.
    h.act("p1", { type: "vote", option: optionId(h, "p1", "Charlie") });
    expect(h.tryAct("p2", { type: "skip" })).not.toBeNull();
    h.act("p0", { type: "skip" });
    expect(h.state.phase).toBe("reveal");
    const r = h.view("p3").reveal!;
    expect(r.noAnswer.slice().sort()).toEqual(["p0", "p3"]);
    expect(r.noVote).not.toContain("p1");
    expect(r.voteSkipped).toBe(false);
    expect(h.state.scores).toEqual({ p0: 0, p1: 0, p2: 1, p3: 0 });
  });

  it("with fewer than 2 answers goes straight to reveal", () => {
    for (const n of [0, 1]) {
      const h = mk({ seed: 18 });
      withPrompt(h, TEST_PROMPT);
      if (n === 1) answer(h, "p2", "Lonely");
      h.act("p0", { type: "skip" });
      expect(h.state.phase, `${n} answers`).toBe("reveal");
      const r = h.view("p1").reveal!;
      expect(r.voteSkipped).toBe(true);
      expect(r.realAnswer).toBe("Unicorn");
      expect(Object.values(h.state.scores).every((s) => s === 0)).toBe(true);
      expect(r.noAnswer).toHaveLength(4 - n);
      expect(h.legal("p0")).toContainEqual({ type: "nextRound" });
      h.act("p0", { type: "nextRound" });
      expect(h.state).toMatchObject({ phase: "answer", round: 2 });
    }
  });

  it("the host can skip the vote phase without voting, and non-hosts never get skip", () => {
    const h = mk({ seed: 19 });
    answerAll(h, {});
    expect(h.state.phase).toBe("vote");
    for (const p of ["p1", "p2", "p3"]) expect(h.legal(p).some((a) => a.type === "skip")).toBe(false);
    expect(h.legal("p0").some((a) => a.type === "skip")).toBe(true);
    h.act("p0", { type: "skip" });
    expect(h.state.phase).toBe("reveal");
    expect(h.view("p0").reveal!.noVote.slice().sort()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(Object.values(h.state.scores).every((s) => s === 0)).toBe(true);
  });
});

describe("psych: timers", () => {
  it("no deadline when timers are 0", () => {
    const h = mk({ seed: 20 });
    expect(h.envelope("p0").deadline).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
    answerAll(h);
    expect(h.envelope("p0").deadline).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
    expect(h.state.phase).toBe("vote");
  });

  it("answer timer fires at now + answerSeconds and moves on with whoever answered", () => {
    const h = mk({ seed: 21, settings: { answerSeconds: 30, voteSeconds: 30 } });
    const t0 = h.now;
    const as = h.state.settings.answerSeconds * 1000, vs = h.state.settings.voteSeconds * 1000;
    expect(as).toBe(30_000);
    expect(vs).toBeGreaterThan(0);
    expect(h.envelope("p1").deadline).toBe(t0 + as);
    expect(h.view("p1").rules).toMatchObject({ answerSeconds: as / 1000, voteSeconds: vs / 1000 });
    withPrompt(h, TEST_PROMPT);
    expect(h.advanceTime(10_000)).toBe(false);
    answer(h, "p1", "Bravo");
    answer(h, "p2", "Charlie");
    expect(h.advanceTime(19_999)).toBe(false);
    expect(h.state.phase).toBe("answer");
    expect(h.advanceTime(1)).toBe(true);
    expect(h.state.phase).toBe("vote");
    expect(h.view("p1").options!.map((o) => o.text).sort()).toEqual(["Bravo", "Charlie", "Unicorn"]);
    expect(h.envelope("p1").deadline).toBe(h.now + vs);
    h.act("p1", { type: "vote", option: optionId(h, "p1", "Unicorn") });
    expect(h.advanceTime(vs - 1)).toBe(false);
    expect(h.advanceTime(1)).toBe(true);
    expect(h.state.phase).toBe("reveal");
    expect(h.envelope("p1").deadline).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
    expect(h.state.phase).toBe("reveal");
    expect(h.state.scores.p1).toBe(2);
    expect(h.view("p1").reveal!.noAnswer.slice().sort()).toEqual(["p0", "p3"]);
    // The next round restarts the answer timer from the moment the host taps.
    h.now += 5_000;
    h.act("p0", { type: "nextRound" });
    expect(h.envelope("p2").deadline).toBe(h.now + as);
  });

  it("answer timeout with < 2 answers goes to reveal", () => {
    const h = mk({ seed: 22, settings: { answerSeconds: 30 } });
    answer(h, "p3", "solo");
    expect(h.advanceTime(h.state.settings.answerSeconds * 1000)).toBe(true);
    expect(h.state.phase).toBe("reveal");
    expect(h.view("p0").reveal!.voteSkipped).toBe(true);
  });

  it("vote deadline starts when the last answer arrives; only the vote timer when answerSeconds is 0", () => {
    const h = mk({ seed: 23, settings: { voteSeconds: 30 } });
    const vs = h.state.settings.voteSeconds * 1000;
    expect(vs).toBeGreaterThan(0);
    expect(h.envelope("p0").deadline).toBeNull();
    h.now += 7_000;
    answerAll(h);
    expect(h.state.phase).toBe("vote");
    expect(h.envelope("p0").deadline).toBe(h.now + vs);
    expect(h.advanceTime(vs - 1)).toBe(false);
    expect(h.advanceTime(1)).toBe(true);
    expect(h.state.phase).toBe("reveal");
  });

  it("answer timer only: voting has no deadline", () => {
    const h = mk({ seed: 24, settings: { answerSeconds: 20 } });
    answerAll(h);
    expect(h.state.phase).toBe("vote");
    expect(h.envelope("p0").deadline).toBeNull();
    expect(h.advanceTime(10 * 60_000)).toBe(false);
  });

  it("a game where nobody ever acts still finishes through timeouts + host next round", () => {
    const h = mk({ players: 5, seed: 25, settings: { rounds: 4, answerSeconds: 30, voteSeconds: 30 } });
    const as = h.state.settings.answerSeconds * 1000;
    for (let r = 1; r <= 4; r++) {
      expect(h.state.round).toBe(r);
      expect(h.advanceTime(as - 1)).toBe(false);
      expect(h.advanceTime(1)).toBe(true);
      expect(h.state.phase).toBe("reveal");
      h.act("p0", { type: "nextRound" });
    }
    expect(h.match.over).toBe(true);
  });
});

describe("psych: hidden information", () => {
  for (const [label, settings] of [
    ["trivia", { mode: "trivia" }],
    ["friends", { mode: "friends" }],
    ["friends/subject", { mode: "friends", friendsRealAnswer: "subject" }],
    ["mixed", { mode: "mixed" }],
    ["custom", { mode: "trivia", customPrompts: "Custom moon cheese is ___ | Gorgonzola\nCustom {player} loves ___" }],
    ["timers", { mode: "mixed", answerSeconds: 30, voteSeconds: 30, friendsRealAnswer: "subject" }],
  ] as const) {
    it(`no leaks in any phase for any viewer (${label})`, () => {
      for (const seed of [1, 2]) {
        const h = mk({ players: 4, seed, settings: { ...settings, rounds: 4 } });
        playGame(h);
        expect(h.match.over).toBe(true);
      }
    });
  }

  it("another player's answer does not change anyone else's view (answer phase)", () => {
    const a = mk({ seed: 30 });
    const b = mk({ seed: 30 });
    answer(a, "p1", "Answer one");
    answer(b, "p1", "Something else entirely");
    for (const p of ["p0", "p2", "p3", null]) {
      expect(a.view(p), String(p)).toEqual(b.view(p));
      expect(a.envelope(p), String(p)).toEqual(b.envelope(p));
      if (p) expect(a.legal(p)).toEqual(b.legal(p));
    }
  });

  it("another player's vote does not change anyone else's view (vote phase)", () => {
    const mkVote = () => {
      const h = mk({ seed: 31 });
      withPrompt(h, TEST_PROMPT);
      answerAll(h, { p0: "Alpha", p1: "Bravo", p2: "Charlie", p3: "Delta" });
      return h;
    };
    const a = mkVote();
    const b = mkVote();
    a.act("p1", { type: "vote", option: optionId(a, "p1", "Unicorn") });
    b.act("p1", { type: "vote", option: optionId(b, "p1", "Charlie") });
    for (const p of ["p0", "p2", "p3", null]) {
      expect(a.view(p), String(p)).toEqual(b.view(p));
      expect(a.envelope(p), String(p)).toEqual(b.envelope(p));
      if (p) expect(a.legal(p)).toEqual(b.legal(p));
    }
  });

  it("the real answer is not visible before the vote, and not identifiable during it", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = mk({ seed });
      const real = cur(h).answer!;
      for (const p of ["p0", "p1", "p2", "p3", null]) expect(exposes(blobFor(h, p), real), `seed ${seed} ${p}`).toBe(false);
      answerAll(h);
      const realId = realOptionId(h)!;
      expect(realId).not.toBeNull();
      for (const p of ["p0", "p1", "p2", "p3", null]) {
        const v = h.view(p);
        const realOpt = v.options!.find((o) => o.id === realId)!;
        const fake = v.options!.find((o) => o.id !== realId && !o.isMine)!;
        // The real option looks exactly like a fake that isn't yours.
        expect(Object.keys(realOpt).sort()).toEqual(Object.keys(fake).sort());
        expect(realOpt.isMine).toBe(false);
      }
    }
  });
});

describe("psych: friends mode", () => {
  it("substitutes {player} with the subject's name and has no real answer by default", () => {
    const h = mk({ seed: 40, settings: { mode: "friends" } });
    for (const p of h.state.prompts) {
      expect(p.source).toBe("friends");
      expect(p.truth).toBe("none");
      expect(p.answer).toBeNull();
      expect(h.state.order).toContain(p.subject);
      expect(p.text).toContain(PLAYER_PLACEHOLDER);
    }
    const subject = cur(h).subject!;
    for (const viewer of ["p0", "p1", "p2", "p3", null]) {
      const v = h.view(viewer);
      expect(v.kind).toBe("friends");
      expect(v.truth).toBe("none");
      expect(v.subject).toBe(subject);
      expect(v.subjectName).toBe(h.state.names[subject]);
      expect(v.iAmSubject).toBe(viewer === subject);
      expect(v.writeTruth).toBe(false);
      expect(v.promptText).not.toContain(PLAYER_PLACEHOLDER);
      expect(v.promptText).toContain(h.state.names[subject]);
      expect(v.answerTarget).toBe(4);
    }
  });

  it("uses players' real names in the prompt", () => {
    const players = [
      { id: "a", name: "Asha", seat: 0 },
      { id: "b", name: "Bilal", seat: 1 },
      { id: "c", name: "Chen", seat: 2 },
    ];
    const h = mk({ players, seed: 41, settings: { mode: "friends" } });
    const s = cur(h).subject!;
    expect(h.view("a").promptText).toContain({ a: "Asha", b: "Bilal", c: "Chen" }[s]);
  });

  it("rotates the subject among the players", () => {
    for (const n of [3, 5]) {
      for (const seed of [1, 2, 3]) {
        const h = mk({ players: n, seed, settings: { mode: "friends", rounds: 2 * n } });
        const subjects = h.state.prompts.map((p) => p.subject!);
        for (let i = 1; i < subjects.length; i++) expect(subjects[i], `n=${n} seed=${seed}`).not.toBe(subjects[i - 1]);
        for (let b = 0; b + n <= subjects.length; b += n) {
          expect(new Set(subjects.slice(b, b + n)).size, `n=${n} seed=${seed} ${subjects}`).toBe(n);
        }
      }
    }
  });

  it("without a real answer: everyone (subject too) writes a fake and votes; only fooling scores", () => {
    const h = mk({ seed: 42, settings: { mode: "friends" } });
    const s = cur(h).subject!;
    const others = h.state.order.filter((p) => p !== s);
    answerAll(h, { [s]: "Subj fake", [others[0]]: "One", [others[1]]: "Two", [others[2]]: "Three" });
    expect(h.state.phase).toBe("vote");
    expect(h.state.voters).toContain(s);
    const v = h.view(others[0]);
    expect(v.options!.map((o) => o.text).sort()).toEqual(["One", "Subj fake", "Three", "Two"]);
    expect(h.state.options.some((o) => o.isReal)).toBe(false);
    // subject -> One, others[0] -> Two, others[1] -> Two, others[2] -> Subj fake
    h.act(s, { type: "vote", option: optionId(h, s, "One") });
    h.act(others[0], { type: "vote", option: optionId(h, others[0], "Two") });
    h.act(others[1], { type: "vote", option: optionId(h, others[1], "One") });
    h.act(others[2], { type: "vote", option: optionId(h, others[2], "Subj fake") });
    expect(h.state.phase).toBe("reveal");
    expect(h.state.scores).toEqual({ [s]: 1, [others[0]]: 2, [others[1]]: 1, [others[2]]: 0 });
    const r = h.view(s).reveal!;
    expect(r.realAnswer).toBeNull();
    expect(r.options.every((o) => !o.isReal)).toBe(true);
    expect(r.truthGuessers).toEqual([]);
  });

  it("friendsRealAnswer=subject: the subject writes the truth, doesn't vote, matching guessers and pickers get +2", () => {
    const h = mk({ seed: 43, settings: { mode: "friends", friendsRealAnswer: "subject" } });
    expect(cur(h).truth).toBe("subject");
    const s = cur(h).subject!;
    const [o1, o2, o3] = h.state.order.filter((p) => p !== s);
    expect(h.view(s)).toMatchObject({ writeTruth: true, iAmSubject: true, truth: "subject" });
    expect(h.view(o1)).toMatchObject({ writeTruth: false, iAmSubject: false, truth: "subject" });
    expect(h.view(null).writeTruth).toBe(false);
    expect(h.view(o1).answerTarget).toBe(4);
    answer(h, s, "Juggling");
    // Nobody but the subject can tell what the truth is.
    for (const p of [o1, o2, o3, null]) expect(exposes(blobFor(h, p), "Juggling")).toBe(false);
    // A guess equal to the truth is not rejected (that would leak it); it merges into the truth.
    expect(h.tryAct(o1, { type: "answer", text: " juggling! " })).toBeNull();
    answer(h, o2, "Fake one");
    answer(h, o3, "Fake two");
    expect(h.state.phase).toBe("vote");
    expect(h.state.voters.slice().sort()).toEqual([o1, o2, o3].sort());
    expect(h.state.voters).not.toContain(s);
    expect(h.legal(s)).toEqual([]);
    expect(plugin.activePlayers(h.state)).not.toContain(s);
    const texts = h.view(o2).options!.map((o) => o.text);
    expect(texts).toHaveLength(3);
    const realId = realOptionId(h)!;
    expect(realId).not.toBeNull();
    const realRec = h.state.options.find((o) => o.id === realId)!;
    expect(realRec.authors[0]).toBe(s);
    expect(realRec.authors).toContain(o1);
    expect(h.tryAct(s, { type: "vote", option: optionId(h, s, "Fake one") })).not.toBeNull();
    // o1 can't vote for the truth (it is also theirs).
    expect(h.legal(o1).some((a) => a.type === "vote" && a.option === realId)).toBe(false);
    h.act(o1, { type: "vote", option: optionId(h, o1, "Fake one") });
    h.act(o2, { type: "vote", option: realId });
    h.act(o3, { type: "vote", option: optionId(h, o3, "Fake one") });
    expect(h.state.phase).toBe("reveal");
    // o1: matched the truth +2. o2: 2 votes + picked truth = 4. o3: 0. subject: 0.
    expect(h.state.scores).toEqual({ [s]: 0, [o1]: 2, [o2]: 4, [o3]: 0 });
    const r = h.view(o3).reveal!;
    expect(r.realAnswer).toBe("Juggling");
    expect(r.truthGuessers).toEqual([o1]);
    const real = r.options.find((o) => o.isReal)!;
    expect(real.authors[0]).toBe(s);
    expect(real.voters).toEqual([o2]);
    expect(real.pointsPerAuthor).toBe(0);
  });

  it("friendsRealAnswer has no effect on trivia rounds", () => {
    const h = mk({ seed: 44, settings: { mode: "trivia", friendsRealAnswer: "subject" } });
    expect(h.state.prompts.every((p) => p.truth === "fact")).toBe(true);
    answerAll(h);
    expect(h.state.voters).toHaveLength(4);
  });
});

describe("psych: mixed mode", () => {
  it("alternates trivia and friends rounds", () => {
    for (const seed of [1, 2, 3]) {
      const h = mk({ seed, settings: { mode: "mixed", rounds: 8 } });
      const isFriends = h.state.prompts.map((p) => p.source === "friends");
      expect(isFriends.filter(Boolean)).toHaveLength(4);
      for (let i = 1; i < isFriends.length; i++) expect(isFriends[i], `seed ${seed}`).not.toBe(isFriends[i - 1]);
      for (const p of h.state.prompts) {
        if (p.source === "friends") expect(p.subject).not.toBeNull();
        else expect(p.truth).toBe("fact");
      }
    }
  });

  it("the view kind follows the round's prompt", () => {
    const h = mk({ seed: 45, settings: { mode: "mixed", rounds: 4 } });
    const kinds: string[] = [];
    while (!h.match.over) {
      kinds.push(h.view("p1").kind);
      expect(h.view("p1").kind).toBe(cur(h).source === "friends" ? "friends" : "trivia");
      h.act("p0", { type: "skip" });
      h.act("p0", { type: "nextRound" });
    }
    expect(new Set(kinds)).toEqual(new Set(["trivia", "friends"]));
  });
});

describe("psych: custom prompts", () => {
  const custom = "Custom alpha question ___ | Zorbleflux\nCustom beta question about {player} ___";

  it("custom lines are always played, in addition to the packs", () => {
    for (const seed of [1, 2, 3]) {
      const h = mk({ seed, settings: { customPrompts: custom, rounds: 3 } });
      const ps = h.state.prompts;
      expect(ps).toHaveLength(3);
      const alpha = ps.find((p) => p.text.includes("Custom alpha question"));
      const beta = ps.find((p) => p.text.includes("Custom beta question"));
      expect(alpha, `seed ${seed}`).toBeDefined();
      expect(beta, `seed ${seed}`).toBeDefined();
      expect(alpha).toMatchObject({ source: "custom", answer: "Zorbleflux", truth: "fact" });
      expect(beta!.source).toBe("custom");
      expect(beta!.answer).toBeNull();
      expect(h.state.order).toContain(beta!.subject);
      expect(ps.filter((p) => p.source !== "custom")).toHaveLength(1);
    }
  });

  it("a custom answer is the real answer of its round", () => {
    const h = mk({ seed: 46, settings: { customPrompts: custom, rounds: 3 } });
    let guard = 0;
    while (!cur(h).text.includes("Custom alpha question")) {
      if (guard++ > 5) throw new Error("custom prompt never came up");
      h.act("p0", { type: "skip" });
      h.act("p0", { type: "nextRound" });
    }
    expect(h.view("p1").promptText).toContain("Custom alpha question");
    expect(h.view("p1").sourceLabel.length).toBeGreaterThan(0);
    for (const p of ["p0", "p1", "p2", "p3", null]) expect(exposes(blobFor(h, p), "Zorbleflux")).toBe(false);
    expect(h.tryAct("p1", { type: "answer", text: "zorbleflux" })).toMatch(/real answer/i);
    answerAll(h, { p0: "A1", p1: "B1", p2: "C1", p3: "D1" });
    expect(h.view("p1").options!.map((o) => o.text)).toContain("Zorbleflux");
    for (const p of ["p0", "p1", "p2", "p3"]) h.act(p, { type: "vote", option: optionId(h, p, "Zorbleflux") });
    expect(h.state.scores).toEqual({ p0: 2, p1: 2, p2: 2, p3: 2 });
    expect(h.view("p2").reveal!.realAnswer).toBe("Zorbleflux");
  });

  it("a custom {player} line names its subject", () => {
    const h = mk({ seed: 47, settings: { customPrompts: custom, rounds: 3 } });
    let guard = 0;
    while (!cur(h).text.includes("Custom beta question")) {
      if (guard++ > 5) throw new Error("custom prompt never came up");
      h.act("p0", { type: "skip" });
      h.act("p0", { type: "nextRound" });
    }
    const v = h.view("p2");
    expect(v.promptText).not.toContain(PLAYER_PLACEHOLDER);
    expect(v.promptText).toContain(h.state.names[cur(h).subject!]);
  });
});

describe("psych: determinism and bots", () => {
  it("same seed, same game", () => {
    for (const mode of ["trivia", "friends", "mixed"]) {
      const a = simulateGame(plugin, { players: 5, seed: 77, settings: { mode } });
      const b = simulateGame(plugin, { players: 5, seed: 77, settings: { mode } });
      expect(a.log).toEqual(b.log);
      expect(a.match.state).toEqual(b.match.state);
    }
  });

  const configs: [string, Record<string, unknown>][] = [
    ["trivia", { mode: "trivia" }],
    ["friends", { mode: "friends" }],
    ["friends/subject", { mode: "friends", friendsRealAnswer: "subject" }],
    ["mixed", { mode: "mixed" }],
    ["mixed/subject+custom", { mode: "mixed", friendsRealAnswer: "subject", customPrompts: "Bot custom ___ | Banana\nAbout {player} ___" }],
    ["timers", { mode: "mixed", answerSeconds: 20, voteSeconds: 15 }],
    ["one pack, 20 rounds", { packs: ["science"], rounds: 20 }],
  ];
  for (const [label, settings] of configs) {
    for (const n of [3, 6, 12]) {
      it(`bots finish: ${label}, ${n} players`, () => {
        for (const seed of [1, 2, 3]) {
          const { match } = simulateGame(plugin, { players: n, seed, settings: settings as never });
          expect(match.over).toBe(true);
          const st = match.state as State;
          expect(st.phase).toBe("over");
          expect(plugin.scores(st).map((s) => s.playerId).sort()).toEqual(makePlayers(n).map((p) => p.id).sort());
          assertJsonSafe(st);
          expect(JSON.stringify(st).length).toBeLessThan(100_000);
        }
      });
    }
  }
});
