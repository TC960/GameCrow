/**
 * Public types and constants for Raja Mantri Chor Sipahi (shared by rules.ts, ui.tsx and tests).
 * Nothing here is secret: role names, emojis and the role order are public vocabulary.
 * A "leak" in this game is an association player -> hidden role, never a role name on its own.
 */
import type { PlayerId } from "../../engine";

/** Every role id. The first four are always in play; the rest join one per extra player. */
export type Role = "raja" | "mantri" | "sipahi" | "chor" | "rani" | "sainik" | "daku" | "pandit";

/** Roles in deal order: with n players the first n roles are in play (4 -> base, 5 -> + Rani, ... 8 -> + Pandit). */
export const ROLE_ORDER: readonly Role[] = ["raja", "mantri", "sipahi", "chor", "rani", "sainik", "daku", "pandit"];
export const BASE_ROLES: readonly Role[] = ["raja", "mantri", "sipahi", "chor"];
/** Extra roles for 5-8 players, in the order they are added. */
export const EXTRA_ROLES: readonly Role[] = ["rani", "sainik", "daku", "pandit"];

export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  raja: "Raja",
  mantri: "Mantri",
  sipahi: "Sipahi",
  chor: "Chor",
  rani: "Rani",
  sainik: "Sainik",
  daku: "Daku",
  pandit: "Pandit",
};

export const ROLE_EMOJI: Readonly<Record<Role, string>> = {
  raja: "👑",
  mantri: "🎩",
  sipahi: "🛡️",
  chor: "🦹",
  rani: "👸",
  sainik: "⚔️",
  daku: "🗡️",
  pandit: "📜",
};

/** Settings key holding each role's points. */
export const ROLE_POINTS_KEY = {
  raja: "pointsRaja",
  mantri: "pointsMantri",
  sipahi: "pointsSipahi",
  chor: "pointsChor",
  rani: "pointsRani",
  sainik: "pointsSainik",
  daku: "pointsDaku",
  pandit: "pointsPandit",
} as const satisfies Record<Role, string>;

/** Default points per role (also the settings defaults). */
export const DEFAULT_ROLE_POINTS: Readonly<Record<Role, number>> = {
  raja: 1000,
  mantri: 800,
  sipahi: 500,
  chor: 0,
  rani: 900,
  sainik: 300,
  daku: 100,
  pandit: 600,
};

export type GuesserRole = "mantri" | "sipahi";
/**
 * What happens on a wrong guess.
 * - "swap": the Chor scores the guesser's role points; the guesser scores 0.
 * - "zero": the guesser scores 0; the Chor scores the Chor's points as usual.
 * Everyone else always scores their own role's points.
 */
export type WrongGuessRule = "swap" | "zero";

export type Settings = {
  /** Number of rounds, 1-20 (default 5). */
  rounds: number;
  /** Which role must find the Chor (default "mantri"). */
  guesser: GuesserRole;
  /** The Raja is shown to everyone at the start of each round (default true). */
  revealRaja: boolean;
  /** Default "swap". */
  wrongGuess: WrongGuessRule;
  /** Points per role (0-5000, step 50). */
  pointsRaja: number;
  pointsMantri: number;
  pointsSipahi: number;
  pointsChor: number;
  pointsRani: number;
  pointsSainik: number;
  pointsDaku: number;
  pointsPandit: number;
};

/**
 * "guess": roles are dealt; the guesser must accuse one hidden player.
 * "reveal": all roles and the round's points are shown; waiting for the host's "nextRound".
 * "over": after the host's "nextRound" on the last round's reveal (the last round stays visible).
 */
export type Phase = "guess" | "reveal" | "over";

/** One finished round (public once revealed). */
export type RoundResult = {
  round: number;
  /** Everyone's role in that round. */
  roles: Record<PlayerId, Role>;
  guesser: PlayerId;
  /** Who the guesser accused. */
  accused: PlayerId;
  /** Who was actually the Chor. */
  chor: PlayerId;
  correct: boolean;
  /** Points each player scored in that round. */
  points: Record<PlayerId, number>;
};

export interface State {
  /** Seat order. */
  order: PlayerId[];
  settings: Settings;
  phase: Phase;
  /** 1-based current round. */
  round: number;
  /** SECRET during "guess": this round's role per player. */
  roles: Record<PlayerId, Role>;
  /** Holder of the guesser role this round (public). */
  guesser: PlayerId;
  /** Holder of the Raja role this round (public only if settings.revealRaja, or after the guess). */
  raja: PlayerId;
  /** Finished rounds, oldest first; includes the current round during "reveal"/"over". */
  history: RoundResult[];
  /** Cumulative points. */
  totals: Record<PlayerId, number>;
  /** How many times the host re-dealt a round without scoring (skip for an absent guesser). */
  redeals: number;
}

export type Action =
  /** Guesser only, in "guess": accuse a player whose role is still hidden. */
  | { type: "guess"; target: PlayerId }
  /** Host only (when the host is not the guesser), in "guess": reshuffle roles for this round, nobody scores. */
  | { type: "redeal" }
  /** Host only, in "reveal": start the next round (or finish the game after the last round). */
  | { type: "nextRound" };

/** One row of the points table for the roles in play this match. */
export type RoleInfo = {
  role: Role;
  name: string;
  emoji: string;
  points: number;
};

export interface View {
  phase: Phase;
  round: number;
  totalRounds: number;
  /** True during the last round (the host's "nextRound" then ends the game). */
  isLastRound: boolean;
  /** Viewer's own role this round (null for spectators). */
  myRole: Role | null;
  /**
   * Roles the viewer may see this round, for every seated player. null = hidden from this viewer.
   * "guess": the guesser, the Raja (if revealRaja) and the viewer's own role. "reveal"/"over": everyone.
   */
  roles: Record<PlayerId, Role | null>;
  /** Players whose role is publicly hidden: exactly the guess targets (same list for every viewer). Empty after the guess. */
  hiddenPlayers: PlayerId[];
  /** Who is guessing this round, and as which role. */
  guesser: PlayerId;
  guesserRole: GuesserRole;
  /** The Raja if publicly known (revealRaja, or after the guess), else null. */
  raja: PlayerId | null;
  /** True when the viewer is the guesser. */
  amGuesser: boolean;
  /** This round's result during "reveal"/"over", else null. */
  lastResult: RoundResult | null;
  /** All finished (revealed) rounds, oldest first: for per-round score columns. */
  history: RoundResult[];
  /** Cumulative points. */
  totals: Record<PlayerId, number>;
  /** Roles in play this match, in ROLE_ORDER, with their points. */
  roleTable: RoleInfo[];
  /** Times the host re-dealt (public). */
  redeals: number;
  settings: Settings;
}
