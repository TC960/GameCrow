import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { applyAction, applyTimeout, buildView, chooseBotAction, errorMessage, isGameError } from "../engine/server";
import { playerByToken, readRecord, requireGame, requireMe, roomByCode, roomPlayers, saveRecord, userError } from "./lib";
import { GameError } from "../engine/errors";

function isLive(room: Doc<"rooms"> | null, match: Doc<"matches">) {
  return !!room && room.status === "playing" && room.matchId === match._id && !match.over;
}

/** The current (or last) match as this device's player may see it. Hidden info never leaves this function. */
export const view = query({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const room = await roomByCode(ctx, code);
    if (!room?.matchId) return null;
    const me = await playerByToken(ctx, room._id, token);
    if (!me) return null;
    const match = await ctx.db.get(room.matchId);
    if (!match) return null;
    const record = readRecord(match);
    return buildView(requireGame(record.gameId), record, me._id, room.hostId === me._id);
  },
});

/** Send a game action. Validated against legalActions() and applied with the plugin's reduce(). */
export const act = mutation({
  args: { code: v.string(), token: v.string(), action: v.any() },
  handler: async (ctx, { code, token, action }) => {
    const { room, me } = await requireMe(ctx, code, token);
    if (room.status !== "playing" || !room.matchId) userError("No game is running");
    const match = (await ctx.db.get(room.matchId))!;
    const record = readRecord(match);
    const plugin = requireGame(record.gameId);
    const now = Date.now();
    let next;
    try {
      next = applyAction(plugin, record, { id: me._id, isHost: room.hostId === me._id }, action, now);
    } catch (e) {
      if (!isGameError(e)) console.error(`[${record.gameId}] action failed`, e);
      userError(errorMessage(e));
    }
    await ctx.db.patch(me._id, { lastSeenAt: now });
    await saveRecord(ctx, match, next, now);
    return { seq: next.seq };
  },
});

/** One bot move. Scheduled by saveRecord(); stale ticks (seq moved on) are ignored. */
export const botTick = internalMutation({
  args: { matchId: v.id("matches"), seq: v.number() },
  handler: async (ctx, { matchId, seq }) => {
    const match = await ctx.db.get(matchId);
    if (!match || match.seq !== seq) return;
    const room = await ctx.db.get(match.roomId);
    if (!isLive(room, match)) return;
    const record = readRecord(match);
    const plugin = requireGame(record.gameId);
    const bots = new Set((await roomPlayers(ctx, match.roomId)).filter((p) => p.isBot).map((p) => p._id as string));
    const active = plugin.activePlayers(record.state);
    const order = [...active, ...record.players.map((p) => p.id).filter((id) => !active.includes(id))];
    const now = Date.now();
    for (const id of order) {
      if (!bots.has(id)) continue;
      const action = chooseBotAction(plugin, record, id);
      if (!action) continue;
      try {
        const next = applyAction(plugin, record, { id, isHost: false }, action, now);
        await saveRecord(ctx, match, next, now);
      } catch (e) {
        console.error(`[${record.gameId}] bot ${id} move rejected`, action, e instanceof GameError ? e.message : e);
      }
      return;
    }
  },
});

/** Fires the plugin's deadline (scheduled by saveRecord()). */
export const timeout = internalMutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const match = await ctx.db.get(matchId);
    if (!match) return;
    const room = await ctx.db.get(match.roomId);
    if (!isLive(room, match)) return;
    const record = readRecord(match);
    const now = Date.now();
    const next = applyTimeout(requireGame(record.gameId), record, now);
    if (next) await saveRecord(ctx, { ...match, scheduledDeadline: undefined }, next, now);
  },
});
