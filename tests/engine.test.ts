import { describe, expect, it } from "vitest";
import {
  FREE_NUMBER,
  FREE_TEXT,
  cardLabel,
  dealAll,
  followSuitOptions,
  isLegal,
  makeDeck,
  nextPlayer,
  parseCard,
  rankScores,
  rankValue,
  sortCards,
  trickWinner,
} from "../engine";
import { createRng } from "../engine/rng";
import { applyAction, startMatch, sanitizeAction } from "../engine/match";
import { defaultSettings, lintSchema, resolveSettings } from "../engine/settings";
import type { GameAction, SettingField } from "../engine/types";
import { createHarness, findLeaks, makePlayers } from "../engine/testing";
import highcard from "../games/highcard/rules";

describe("rng", () => {
  it("is deterministic per seed and stream", () => {
    const a = createRng(42, 3), b = createRng(42, 3), c = createRng(42, 4);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });
  it("shuffle keeps elements and does not mutate", () => {
    const deck = makeDeck();
    const copy = deck.slice();
    const s = createRng(1).shuffle(deck);
    expect(deck).toEqual(copy);
    expect(s.slice().sort()).toEqual(copy.slice().sort());
    expect(s).not.toEqual(copy);
  });
  it("int stays in range", () => {
    const r = createRng(9);
    for (let i = 0; i < 500; i++) {
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});

describe("cards", () => {
  it("builds decks", () => {
    expect(makeDeck()).toHaveLength(52);
    expect(new Set(makeDeck({ decks: 2, jokers: 2 })).size).toBe(106);
    expect(makeDeck({ ranks: ["7", "8", "9", "T", "J", "Q", "K", "A"] })).toHaveLength(32);
  });
  it("parses and labels", () => {
    expect(parseCard("TS")).toMatchObject({ rank: "T", suit: "S", copy: 1 });
    expect(parseCard("7H#2")).toMatchObject({ rank: "7", suit: "H", copy: 2 });
    expect(parseCard("XR").joker).toBe(true);
    expect(cardLabel("TS")).toBe("10♠");
    expect(rankValue("AH")).toBe(14);
    expect(rankValue("AH", true)).toBe(1);
    expect(() => parseCard("1Z")).toThrow();
  });
  it("sorts by suit and by rank", () => {
    expect(sortCards(["AH", "2S", "KS", "3H"], "suit")).toEqual(["2S", "KS", "3H", "AH"]);
    expect(sortCards(["AH", "2S", "KS", "3H"], "rank")).toEqual(["2S", "3H", "KS", "AH"]);
  });
  it("deals the full deck unevenly", () => {
    const hands = dealAll(makeDeck(), 5);
    expect(hands.map((h) => h.length)).toEqual([11, 11, 10, 10, 10]);
  });
  it("finds the trick winner with and without trump", () => {
    expect(trickWinner(["5H", "KH", "AS", "2H"], null)).toBe(1); // AS off-suit
    expect(trickWinner(["5H", "KH", "2S", "AH"], "S")).toBe(2); // trump wins
    expect(trickWinner(["5H", "3S", "4S"], "S")).toBe(2); // higher trump
    expect(trickWinner(["5H", "KD"], "S")).toBe(0); // off-suit, no trump
  });
  it("follow-suit options", () => {
    expect(followSuitOptions(["2H", "3S", "KH"], "H")).toEqual(["2H", "KH"]);
    expect(followSuitOptions(["2D", "3S"], "H")).toEqual(["2D", "3S"]);
    expect(followSuitOptions(["2D"], null)).toEqual(["2D"]);
  });
});

describe("helpers", () => {
  it("isLegal matches structurally and with FREE_* placeholders", () => {
    const legal: GameAction[] = [{ type: "play", card: "AS" }, { type: "answer", text: FREE_TEXT }, { type: "bet", amount: FREE_NUMBER }];
    expect(isLegal(legal, { type: "play", card: "AS" })).toBe(true);
    expect(isLegal(legal, { type: "play", card: "KS" })).toBe(false);
    expect(isLegal(legal, { type: "play", card: "AS", extra: 1 })).toBe(false);
    expect(isLegal(legal, { type: "answer", text: "hello" })).toBe(true);
    expect(isLegal(legal, { type: "answer", text: 5 })).toBe(false);
    expect(isLegal(legal, { type: "bet", amount: 10 })).toBe(true);
    expect(isLegal(legal, { type: "bet", amount: "10" })).toBe(false);
  });
  it("rankScores uses competition ranking", () => {
    expect(rankScores({ a: 5, b: 9, c: 5 })).toEqual([
      { playerId: "b", score: 9, rank: 1 },
      { playerId: "a", score: 5, rank: 2 },
      { playerId: "c", score: 5, rank: 2 },
    ]);
    expect(rankScores({ a: 5, b: 9 }, false)[0].playerId).toBe("a");
  });
  it("nextPlayer wraps and skips", () => {
    expect(nextPlayer(["a", "b", "c"], "c")).toBe("a");
    expect(nextPlayer(["a", "b", "c"], "a", (p) => p === "b")).toBe("c");
  });
});

describe("settings", () => {
  const schema: SettingField[] = [
    { type: "number", key: "rounds", label: "Rounds", default: 5, min: 1, max: 10 },
    { type: "boolean", key: "jokers", label: "Jokers", default: false },
    { type: "select", key: "mode", label: "Mode", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    { type: "multiselect", key: "packs", label: "Packs", default: ["x"], minSelected: 1, options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    { type: "text", key: "note", label: "Note", default: "", maxLength: 5 },
  ];
  it("fills defaults and sanitizes", () => {
    expect(resolveSettings(schema, {})).toEqual(defaultSettings(schema));
    expect(resolveSettings(schema, { rounds: 99, jokers: "yes", mode: "zzz", packs: ["y", "q"], note: "toolong", junk: 1 })).toEqual({
      rounds: 10, jokers: false, mode: "a", packs: ["y"], note: "toolo",
    });
    expect(resolveSettings(schema, { packs: [] }).packs).toEqual(["x"]);
  });
  it("lints schemas", () => {
    expect(lintSchema(schema)).toEqual([]);
    expect(lintSchema([...schema, schema[0]])).toContain("duplicate key rounds");
  });
});

describe("match runner", () => {
  it("rejects bad payloads and illegal moves", () => {
    expect(() => sanitizeAction(null)).toThrow();
    expect(() => sanitizeAction({ type: "@timeout" })).toThrow();
    expect(() => sanitizeAction({ type: "x", pad: "a".repeat(5000) })).toThrow("too large");
    const m = startMatch(highcard, makePlayers(2), {}, 7, 0);
    expect(() => applyAction(highcard, m, { id: "nobody", isHost: false }, { type: "pick", card: "AS" }, 0)).toThrow(
      "not playing",
    );
    expect(() => applyAction(highcard, m, { id: "p0", isHost: true }, { type: "nextRound" }, 0)).toThrow("isn't allowed");
  });
  it("enforces player counts", () => {
    expect(() => startMatch(highcard, makePlayers(1), {}, 1, 0)).toThrow("at least 2");
  });
  it("is deterministic for the same seed", () => {
    const a = startMatch(highcard, makePlayers(3), {}, 123, 0);
    const b = startMatch(highcard, makePlayers(3), {}, 123, 0);
    expect(a.state).toEqual(b.state);
  });
});

describe("example game: highcard", () => {
  it("hides other players' hands and picks", () => {
    const h = createHarness(highcard, { players: 3, seed: 5 });
    const st = h.state as { hands: Record<string, string[]> };
    const v0 = h.view("p0");
    expect(findLeaks(v0, [...st.hands.p1, ...st.hands.p2])).toEqual([]);
    expect(findLeaks(h.view(null), [...st.hands.p0, ...st.hands.p1, ...st.hands.p2])).toEqual([]);
    const card = st.hands.p1[0];
    h.act("p1", { type: "pick", card });
    expect(findLeaks(h.view("p0"), [card])).toEqual([]);
    expect(h.view("p1")).toMatchObject({ myPick: card });
  });
  it("plays a round and lets only the host advance", () => {
    const h = createHarness(highcard, { players: 2, settings: { handSize: 1 } });
    const st = h.state as { hands: Record<string, string[]> };
    h.act("p0", { type: "pick", card: st.hands.p0[0] });
    expect(h.tryAct("p0", { type: "pick", card: st.hands.p0[0] })).toMatch(/isn't allowed/);
    h.act("p1", { type: "pick", card: st.hands.p1[0] });
    expect(h.legal("p1")).toEqual([]);
    expect(h.legal("p0")).toEqual([{ type: "nextRound" }]);
    h.act("p0", { type: "nextRound" });
    expect(h.match.over).toBe(true);
    expect(h.envelope("p0").scores).toHaveLength(2);
  });
});
