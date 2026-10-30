import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AnyGamePlugin, MatchRecord } from "../engine/server";
import { getGame } from "../games/registry";

export const ONLINE_WINDOW_MS = 40_000;
export const HOST_CLAIM_AFTER_MS = 60_000;
export const MAX_SEATS = 16;
export const BOT_DELAY_MS = 900;

export function userError(message: string): never {
  throw new ConvexError(message);
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 20);
  if (!n) userError("Enter a nickname");
  return n;
}

export async function roomByCode(ctx: QueryCtx, code: string): Promise<Doc<"rooms"> | null> {
  return ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", normalizeCode(code))).unique();
}

export async function requireRoom(ctx: QueryCtx, code: string): Promise<Doc<"rooms">> {
  const room = await roomByCode(ctx, code);
  if (!room) userError(`No room with code ${normalizeCode(code)}`);
  return room;
}

export async function playerByToken(ctx: QueryCtx, roomId: Id<"rooms">, token: string) {
  const p = await ctx.db
    .query("players")
    .withIndex("by_room_token", (q) => q.eq("roomId", roomId).eq("token", token))
    .unique();
  return p && !p.kicked ? p : null;
}

export async function requireMe(ctx: QueryCtx, code: string, token: string) {
  const room = await requireRoom(ctx, code);
  const me = await playerByToken(ctx, room._id, token);
  if (!me) userError("You're not in this room");
  return { room, me };
}

export async function requireHost(ctx: QueryCtx, code: string, token: string) {
  const { room, me } = await requireMe(ctx, code, token);
  if (room.hostId !== me._id) userError("Only the host can do that");
  return { room, me };
}

export async function roomPlayers(ctx: QueryCtx, roomId: Id<"rooms">) {
  const all = await ctx.db.query("players").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  return all.filter((p) => !p.kicked).sort((a, b) => a.joinedAt - b.joinedAt);
}

export function parseSettings(room: Doc<"rooms">): Record<string, unknown> {
  try {
    return JSON.parse(room.settingsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function requireGame(gameId: string): AnyGamePlugin {
  const g = getGame(gameId);
  if (!g) userError(`Unknown game ${gameId}`);
  return g;
}

export function readRecord(match: Doc<"matches">): MatchRecord {
  return JSON.parse(match.recordJson) as MatchRecord;
}

/** Persist a new record and schedule bots / timeouts that depend on it. */
export async function saveRecord(ctx: MutationCtx, match: Doc<"matches">, record: MatchRecord, now: number) {
  const plugin = requireGame(record.gameId);
  const patch: Partial<Doc<"matches">> = {
    recordJson: JSON.stringify(record),
    seq: record.seq,
    over: record.over,
  };
  if (record.over && !match.over) patch.endedAt = now;

  if (!record.over) {
    const deadline = plugin.deadline?.(record.state) ?? null;
    if (deadline !== null && deadline !== match.scheduledDeadline) {
      await ctx.scheduler.runAt(Math.max(deadline, now), internal.game.timeout, { matchId: match._id });
      patch.scheduledDeadline = deadline;
    }
    await scheduleBots(ctx, match._id, match.roomId, record);
  }
  await ctx.db.patch(match._id, patch);
  await ctx.db.patch(match.roomId, { lastActiveAt: now });
}

/** If a bot has something to do, schedule one bot move for this seq. */
export async function scheduleBots(ctx: MutationCtx, matchId: Id<"matches">, roomId: Id<"rooms">, record: MatchRecord) {
  const bots = (await roomPlayers(ctx, roomId)).filter((p) => p.isBot).map((p) => p._id as string);
  if (!record.players.some((p) => bots.includes(p.id))) return;
  const plugin = requireGame(record.gameId);
  const waiting = plugin.activePlayers(record.state).some((id) => bots.includes(id));
  const anyLegal = waiting || bots.some((id) => plugin.legalActions(record.state, { id, isHost: false }).length > 0);
  if (anyLegal) {
    const jitter = (record.seq * 7919) % 500;
    await ctx.scheduler.runAfter(BOT_DELAY_MS + jitter, internal.game.botTick, { matchId, seq: record.seq });
  }
}
