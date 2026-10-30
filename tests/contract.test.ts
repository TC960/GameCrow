/**
 * Contract checks every registered game must pass (run automatically for new games).
 * Per-game rules tests live in tests/<name>.test.ts.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAMES } from "../games/registry";
import { buildView, startMatch, startProblem } from "../engine/match";
import { lintSchema } from "../engine/settings";
import { assertJsonSafe, makePlayers, simulateGame } from "../engine/testing";

const GAMES_DIR = join(__dirname, "..", "games");

describe.each(Object.values(GAMES).map((g) => [g.meta.id, g] as const))("contract: %s", (id, plugin) => {
  it("meta and settings schema are valid", () => {
    expect(plugin.meta.id).toBe(id);
    expect(existsSync(join(GAMES_DIR, id, "rules.ts"))).toBe(true);
    expect(existsSync(join(GAMES_DIR, id, "ui.tsx"))).toBe(true);
    expect(plugin.meta.minPlayers).toBeGreaterThanOrEqual(1);
    expect(plugin.meta.maxPlayers).toBeGreaterThanOrEqual(plugin.meta.minPlayers);
    expect(lintSchema(plugin.settings)).toEqual([]);
    expect(JSON.parse(JSON.stringify(plugin.settings))).toEqual(plugin.settings);
  });

  const counts = [...new Set([plugin.meta.minPlayers, Math.min(plugin.meta.maxPlayers, plugin.meta.minPlayers + 2), plugin.meta.maxPlayers])];
  it.each(counts)("bots finish a full game with %i players (several seeds)", (n) => {
    // Default house rules may legitimately refuse some counts (e.g. Judgement: 7 cards × 8 players > 52).
    // Such counts must then be covered by the game's own tests with valid settings.
    const problem = startProblem(plugin, makePlayers(n), {});
    if (problem && n !== plugin.meta.minPlayers) {
      console.info(`[contract:${id}] ${n} players skipped with default settings: ${problem}`);
      return;
    }
    for (const seed of [1, 2, 3]) {
      const { match } = simulateGame(plugin, { players: n, seed });
      expect(match.over).toBe(true);
      const scores = plugin.scores(match.state);
      expect(scores.map((s) => s.playerId).sort()).toEqual(makePlayers(n).map((p) => p.id).sort());
      for (const p of [...makePlayers(n).map((p) => p.id), null]) {
        assertJsonSafe(buildView(plugin, match, p, p === "p0"), `final view for ${p}`);
      }
    }
  });

  it("setup and full games are deterministic for a seed", () => {
    const n = plugin.meta.minPlayers;
    expect(startMatch(plugin, makePlayers(n), {}, 99, 0).state).toEqual(startMatch(plugin, makePlayers(n), {}, 99, 0).state);
    expect(simulateGame(plugin, { players: n, seed: 99 }).log).toEqual(simulateGame(plugin, { players: n, seed: 99 }).log);
  });

  it("ui.tsx never pulls rules.ts (or convex) into the client bundle", () => {
    // Walk runtime (non-type) relative imports starting from ui.tsx.
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm;
      for (const m of src.matchAll(re)) {
        const spec = m[1];
        expect(/(^|\/)convex(\/|$)/.test(spec), `${file} imports ${spec}`).toBe(false);
        if (!spec.startsWith(".")) continue;
        const base = join(dirname(file), spec);
        const resolved = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((f) => existsSync(f) && statSync(f).isFile());
        if (!resolved || !/\.tsx?$/.test(resolved)) continue;
        expect(resolved, `${file} imports rules at runtime via ${spec}`).not.toBe(join(GAMES_DIR, id, "rules.ts"));
        visit(resolved);
      }
    };
    visit(join(GAMES_DIR, id, "ui.tsx"));
  });
});
