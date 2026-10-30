// @vitest-environment edge-runtime
/** Backend tests: real Convex functions against convex-test's in-memory database. */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/!(*.test).*s");

function setup() {
  return convexTest(schema, modules);
}

async function roomWith(t: ReturnType<typeof setup>, names: string[]) {
  const { code } = await t.mutation(api.rooms.create, { name: names[0], token: "tok0" });
  for (let i = 1; i < names.length; i++) await t.mutation(api.rooms.join, { code, name: names[i], token: `tok${i}` });
  await t.mutation(api.rooms.selectGame, { code, token: "tok0", gameId: "highcard" });
  return code;
}

describe("rooms", () => {
  it("creates a 4-letter room, joins, rejoins the same seat and dedupes names", async () => {
    const t = setup();
    const { code } = await t.mutation(api.rooms.create, { name: "Asha", token: "a" });
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    const first = await t.mutation(api.rooms.join, { code: code.toLowerCase(), name: "Ravi", token: "r" });
    const again = await t.mutation(api.rooms.join, { code, name: "Ravi", token: "r" });
    expect(again.playerId).toBe(first.playerId);
    await t.mutation(api.rooms.join, { code, name: "asha", token: "x" });
    const lobby = await t.query(api.rooms.lobby, { code, token: "a" });
    if (!lobby.exists) throw new Error("room missing");
    expect(lobby.players.map((p) => p.name)).toEqual(["Asha", "Ravi", "asha 2"]);
    expect(lobby.players[0].isHost).toBe(true);
    expect(JSON.stringify(lobby)).not.toMatch(/"(a|r|x)"/); // tokens never leave the server
  });

  it("only the host can change the game, house rules or start", async () => {
    const t = setup();
    const code = await roomWith(t, ["Host", "Guest"]);
    await expect(t.mutation(api.rooms.start, { code, token: "tok1" })).rejects.toThrow(/Only the host/);
    await expect(t.mutation(api.rooms.updateSettings, { code, token: "tok1", gameId: "highcard", settings: {} })).rejects.toThrow(
      /Only the host/,
    );
    await t.mutation(api.rooms.updateSettings, { code, token: "tok0", gameId: "highcard", settings: { handSize: 2 } });
    const lobby = await t.query(api.rooms.lobby, { code, token: "tok1" });
    expect(lobby.exists && lobby.settings.highcard).toEqual({ handSize: 2 });
  });

  it("unknown rooms report exists:false", async () => {
    const t = setup();
    expect(await t.query(api.rooms.lobby, { code: "ZZZZ", token: "a" })).toEqual({ exists: false });
    await expect(t.mutation(api.rooms.join, { code: "ZZZZ", name: "A", token: "a" })).rejects.toThrow(/No room/);
  });
});

describe("matches", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs a match server-side and never sends other players' hidden cards", async () => {
    const t = setup();
    const code = await roomWith(t, ["Host", "Guest"]);
    await t.mutation(api.rooms.updateSettings, { code, token: "tok0", gameId: "highcard", settings: { handSize: 1 } });
    await t.mutation(api.rooms.start, { code, token: "tok0" });

    const v0 = (await t.query(api.game.view, { code, token: "tok0" }))!;
    const v1 = (await t.query(api.game.view, { code, token: "tok1" }))!;
    const hand0 = (v0.view as { myHand: string[] }).myHand;
    const hand1 = (v1.view as { myHand: string[] }).myHand;
    expect(hand0).toHaveLength(1);
    expect(JSON.stringify(v0)).not.toContain(`"${hand1[0]}"`);
    expect(JSON.stringify(v1)).not.toContain(`"${hand0[0]}"`);

    await expect(t.mutation(api.game.act, { code, token: "tok1", action: { type: "pick", card: hand0[0] } })).rejects.toThrow(
      /isn't allowed/,
    );
    await t.mutation(api.game.act, { code, token: "tok0", action: { type: "pick", card: hand0[0] } });
    await t.mutation(api.game.act, { code, token: "tok1", action: { type: "pick", card: hand1[0] } });
    await expect(t.mutation(api.game.act, { code, token: "tok1", action: { type: "nextRound" } })).rejects.toThrow();
    await t.mutation(api.game.act, { code, token: "tok0", action: { type: "nextRound" } });
    const end = (await t.query(api.game.view, { code, token: "tok1" }))!;
    expect(end.over).toBe(true);
    expect(end.scores).toHaveLength(2);

    await t.mutation(api.rooms.endMatch, { code, token: "tok0" });
    const lobby = await t.query(api.rooms.lobby, { code, token: "tok0" });
    expect(lobby.exists && lobby.status).toBe("lobby");
  });

  it("late joiners spectate and see no hands", async () => {
    const t = setup();
    const code = await roomWith(t, ["Host", "Guest"]);
    await t.mutation(api.rooms.start, { code, token: "tok0" });
    await t.mutation(api.rooms.join, { code, name: "Late", token: "late" });
    const v = (await t.query(api.game.view, { code, token: "late" }))!;
    expect(v.me).toBeNull();
    expect(v.legal).toEqual([]);
    expect((v.view as { myHand: string[] }).myHand).toEqual([]);
    await expect(t.mutation(api.game.act, { code, token: "late", action: { type: "pick", card: "AS" } })).rejects.toThrow(
      /not playing/,
    );
  });

  it("bots take their turns via the scheduler", async () => {
    const t = setup();
    const code = await roomWith(t, ["Host"]);
    await t.mutation(api.rooms.addBot, { code, token: "tok0" });
    await t.mutation(api.rooms.updateSettings, { code, token: "tok0", gameId: "highcard", settings: { handSize: 1 } });
    await t.mutation(api.rooms.start, { code, token: "tok0" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const v = (await t.query(api.game.view, { code, token: "tok0" }))!;
    const botId = v.players.find((p) => p.id !== v.me)!.id;
    expect((v.view as { picked: Record<string, boolean> }).picked[botId]).toBe(true);
    const myCard = (v.view as { myHand: string[] }).myHand[0];
    await t.mutation(api.game.act, { code, token: "tok0", action: { type: "pick", card: myCard } });
    await t.mutation(api.game.act, { code, token: "tok0", action: { type: "nextRound" } });
    expect((await t.query(api.game.view, { code, token: "tok0" }))!.over).toBe(true);
  });
});
