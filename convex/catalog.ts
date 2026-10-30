import { v } from "convex/values";
import { query } from "./_generated/server";
import { GAMES } from "../games/registry";

/** Game list for the lobby: metadata + house-rule schema (pure data). Rules code never ships to clients. */
export const list = query({
  args: { includeHidden: v.optional(v.boolean()) },
  handler: async (_ctx, { includeHidden }) => {
    return Object.values(GAMES)
      .filter((g) => includeHidden || !g.meta.hidden)
      .map((g) => ({ meta: g.meta, settings: g.settings }));
  },
});
