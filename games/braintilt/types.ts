/** Public types for Brain Tilt (shared by rules.ts, ui.tsx and tests). No secret data here. */
import type { PlayerId } from "../../engine";

/** Deck ids, labels and emoji (public). The word lists live in decks.ts (server only). */
export const DECKS = [
  { id: "animals", label: "Animal Kingdom", emoji: "🦒" },
  { id: "food", label: "Snack Attack", emoji: "🍕" },
  { id: "home", label: "Around the House", emoji: "🏠" },
  { id: "characters", label: "Heroes & Helpers", emoji: "🦸" },
  { id: "sports", label: "Game On", emoji: "⚽" },
  { id: "places", label: "Places to Go", emoji: "🗺️" },
  { id: "actions", label: "Act It Out", emoji: "🎭" },
  { id: "nature", label: "Sky & Wild", emoji: "🌈" },
] as const;

export type DeckId = (typeof DECKS)[number]["id"];

export type Settings = {
  /** Round length in seconds (30–180, step 15). Default 60. */
  roundSeconds: number;
  /** "Get ready" countdown after Start, seconds (0–10). 0 = no countdown phase. Default 3. */
  getReadySeconds: number;
  /** Times each player guesses (1–3). Default 1. */
  turnsEach: number;
  /** Selected deck ids (min 1). Default: all. */
  decks: string[];
  /** Cards in one round's stack (10–50, step 5). Default 30. */
  cardsPerRound: number;
  /** Non-guessers' phones show the current word. Default true. */
  othersSeeWord: boolean;
  /** "forehead" (guesser's phone shows the word, facing out) | "hidden" (never on the guesser's phone). */
  guesserScreen: string;
  /** Each pass costs 1 point. Default false. */
  passCostsPoint: boolean;
  /** "solo" | "teams". Default "solo". */
  scoring: string;
  /** Number of teams (2–4) when scoring = "teams". Default 2. */
  teamCount: number;
};

export type Phase = "ready" | "countdown" | "playing" | "over";

export type WordOutcome = "correct" | "pass" | "timeout";

export type WordResult = { word: string; result: WordOutcome };

/** How a round ended. */
export type EndedBy = "time" | "cards" | "skip";

/** A finished round without its words (kept for every round). */
export type RoundSummary = {
  /** 0-based index into turnOrder. */
  turn: number;
  guesser: PlayerId;
  /** Guesser's team index in team mode, else null. */
  team: number | null;
  correct: number;
  passed: number;
  points: number;
  endedBy: EndedBy;
};

/** The most recent finished round, including its words (public once the round is over). */
export type RoundRecord = RoundSummary & { words: WordResult[] };

export interface State {
  /** Seat order. */
  order: PlayerId[];
  settings: Settings;
  /** Team members (seat order) per team in team mode, else null. Team of a player = seat % teamCount. */
  teams: PlayerId[][] | null;
  /** Guesser of every turn, computed at setup. */
  turnOrder: PlayerId[];
  /** Index into turnOrder of the current turn (= turnOrder.length when over). */
  turn: number;
  phase: Phase;
  /** SECRET: upcoming words of the current round (not including `current`). */
  stack: string[];
  /** Word on screen now (phase "playing" only). */
  current: string | null;
  /** 1-based number of the current word in this round; 0 when no word is on screen. */
  wordNo: number;
  /** Words resolved so far this round. */
  roundWords: WordResult[];
  /** When the guessing starts (end of the get-ready countdown). */
  startsAt: number | null;
  /** When the round's timer runs out. */
  endsAt: number | null;
  /** Words shown so far in this draw cycle (server-side bookkeeping, never in a view). */
  used: string[];
  lastRound: RoundRecord | null;
  history: RoundSummary[];
  /** Points earned as guesser, per player (in team mode also added to teamPoints). */
  points: Record<PlayerId, number>;
  /** Team totals in team mode, else null. */
  teamPoints: number[] | null;
}

export type Action =
  | { type: "start" }
  | { type: "skipTurn" }
  | { type: "mark"; result: "correct" | "pass"; wordNo: number }
  | { type: "@timeout" };

export type Role = "guesser" | "describer" | "watcher" | "spectator" | "none";

export interface View {
  phase: Phase;
  settings: Settings;
  /** 0-based current turn (= totalTurns when over). */
  turn: number;
  totalTurns: number;
  turnOrder: PlayerId[];
  /** Current guesser (null when over). */
  guesser: PlayerId | null;
  /** Guesser of the next turn (null if this is the last turn or the game is over). */
  nextGuesser: PlayerId | null;
  role: Role;
  teams: PlayerId[][] | null;
  /** Viewer's team index (team mode, seated viewers), else null. */
  myTeam: number | null;
  /** Current guesser's team index (team mode), else null. */
  guesserTeam: number | null;
  /** The current word if this viewer may see it right now, else null. Never an upcoming word. */
  word: string | null;
  /** 1-based number of the current word this round (0 when none). */
  wordNo: number;
  /** How many upcoming cards remain in this round's stack after the current one. */
  cardsLeft: number;
  /** Words resolved so far this round (public). */
  roundWords: WordResult[];
  startsAt: number | null;
  endsAt: number | null;
  /** Previous round with its words. */
  lastRound: RoundRecord | null;
  /** Every finished round (no words). */
  history: RoundSummary[];
  points: Record<PlayerId, number>;
  teamPoints: number[] | null;
}
