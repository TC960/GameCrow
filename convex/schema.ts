import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    hostId: v.optional(v.id("players")),
    /** Game selected in the lobby. */
    gameId: v.string(),
    /** JSON: { [gameId]: settings } so switching games keeps each game's house rules. */
    settingsJson: v.string(),
    matchId: v.optional(v.id("matches")),
    status: v.union(v.literal("lobby"), v.literal("playing")),
    lastActiveAt: v.number(),
  }).index("by_code", ["code"]).index("by_lastActive", ["lastActiveAt"]),

  players: defineTable({
    roomId: v.id("rooms"),
    /** Device secret from localStorage. Never sent to other clients. */
    token: v.string(),
    name: v.string(),
    /** Join order; becomes seat order when a match starts. */
    joinedAt: v.number(),
    lastSeenAt: v.number(),
    isBot: v.boolean(),
    kicked: v.boolean(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_token", ["roomId", "token"]),

  matches: defineTable({
    roomId: v.id("rooms"),
    gameId: v.string(),
    /** JSON of engine MatchRecord (full secret state). Only read server-side. */
    recordJson: v.string(),
    seq: v.number(),
    over: v.boolean(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    /** Deadline we have scheduled a timeout for, to avoid duplicates. */
    scheduledDeadline: v.optional(v.number()),
  }).index("by_room", ["roomId"]),
});
