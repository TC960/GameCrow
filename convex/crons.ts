import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Delete rooms (and their players and matches) idle for a day. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    const stale = await ctx.db
      .query("rooms")
      .withIndex("by_lastActive", (q) => q.lt("lastActiveAt", cutoff))
      .take(50);
    for (const room of stale) {
      for (const p of await ctx.db.query("players").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect()) {
        await ctx.db.delete(p._id);
      }
      for (const m of await ctx.db.query("matches").withIndex("by_room", (q) => q.eq("roomId", room._id)).collect()) {
        await ctx.db.delete(m._id);
      }
      await ctx.db.delete(room._id);
    }
  },
});

const crons = cronJobs();
crons.interval("cleanup idle rooms", { hours: 1 }, internal.crons.cleanup, {});
export default crons;
