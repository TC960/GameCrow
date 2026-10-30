/**
 * GameCrow engine contract types. See ENGINE_CONTRACT.md for the rules that go with them.
 * This module is pure TypeScript: no React, no Convex, no DOM. It runs on the server and in tests.
 */
import type { Rng } from "./rng";

/** Stable id of a seated player (a Convex document id in production, any string in tests). */
export type PlayerId = string;

/** JSON-safe value. Game state, actions and views must be made only of these. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A seated player as the game sees them. Seat 0..n-1 is table order (clockwise). */
export interface PlayerInfo {
  id: PlayerId;
  name: string;
  seat: number;
}

/** Who is acting. `isHost` is the room host at the moment the action is sent. */
export interface Actor {
  id: PlayerId;
  isHost: boolean;
}

/** Actor used when the engine fires a timeout (see GamePlugin.deadline). */
export const SYSTEM_ACTOR: Actor = { id: "@system", isHost: false };
/** Action the engine sends when a deadline passes. */
export const TIMEOUT_ACTION = { type: "@timeout" } as const;

/** Every action is a JSON object with a string `type`. */
export interface GameAction {
  type: string;
  [key: string]: Json;
}

// ---------------------------------------------------------------------------
// Settings ("house rules")
// ---------------------------------------------------------------------------

export type SettingValue = number | boolean | string | string[];
export type SettingsValues = Record<string, SettingValue>;

/** Show a field only when another field has one of the given values. */
export interface VisibleIf {
  key: string;
  in: SettingValue[];
}

interface FieldBase<T extends string, D> {
  type: T;
  key: string;
  label: string;
  help?: string;
  /** Section header the field is listed under in the settings editor. */
  group?: string;
  default: D;
  visibleIf?: VisibleIf;
}

export interface NumberField extends FieldBase<"number", number> {
  min: number;
  max: number;
  step?: number;
}
export type BooleanField = FieldBase<"boolean", boolean>;
export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectField extends FieldBase<"select", string> {
  options: SelectOption[];
}
export interface MultiSelectField extends FieldBase<"multiselect", string[]> {
  options: SelectOption[];
  minSelected?: number;
}
export interface TextField extends FieldBase<"text", string> {
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
}

/** Pure data (no functions) so the server can send the schema to the lobby. */
export type SettingField = NumberField | BooleanField | SelectField | MultiSelectField | TextField;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface GameMeta {
  /** URL-safe id, equal to the folder name under games/. */
  id: string;
  name: string;
  /** One line shown on the lobby card. */
  tagline: string;
  emoji: string;
  category: "cards" | "party";
  minPlayers: number;
  maxPlayers: number;
  /** Short "how to play" bullets shown in the in-game menu. */
  howToPlay: string[];
  /** Screen orientation the UI needs. Default "portrait"; the shell shows a rotate prompt on mismatch. */
  orientation?: "portrait" | "landscape" | "any";
  /** Hidden from the production lobby (examples, works in progress). */
  hidden?: boolean;
}

export interface SetupContext {
  rng: Rng;
  /** Server clock (ms since epoch) when the match starts. */
  now: number;
}

export interface ReduceContext {
  actor: Actor;
  rng: Rng;
  /** Server clock (ms since epoch) when the action is applied. */
  now: number;
}

/** One line of the standings. rank 1 = best; ties share a rank. */
export interface ScoreLine {
  playerId: PlayerId;
  score: number;
  rank: number;
}

export interface GamePlugin<
  S = unknown,
  A extends GameAction = GameAction,
  V = unknown,
  Settings extends SettingsValues = SettingsValues,
> {
  meta: GameMeta;
  /** House-rule schema. Values reach setup() already resolved (defaults filled, numbers clamped). */
  settings: SettingField[];
  /** Optional extra start check; return a message to block the host from starting. */
  validateSettings?(settings: Settings, players: PlayerInfo[]): string | null;

  setup(players: PlayerInfo[], settings: Settings, ctx: SetupContext): S;
  /**
   * Every action `actor` may send now. Return [] when the actor has nothing to do.
   * The engine rejects any action not matching an entry (see FREE_TEXT / FREE_NUMBER).
   */
  legalActions(state: S, actor: Actor): A[];
  /** Pure + deterministic: same (state, action, ctx) gives the same result. Must not mutate `state`. */
  reduce(state: S, action: A, ctx: ReduceContext): S;
  /** What `playerId` may see. `null` = spectator. Must never contain other players' secrets. */
  viewFor(state: S, playerId: PlayerId | null): V;
  /** Players the game is waiting on (drives "your turn" + haptics). Public information. */
  activePlayers(state: S): PlayerId[];
  isOver(state: S): boolean;
  /** Current standings (public). Called mid-game for the live scoreboard and at the end. */
  scores(state: S): ScoreLine[];
  /** Optional epoch-ms deadline. When it passes, the engine calls reduce(state, TIMEOUT_ACTION, SYSTEM_ACTOR). */
  deadline?(state: S): number | null;
  /** Optional bot policy. It sees only the bot's own view. Default: a random legal action. */
  botAction?(view: V, legal: A[], rng: Rng): A;
}

/** Any plugin, for registries. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGamePlugin = GamePlugin<any, any, any, any>;

/** Identity helper that gives plugins full type inference. */
export function defineGame<S, A extends GameAction, V, Settings extends SettingsValues>(
  plugin: GamePlugin<S, A, V, Settings>,
): GamePlugin<S, A, V, Settings> {
  return plugin;
}

// ---------------------------------------------------------------------------
// What a client receives
// ---------------------------------------------------------------------------

/** The per-player envelope the server sends to each client. */
export interface MatchView<V = unknown, A extends GameAction = GameAction> {
  gameId: string;
  /** Number of actions applied so far. */
  seq: number;
  /** null = spectator (joined after the match started). */
  me: PlayerId | null;
  players: PlayerInfo[];
  view: V;
  legal: A[];
  active: PlayerId[];
  scores: ScoreLine[];
  over: boolean;
  deadline: number | null;
}
