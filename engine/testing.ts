/**
 * Test helpers for games/<name> tests. Import from "../engine/testing".
 * Everything runs the real engine pipeline (legal-action check, seeded RNG, JSON state).
 */
import { isGameError } from "./errors";
import { applyAction, applyTimeout, buildView, chooseBotAction, startMatch, type MatchRecord } from "./match";
import { randomSeed } from "./rng";
import type { AnyGamePlugin, GameAction, MatchView, PlayerId, PlayerInfo, SettingsValues } from "./types";

/** n players with ids "p0".."p{n-1}" and names "P0".. in seat order. */
export function makePlayers(n: number): PlayerInfo[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seat: i }));
}

/** Recursively freezes a value so tests catch rules that mutate state in place. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** Throws if `value` does not survive a JSON round trip unchanged (undefined, NaN, Map, class...). */
export function assertJsonSafe(value: unknown, label = "value"): void {
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error(`${label}${path} is not a finite number (${v})`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error(`${label}${path} is not a plain object`);
      for (const [k, x] of Object.entries(v as object)) {
        if (x === undefined) throw new Error(`${label}${path}.${k} is undefined (use null or omit the key)`);
        walk(x, `${path}.${k}`);
      }
      return;
    }
    throw new Error(`${label}${path} has unsupported type ${typeof v}`);
  };
  walk(value, "");
}

/** Every secret string that appears anywhere in the JSON of `view`. */
export function findLeaks(view: unknown, secrets: readonly string[]): string[] {
  const text = JSON.stringify(view);
  return secrets.filter((s) => text.includes(JSON.stringify(s)) || text.includes(s));
}

export interface HarnessOptions {
  players?: number | PlayerInfo[];
  settings?: Partial<SettingsValues>;
  seed?: number;
  /** Host player id (default the first player). */
  host?: PlayerId;
  now?: number;
}

export interface Harness<S = unknown, A extends GameAction = GameAction, V = unknown> {
  plugin: AnyGamePlugin;
  match: MatchRecord;
  readonly state: S;
  players: PlayerInfo[];
  host: PlayerId;
  now: number;
  /** Apply through the engine (legal check included). Throws GameError on illegal moves. */
  act(playerId: PlayerId, action: A): S;
  /** Like act() but returns the error message instead of throwing (null when it succeeded). */
  tryAct(playerId: PlayerId, action: A): string | null;
  legal(playerId: PlayerId): A[];
  view(playerId: PlayerId | null): V;
  envelope(playerId: PlayerId | null): MatchView<V, A>;
  /** Move the clock and fire the deadline if due. Returns true if a timeout fired. */
  advanceTime(ms: number): boolean;
  /** Replace the state (e.g. to set up a specific hand). It is frozen and must be JSON-safe. */
  setState(state: S): void;
}

export function createHarness<S = unknown, A extends GameAction = GameAction, V = unknown>(
  plugin: AnyGamePlugin,
  opts: HarnessOptions = {},
): Harness<S, A, V> {
  const players = typeof opts.players === "object" ? opts.players : makePlayers(opts.players ?? plugin.meta.minPlayers);
  const host = opts.host ?? players[0].id;
  let now = opts.now ?? 1_700_000_000_000;
  let match = startMatch(plugin, players, opts.settings ?? {}, opts.seed ?? 1, now);
  assertJsonSafe(match.state, "setup state");
  deepFreeze(match.state);
  const actor = (id: PlayerId) => ({ id, isHost: id === host });

  const h: Harness<S, A, V> = {
    plugin,
    get match() {
      return match;
    },
    set match(m) {
      match = m;
    },
    get state() {
      return match.state as S;
    },
    players: match.players,
    host,
    get now() {
      return now;
    },
    set now(n) {
      now = n;
    },
    act(playerId, action) {
      const next = applyAction(plugin, match, actor(playerId), action, now);
      assertJsonSafe(next.state, `state after ${action.type}`);
      match = { ...next, state: deepFreeze(next.state) };
      return match.state as S;
    },
    tryAct(playerId, action) {
      try {
        h.act(playerId, action);
        return null;
      } catch (e) {
        if (isGameError(e)) return e.message;
        throw e;
      }
    },
    legal: (playerId) => plugin.legalActions(match.state, actor(playerId)) as A[],
    view: (playerId) => plugin.viewFor(match.state, playerId) as V,
    envelope: (playerId) => buildView(plugin, match, playerId, playerId === host) as MatchView<V, A>,
    advanceTime(ms) {
      now += ms;
      const next = applyTimeout(plugin, match, now);
      if (!next) return false;
      match = { ...next, state: deepFreeze(next.state) };
      return true;
    },
    setState(state) {
      assertJsonSafe(state, "setState");
      match = { ...match, state: deepFreeze(state), over: plugin.isOver(state) };
    },
  };
  return h;
}

export interface SimulationResult {
  match: MatchRecord;
  steps: number;
  /** [playerId, action] in order. */
  log: [PlayerId, GameAction][];
}

/**
 * Play a whole game with bots (plugin.botAction, else random legal moves) through the real engine.
 * The host is the first player and also takes host-only actions. Throws if the game stalls or runs
 * longer than maxSteps. Every intermediate state is frozen and JSON-checked.
 */
export function simulateGame(
  plugin: AnyGamePlugin,
  opts: HarnessOptions & { maxSteps?: number } = {},
): SimulationResult {
  const h = createHarness(plugin, { ...opts, seed: opts.seed ?? randomSeed() });
  const maxSteps = opts.maxSteps ?? 20_000;
  const log: [PlayerId, GameAction][] = [];
  let steps = 0;
  while (!h.match.over) {
    if (steps++ > maxSteps) throw new Error(`${plugin.meta.id}: game did not finish in ${maxSteps} steps`);
    // Active players first, then anyone else with something to do (e.g. the host's "next round").
    const active = plugin.activePlayers(h.state);
    const order = [...active, ...h.players.map((p) => p.id).filter((id) => !active.includes(id))];
    let acted = false;
    for (const id of order) {
      const action =
        id === h.host
          ? pickHostAware(plugin, h.match, id)
          : chooseBotAction(plugin, h.match, id);
      if (!action) continue;
      h.act(id, action);
      log.push([id, action]);
      acted = true;
      break;
    }
    if (acted) continue;
    const due = plugin.deadline?.(h.state);
    if (due != null) {
      h.now = Math.max(h.now, due);
      if (h.advanceTime(0)) continue;
    }
    throw new Error(`${plugin.meta.id}: stalled at seq ${h.match.seq}; nobody has a legal action`);
  }
  return { match: h.match, steps, log };
}

function pickHostAware(plugin: AnyGamePlugin, match: MatchRecord, id: PlayerId): GameAction | null {
  const asPlayer = chooseBotAction(plugin, match, id);
  if (asPlayer) return asPlayer;
  const hostLegal = plugin.legalActions(match.state, { id, isHost: true }) as GameAction[];
  return hostLegal[0] ?? null;
}
