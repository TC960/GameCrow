import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { randomSeed, startMatch, startProblem, errorMessage, type PlayerInfo } from "../engine/server";
import { GAMES } from "../games/registry";
import {
  HOST_CLAIM_AFTER_MS,
  MAX_SEATS,
  ONLINE_WINDOW_MS,
  cleanName,
  parseSettings,
  playerByToken,
  requireGame,
  requireHost,
  requireMe,
  requireRoom,
  roomByCode,
  roomPlayers,
  saveRecord,
  userError,
} from "./lib";

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const BOT_NAMES = ["Robo Raju", "Chip", "Botty", "Tinker", "Pixel", "Sprocket", "Widget", "Gizmo"];

function defaultGameId(): string {
  const visible = Object.values(GAMES).filter((g) => !g.meta.hidden);
  return (visible[0] ?? Object.values(GAMES)[0]).meta.id;
}

async function uniqueName(ctx: MutationCtx, roomId: Id<"rooms">, name: string, selfId?: Id<"players">) {
  const taken = new Set(
    (await roomPlayers(ctx, roomId)).filter((p) => p._id !== selfId).map((p) => p.name.toLowerCase()),
  );
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
}

export const create = mutation({
  args: { name: v.string(), token: v.string() },
  handler: async (ctx, { name, token }) => {
    const now = Date.now();
    let code = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
      if (!(await roomByCode(ctx, code))) break;
      code = "";
    }
    if (!code) userError("Couldn't make a room code, try again");
    const roomId = await ctx.db.insert("rooms", {
      code,
      gameId: defaultGameId(),
      settingsJson: "{}",
      status: "lobby",
      lastActiveAt: now,
    });
    const hostId = await ctx.db.insert("players", {
      roomId,
      token,
      name: cleanName(name),
      joinedAt: now,
      lastSeenAt: now,
      isBot: false,
      kicked: false,
    });
    await ctx.db.patch(roomId, { hostId });
    return { code };
  },
});

/** Join, or rejoin the same seat when this device's token is already in the room. */
export const join = mutation({
  args: { code: v.string(), name: v.string(), token: v.string() },
  handler: async (ctx, { code, name, token }) => {
    const now = Date.now();
    const room = await requireRoom(ctx, code);
    const existing = await ctx.db
      .query("players")
      .withIndex("by_room_token", (q) => q.eq("roomId", room._id).eq("token", token))
      .unique();
    if (existing?.kicked) userError("The host removed you from this room");
    const clean = cleanName(name);
    if (existing) {
      const next = existing.name === clean ? clean : await uniqueName(ctx, room._id, clean, existing._id);
      await ctx.db.patch(existing._id, { name: next, lastSeenAt: now });
      return { playerId: existing._id };
    }
    const players = await roomPlayers(ctx, room._id);
    if (players.length >= MAX_SEATS) userError("This room is full");
    const playerId = await ctx.db.insert("players", {
      roomId: room._id,
      token,
      name: await uniqueName(ctx, room._id, clean),
      joinedAt: now,
      lastSeenAt: now,
      isBot: false,
      kicked: false,
    });
    if (!room.hostId) await ctx.db.patch(room._id, { hostId: playerId });
    await ctx.db.patch(room._id, { lastActiveAt: now });
    return { playerId };
  },
});

/** Room + lobby state for one device. Returns null fields rather than throwing for unknown rooms. */
export const lobby = query({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const room = await roomByCode(ctx, code);
    if (!room) return { exists: false as const };
    const me = await playerByToken(ctx, room._id, token);
    const players = await roomPlayers(ctx, room._id);
    const match = room.matchId ? await ctx.db.get(room.matchId) : null;
    const inMatch = new Set<string>(
      match ? (JSON.parse(match.recordJson) as { players: PlayerInfo[] }).players.map((p) => p.id) : [],
    );
    const now = Date.now();
    const host = players.find((p) => p._id === room.hostId);
    return {
      exists: true as const,
      code: room.code,
      status: room.status,
      gameId: room.gameId,
      settings: parseSettings(room),
      hostId: room.hostId ?? null,
      meId: me?._id ?? null,
      hostClaimable: !!me && !me.isBot && room.hostId !== me._id && (!host || now - host.lastSeenAt > HOST_CLAIM_AFTER_MS),
      matchId: room.matchId ?? null,
      matchOver: match?.over ?? false,
      players: players.map((p) => ({
        id: p._id,
        name: p.name,
        isBot: p.isBot,
        isHost: p._id === room.hostId,
        online: p.isBot || now - p.lastSeenAt < ONLINE_WINDOW_MS,
        inMatch: inMatch.has(p._id),
      })),
    };
  },
});

export const heartbeat = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const room = await roomByCode(ctx, code);
    if (!room) return;
    const me = await playerByToken(ctx, room._id, token);
    if (me) await ctx.db.patch(me._id, { lastSeenAt: Date.now() });
  },
});

export const selectGame = mutation({
  args: { code: v.string(), token: v.string(), gameId: v.string() },
  handler: async (ctx, { code, token, gameId }) => {
    const { room } = await requireHost(ctx, code, token);
    if (room.status !== "lobby") userError("Finish the current game first");
    requireGame(gameId);
    await ctx.db.patch(room._id, { gameId, lastActiveAt: Date.now() });
  },
});

export const updateSettings = mutation({
  args: { code: v.string(), token: v.string(), gameId: v.string(), settings: v.any() },
  handler: async (ctx, { code, token, gameId, settings }) => {
    const { room } = await requireHost(ctx, code, token);
    if (room.status !== "lobby") userError("House rules can only change between games");
    requireGame(gameId);
    const text = JSON.stringify(settings ?? {});
    if (text.length > 20_000) userError("Settings too large");
    const all = parseSettings(room);
    all[gameId] = JSON.parse(text);
    await ctx.db.patch(room._id, { settingsJson: JSON.stringify(all), lastActiveAt: Date.now() });
  },
});

export const addBot = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room } = await requireHost(ctx, code, token);
    const players = await roomPlayers(ctx, room._id);
    if (players.length >= MAX_SEATS) userError("This room is full");
    const used = new Set(players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${players.length + 1}`;
    const now = Date.now();
    await ctx.db.insert("players", {
      roomId: room._id,
      token: `bot:${crypto.randomUUID()}`,
      name,
      joinedAt: now,
      lastSeenAt: now,
      isBot: true,
      kicked: false,
    });
  },
});

/** Host removes a player or bot. Players removed mid-match keep their seat in that match. */
export const removePlayer = mutation({
  args: { code: v.string(), token: v.string(), playerId: v.id("players") },
  handler: async (ctx, { code, token, playerId }) => {
    const { room, me } = await requireHost(ctx, code, token);
    if (playerId === me._id) userError("Use Leave room instead");
    const target = await ctx.db.get(playerId);
    if (!target || target.roomId !== room._id) userError("Player not found");
    if (target.isBot) await ctx.db.delete(playerId);
    else await ctx.db.patch(playerId, { kicked: true });
  },
});

export const transferHost = mutation({
  args: { code: v.string(), token: v.string(), playerId: v.id("players") },
  handler: async (ctx, { code, token, playerId }) => {
    const { room } = await requireHost(ctx, code, token);
    const target = await ctx.db.get(playerId);
    if (!target || target.roomId !== room._id || target.kicked || target.isBot) userError("Pick a person in this room");
    await ctx.db.patch(room._id, { hostId: playerId });
  },
});

/** Any player may take over hosting once the host has been offline for a while. */
export const claimHost = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room, me } = await requireMe(ctx, code, token);
    if (me.isBot) userError("Bots can't host");
    const host = room.hostId ? await ctx.db.get(room.hostId) : null;
    if (host && !host.kicked && Date.now() - host.lastSeenAt < HOST_CLAIM_AFTER_MS) userError("The host is still here");
    await ctx.db.patch(room._id, { hostId: me._id });
  },
});

export const leave = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room, me } = await requireMe(ctx, code, token);
    await ctx.db.patch(me._id, { kicked: true });
    if (room.hostId === me._id) {
      const next = (await roomPlayers(ctx, room._id)).find((p) => !p.isBot && p._id !== me._id);
      await ctx.db.patch(room._id, { hostId: next?._id });
    }
  },
});

export const start = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room } = await requireHost(ctx, code, token);
    if (room.status === "playing") userError("A game is already running");
    const plugin = requireGame(room.gameId);
    const players: PlayerInfo[] = (await roomPlayers(ctx, room._id)).map((p, seat) => ({
      id: p._id,
      name: p.name,
      seat,
    }));
    const rawSettings = parseSettings(room)[room.gameId] ?? {};
    const problem = startProblem(plugin, players, rawSettings);
    if (problem) userError(problem);
    const now = Date.now();
    let record;
    try {
      record = startMatch(plugin, players, rawSettings, randomSeed(), now);
    } catch (e) {
      console.error(e);
      userError(errorMessage(e));
    }
    const matchId = await ctx.db.insert("matches", {
      roomId: room._id,
      gameId: plugin.meta.id,
      recordJson: JSON.stringify(record),
      seq: 0,
      over: record.over,
      startedAt: now,
    });
    await ctx.db.patch(room._id, { status: "playing", matchId, lastActiveAt: now });
    const match = (await ctx.db.get(matchId))!;
    await saveRecord(ctx, match, record, now);
  },
});

/** Host ends the current match (finished or not) and returns everyone to the lobby. */
export const endMatch = mutation({
  args: { code: v.string(), token: v.string() },
  handler: async (ctx, { code, token }) => {
    const { room } = await requireHost(ctx, code, token);
    if (room.matchId) {
      const match = await ctx.db.get(room.matchId);
      if (match && !match.endedAt) await ctx.db.patch(match._id, { endedAt: Date.now() });
    }
    await ctx.db.patch(room._id, { status: "lobby", lastActiveAt: Date.now() });
  },
});
