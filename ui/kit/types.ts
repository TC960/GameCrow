import type { GameAction, PlayerId, PlayerInfo, ScoreLine } from "../../engine/types";

/** A seated player plus live room info. */
export interface SeatInfo extends PlayerInfo {
  online: boolean;
  isBot: boolean;
  isHost: boolean;
}

/** Props every games/<name>/ui.tsx default export receives from the shell. */
export interface GameUIProps<V = unknown, A extends GameAction = GameAction> {
  /** viewFor(state, me) computed on the server. */
  view: V;
  /** My player id, or null when spectating. */
  me: PlayerId | null;
  /** Players in this match, in seat order. */
  players: SeatInfo[];
  /** Actions I may send right now (legalActions on the server). Empty when not my turn. */
  legal: A[];
  /** Players the game is waiting on. */
  active: PlayerId[];
  isHost: boolean;
  scores: ScoreLine[];
  over: boolean;
  /** Plugin deadline (epoch ms) if the game uses timers. */
  deadline: number | null;
  /**
   * Send an action. Resolves true on success. On failure the shell already showed the error
   * toast and it resolves false, so you rarely need to handle errors yourself.
   */
  act(action: A): Promise<boolean>;
  /** true while an action is in flight; disable your primary buttons. */
  pending: boolean;
}
