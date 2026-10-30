/**
 * Server-side game registry (rules only, no UI). Owned by the lead: games are added here during
 * integration. Adding a game needs one line here and one in registry.ui.ts, never an engine change.
 */
import type { AnyGamePlugin } from "../engine";
import highcard from "./highcard/rules";

export const GAMES: Record<string, AnyGamePlugin> = Object.fromEntries(
  [highcard].map((g) => [g.meta.id, g]),
);

export function getGame(id: string): AnyGamePlugin | undefined {
  return GAMES[id];
}
