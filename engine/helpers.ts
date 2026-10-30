/** Small pure helpers for rules and UI code. */
import type { GameAction, Json, PlayerId, PlayerInfo, ScoreLine } from "./types";

/**
 * Placeholders for free-form fields in legalActions(). A legal entry
 * `{ type: "answer", text: FREE_TEXT }` matches any string `text`; FREE_NUMBER matches any finite number.
 * reduce() must still validate the value (length, range, profanity...).
 */
export const FREE_TEXT = "<<free-text>>";
export const FREE_NUMBER = "<<free-number>>";

function matchesValue(template: Json | undefined, value: Json | undefined): boolean {
  if (template === FREE_TEXT) return typeof value === "string";
  if (template === FREE_NUMBER) return typeof value === "number" && Number.isFinite(value);
  if (template === null || typeof template !== "object") return template === value;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(template) !== Array.isArray(value)) return false;
  if (Array.isArray(template)) {
    const arr = value as Json[];
    return template.length === arr.length && template.every((t, i) => matchesValue(t, arr[i]));
  }
  const obj = value as { [k: string]: Json };
  const keys = new Set([...Object.keys(template), ...Object.keys(obj)]);
  for (const k of keys) if (!matchesValue(template[k], obj[k])) return false;
  return true;
}

/** True when `action` matches one entry of `legal` (structural equality + FREE_* placeholders). */
export function isLegal<A extends GameAction>(legal: readonly A[], action: GameAction): boolean {
  return legal.some((l) => matchesValue(l as Json, action as Json));
}

/** Legal actions of one type, typed. `legalOfType(legal, "play")`. */
export function legalOfType<A extends GameAction, T extends A["type"]>(
  legal: readonly A[],
  type: T,
): Extract<A, { type: T }>[] {
  return legal.filter((a) => a.type === type) as Extract<A, { type: T }>[];
}

/** Players in seat order. */
export function bySeat(players: readonly PlayerInfo[]): PlayerInfo[] {
  return players.slice().sort((a, b) => a.seat - b.seat);
}

/** Next player clockwise after `id` (wraps), optionally skipping some. */
export function nextPlayer(order: readonly PlayerId[], id: PlayerId, skip: (p: PlayerId) => boolean = () => false): PlayerId {
  const i = order.indexOf(id);
  if (i < 0) throw new Error(`nextPlayer: unknown player ${id}`);
  for (let k = 1; k <= order.length; k++) {
    const p = order[(i + k) % order.length];
    if (!skip(p)) return p;
  }
  return id;
}

/**
 * Turn raw totals into ScoreLines with competition ranking (1,1,3...).
 * `higherIsBetter` false for games like Hearts where low scores win.
 */
export function rankScores(totals: Record<PlayerId, number>, higherIsBetter = true): ScoreLine[] {
  const lines = Object.entries(totals).map(([playerId, score]) => ({ playerId, score }));
  lines.sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));
  return lines.map((l) => ({
    ...l,
    rank: 1 + lines.filter((o) => (higherIsBetter ? o.score > l.score : o.score < l.score)).length,
  }));
}

/** Deep, JSON-only clone (state is JSON, so this is safe and simple). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
