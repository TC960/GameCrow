/** Public types and constants for Mafia (shared by rules.ts, ui.tsx and tests). Nothing here is secret. */
import type { PlayerId } from "../../engine";

export type Role = "mafia" | "doctor" | "detective" | "villager";
export type Team = "mafia" | "village";
/** What a public death reveal or a detective result shows: a role, or just the team (`"mafia"` / `"village"`). */
export type Reveal = Role | "village";

export type Phase = "roles" | "night" | "day" | "vote" | "verdict" | "over";
/** The viewer's own night action, derived from their role. */
export type NightTask = "kill" | "protect" | "investigate" | "suspect";

export type Settings = {
  /** 0 = Auto (see autoMafiaCount). */
  mafiaCount: number;
  doctors: number;
  detectives: number;
  killRule: "unanimous" | "majority" | "first";
  selfProtect: "always" | "once" | "never";
  repeatProtect: boolean;
  detectiveResult: "team" | "role";
  startWith: "night" | "day";
  revealOnDeath: "role" | "team" | "none";
  voteRule: "plurality" | "majority";
  tieRule: "none" | "random";
  allowAbstain: boolean;
  voteVisibility: "open" | "tally";
  deadSeeRoles: boolean;
  /** Seconds, 0 = no timer. */
  nightTimer: number;
  discussionTimer: number;
  voteTimer: number;
};

export type RoleCounts = Record<Role, number>;

export type Investigation = { night: number; target: PlayerId; result: Reveal };

export type NightReport = { night: number; deaths: PlayerId[] };

export type VoteReason = "eliminated" | "noVotes" | "abstain" | "tie" | "noMajority";

export type VoteReport = {
  day: number;
  eliminated: PlayerId | null;
  reason: VoteReason;
  /** Votes per player (only players with at least one vote). */
  tally: Record<PlayerId, number>;
  abstains: number;
  /** voter -> target (null = abstained); non-voters absent. null when voteVisibility is "tally". */
  ballots: Record<PlayerId, PlayerId | null> | null;
};

export type LogEntry =
  | { kind: "night"; night: number; deaths: PlayerId[] }
  | { kind: "vote"; day: number; eliminated: PlayerId | null; reason: VoteReason };

export interface State {
  order: PlayerId[];
  /** SECRET (except for revealed/over). */
  roles: Record<PlayerId, Role>;
  alive: Record<PlayerId, boolean>;
  phase: Phase;
  nightNo: number;
  dayNo: number;
  ready: Record<PlayerId, boolean>;
  /** SECRET. Night picks of this night; key present = acted. */
  nightPicks: Record<PlayerId, PlayerId>;
  /** SECRET. killRule "first": the first Mafia pick this night. */
  firstMafiaPick: PlayerId | null;
  /** SECRET. Per detective. */
  investigations: Record<PlayerId, Investigation[]>;
  /** SECRET. Per doctor: who they protected the previous night (null = nobody/didn't act). */
  lastProtected: Record<PlayerId, PlayerId | null>;
  /** SECRET. Per doctor. */
  selfProtectUsed: Record<PlayerId, boolean>;
  /** SECRET until the vote resolves. key present = voted; null = abstained. */
  votes: Record<PlayerId, PlayerId | null>;
  /** Public reveals of dead players' roles (per revealOnDeath). */
  revealed: Record<PlayerId, Reveal>;
  lastNight: NightReport | null;
  lastVote: VoteReport | null;
  log: LogEntry[];
  winner: Team | null;
  /** Deadline of the current timed phase (epoch ms) or null. */
  phaseEndsAt: number | null;
  roleCounts: RoleCounts;
  settings: Settings;
}

export type Action =
  | { type: "ready" }
  | { type: "night"; target: PlayerId }
  | { type: "vote"; target: PlayerId }
  | { type: "abstain" }
  | { type: "advance" }
  | { type: "@timeout" };

export interface View {
  phase: Phase;
  nightNo: number;
  dayNo: number;
  order: PlayerId[];
  alive: Record<PlayerId, boolean>;
  /** Public death reveals. */
  revealed: Record<PlayerId, Reveal>;
  /** Every role: in "over" for everyone; before that only for a dead viewer with deadSeeRoles. Else null. */
  allRoles: Record<PlayerId, Role> | null;
  roleCounts: RoleCounts;

  /** The viewer's own role (null for spectators). */
  myRole: Role | null;
  amAlive: boolean;
  nightTask: NightTask | null;
  /** All Mafia ids (incl. self) if the viewer is Mafia; [] otherwise. */
  team: PlayerId[];
  /** Living Mafia viewer at night: living teammates' (and own) current picks. null otherwise. */
  teamPicks: Record<PlayerId, PlayerId> | null;
  myNightPick: PlayerId | null;
  /** Detective viewer's own results; [] otherwise. */
  investigations: Investigation[];
  /** Doctor viewer only (null / false otherwise). */
  myLastProtected: PlayerId | null;
  selfProtectUsed: boolean;

  ready: Record<PlayerId, boolean>;
  /** Night: living players who have acted (booleans only). */
  nightDone: Record<PlayerId, boolean>;
  /** Vote: living players who have voted (booleans only). */
  voted: Record<PlayerId, boolean>;
  iVoted: boolean;
  /** The viewer's own vote (null when abstained or not voted; see iVoted). */
  myVote: PlayerId | null;

  lastNight: NightReport | null;
  lastVote: VoteReport | null;
  log: LogEntry[];
  winner: Team | null;
  phaseEndsAt: number | null;
  settings: Settings;
}

export const ROLES: readonly Role[] = ["mafia", "doctor", "detective", "villager"];

export const ROLE_INFO: Record<Reveal, { name: string; emoji: string; team: Team; goal: string }> = {
  mafia: { name: "Mafia", emoji: "🔪", team: "mafia", goal: "Eliminate the village. Agree on a victim each night." },
  doctor: { name: "Doctor", emoji: "💉", team: "village", goal: "Protect one player from the Mafia each night." },
  detective: { name: "Detective", emoji: "🔎", team: "village", goal: "Investigate one player each night." },
  villager: { name: "Villager", emoji: "🧑‍🌾", team: "village", goal: "Find and vote out the Mafia." },
  village: { name: "Village", emoji: "🏘️", team: "village", goal: "Not Mafia." },
};

export const NIGHT_TASK: Record<Role, NightTask> = {
  mafia: "kill",
  doctor: "protect",
  detective: "investigate",
  villager: "suspect",
};

/** Auto Mafia count: 5–6 → 1, 7–9 → 2, 10–12 → 3, 13–16 → 4. */
export function autoMafiaCount(players: number): number {
  if (players <= 6) return 1;
  if (players <= 9) return 2;
  if (players <= 12) return 3;
  return 4;
}

/** Role counts for n players under these settings (no validation). */
export function roleCountsFor(players: number, s: Pick<Settings, "mafiaCount" | "doctors" | "detectives">): RoleCounts {
  const mafia = s.mafiaCount > 0 ? s.mafiaCount : autoMafiaCount(players);
  return {
    mafia,
    doctor: s.doctors,
    detective: s.detectives,
    villager: Math.max(0, players - mafia - s.doctors - s.detectives),
  };
}
