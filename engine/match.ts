/**
 * The pure match runner. Convex mutations, the dev sandbox and tests all go through
 * these functions, so a game behaves identically everywhere.
 */
import { fail, GameError, isGameError } from "./errors";
import { FREE_NUMBER, FREE_TEXT, isLegal } from "./helpers";
import { createRng, rngFor, type Rng } from "./rng";
import { resolveSettings } from "./settings";
import {
  SYSTEM_ACTOR,
  TIMEOUT_ACTION,
  type Actor,
  type AnyGamePlugin,
  type GameAction,
  type Json,
  type MatchView,
  type PlayerId,
  type PlayerInfo,
  type SettingsValues,
} from "./types";

/** Everything needed to continue a match. Stored by the server as JSON. */
export interface MatchRecord {
  gameId: string;
  seed: number;
  /** Actions applied so far. */
  seq: number;
  players: PlayerInfo[];
  settings: SettingsValues;
  state: unknown;
  over: boolean;
}

/** Max serialized size of one action (bytes of JSON). */
export const MAX_ACTION_BYTES = 4096;

/** Checks the player count and house rules a host is about to start with. Returns a message or null. */
export function startProblem(plugin: AnyGamePlugin, players: readonly PlayerInfo[], rawSettings: unknown): string | null {
  const { minPlayers, maxPlayers, name } = plugin.meta;
  if (players.length < minPlayers) return `${name} needs at least ${minPlayers} players`;
  if (players.length > maxPlayers) return `${name} allows at most ${maxPlayers} players`;
  const settings = resolveSettings(plugin.settings, rawSettings);
  return plugin.validateSettings?.(settings, [...players]) ?? null;
}

export function startMatch(
  plugin: AnyGamePlugin,
  players: readonly PlayerInfo[],
  rawSettings: unknown,
  seed: number,
  now: number,
): MatchRecord {
  const problem = startProblem(plugin, players, rawSettings);
  if (problem) fail(problem);
  const seated = players.map((p, i) => ({ id: p.id, name: p.name, seat: i }));
  const settings = resolveSettings(plugin.settings, rawSettings);
  const state = plugin.setup(seated, settings, { rng: rngFor(seed, 0), now });
  return { gameId: plugin.meta.id, seed, seq: 0, players: seated, settings, state, over: plugin.isOver(state) };
}

/** Validates the raw client payload is a small JSON object with a string `type`. */
export function sanitizeAction(raw: unknown): GameAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid action");
  let text: string;
  try {
    text = JSON.stringify(raw);
  } catch {
    fail("Invalid action");
  }
  if (text.length > MAX_ACTION_BYTES) fail("Action too large");
  const action = JSON.parse(text) as GameAction;
  if (typeof action.type !== "string" || action.type.startsWith("@")) fail("Invalid action");
  return action;
}

function reduceChecked(plugin: AnyGamePlugin, match: MatchRecord, actor: Actor, action: GameAction, now: number): MatchRecord {
  const seq = match.seq + 1;
  const state = plugin.reduce(match.state, action, { actor, rng: rngFor(match.seed, seq), now });
  if (state === undefined || state === null) throw new Error(`${plugin.meta.id}.reduce returned ${state}`);
  return { ...match, seq, state, over: plugin.isOver(state) };
}

/**
 * Apply a player's action. Throws GameError (message is safe to show) when it is not allowed.
 * Every action must match an entry of legalActions(state, actor) before reduce() sees it.
 */
export function applyAction(
  plugin: AnyGamePlugin,
  match: MatchRecord,
  actor: Actor,
  rawAction: unknown,
  now: number,
): MatchRecord {
  if (match.over) fail("This game is over");
  if (!match.players.some((p) => p.id === actor.id)) fail("You're not playing in this game");
  const action = sanitizeAction(rawAction);
  const legal = plugin.legalActions(match.state, actor) as GameAction[];
  if (!isLegal(legal, action)) fail("That move isn't allowed right now");
  return reduceChecked(plugin, match, actor, action, now);
}

/** Fire the plugin's deadline if it has passed. Returns null when nothing is due. */
export function applyTimeout(plugin: AnyGamePlugin, match: MatchRecord, now: number): MatchRecord | null {
  if (match.over || !plugin.deadline) return null;
  const due = plugin.deadline(match.state);
  if (due === null || due > now) return null;
  return reduceChecked(plugin, match, SYSTEM_ACTOR, { ...TIMEOUT_ACTION }, now);
}

/** The envelope one client receives. `viewer` null = spectator. */
export function buildView(
  plugin: AnyGamePlugin,
  match: MatchRecord,
  viewer: PlayerId | null,
  isHost: boolean,
): MatchView {
  const seated = viewer !== null && match.players.some((p) => p.id === viewer);
  const me = seated ? viewer : null;
  const legal = me !== null && !match.over ? (plugin.legalActions(match.state, { id: me, isHost }) as GameAction[]) : [];
  return {
    gameId: match.gameId,
    seq: match.seq,
    me,
    players: match.players,
    view: plugin.viewFor(match.state, me),
    legal,
    active: match.over ? [] : plugin.activePlayers(match.state),
    scores: plugin.scores(match.state),
    over: match.over,
    deadline: plugin.deadline?.(match.state) ?? null,
  };
}

const BOT_WORDS = ["banana", "a tiny horse", "the moon", "grandma", "pickles", "42", "a goose", "my left shoe", "Tuesday", "jalebi"];

function fillFree(value: Json, rng: Rng): Json {
  if (value === FREE_TEXT) return rng.pick(BOT_WORDS);
  if (value === FREE_NUMBER) return 0;
  if (Array.isArray(value)) return value.map((v) => fillFree(v, rng));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillFree(v, rng)]));
  }
  return value;
}

function botRng(match: MatchRecord, botId: PlayerId): Rng {
  const seat = match.players.findIndex((p) => p.id === botId);
  return createRng(match.seed ^ 0x5bd1e995, (match.seq + 1) * 64 + seat);
}

/** The action a bot would take now, or null if it has nothing to do. Bots see only their own view. */
export function chooseBotAction(plugin: AnyGamePlugin, match: MatchRecord, botId: PlayerId): GameAction | null {
  if (match.over) return null;
  const actor = { id: botId, isHost: false };
  const legal = plugin.legalActions(match.state, actor) as GameAction[];
  if (legal.length === 0) return null;
  const rng = botRng(match, botId);
  const picked = plugin.botAction ? plugin.botAction(plugin.viewFor(match.state, botId), legal, rng) : rng.pick(legal);
  return fillFree(picked as Json, rng) as GameAction;
}

/** Convert anything thrown by a plugin into a player-safe message. */
export function errorMessage(e: unknown): string {
  if (isGameError(e)) return e.message;
  return "Something went wrong. Try again.";
}

export { GameError };
