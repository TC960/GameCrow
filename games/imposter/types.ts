/** Public types and constants for Imposter (shared by rules.ts, ui.tsx and tests). No secrets here. */
import type { PlayerId } from "../../engine";

export type Settings = {
  rounds: number;
  /** "auto" | "1" | "2" | "3". auto = 1 for 4-7 players, 2 for 8-12. */
  imposterCount: string;
  impostersKnow: boolean;
  /** "category" | "nothing": what an imposter sees instead of the word. */
  imposterHint: string;
  /** "random" | "fair". */
  imposterPick: string;
  /** Category ids (see CATEGORIES) plus optionally "custom". */
  categories: string[];
  customWords: string;
  clueRounds: number;
  /** "rotate" | "random". */
  firstClue: string;
  oneWordClues: boolean;
  uniqueClues: boolean;
  blockSecretWord: boolean;
  discussion: boolean;
  /** "revote" | "escape" | "random". */
  tieRule: string;
  revealVotes: boolean;
  lastChanceGuess: boolean;
  /** "choice" | "text". */
  guessMode: string;
  crewWinPoints: number;
  correctVoteBonus: number;
  imposterEscapePoints: number;
  imposterStealPoints: number;
  clueSeconds: number;
  discussSeconds: number;
  voteSeconds: number;
  guessSeconds: number;
};

/** Settings as shown in the view: everything except the custom word list. */
export type PublicRules = Omit<Settings, "customWords">;

export type Phase = "clue" | "discuss" | "vote" | "guess" | "reveal" | "over";
export type Role = "crew" | "imposter";

/** Public built-in categories (ids and labels only; the words are server-only in words.ts). */
export const CATEGORIES = [
  { id: "animals", label: "Animals", emoji: "🦁" },
  { id: "food", label: "Food & Drink", emoji: "🍕" },
  { id: "places", label: "Places", emoji: "🏝️" },
  { id: "jobs", label: "Jobs", emoji: "👩‍🔧" },
  { id: "sports", label: "Sports & Games", emoji: "⚽" },
  { id: "home", label: "Around the House", emoji: "🛋️" },
  { id: "transport", label: "Getting Around", emoji: "🚲" },
  { id: "nature", label: "Nature & Weather", emoji: "🌋" },
  { id: "clothing", label: "Things to Wear", emoji: "🧢" },
  { id: "hobbies", label: "Hobbies & Fun", emoji: "🎨" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CUSTOM_CATEGORY = { id: "custom", label: "Custom", emoji: "✍️" } as const;

export const CLUE_MAX_LENGTH = 30;
export const GUESS_MAX_LENGTH = 40;
/** Options offered in guessMode "choice" (fewer if the category is smaller). */
export const GUESS_CHOICES = 8;
export const CUSTOM_MIN_WORDS = 3;
export const CUSTOM_MAX_WORDS = 100;
export const CUSTOM_WORD_MAX_LENGTH = 30;

/** One clue turn. text null = skipped (host skip or timeout). */
export type Clue = { playerId: PlayerId; text: string | null; clueRound: number };

/** An open ballot. votes[id] = target, or null while not voted (null at close = abstained). */
export type Ballot = { candidates: PlayerId[]; votes: Record<PlayerId, PlayerId | null> };

/** A closed ballot as made public. votes is null unless settings.revealVotes. */
export type BallotResult = {
  candidates: PlayerId[];
  tallies: Record<PlayerId, number>;
  votes: Record<PlayerId, PlayerId | null> | null;
};

export type RoundResult = {
  round: number;
  word: string;
  category: string;
  imposters: PlayerId[];
  ballots: BallotResult[];
  accused: PlayerId | null;
  caught: boolean;
  /** The caught imposter's guess (null = no guess phase, skipped or timed out). */
  guess: string | null;
  guessCorrect: boolean | null;
  winner: "crew" | "imposters";
  how: "caught" | "escaped" | "stole";
  /** Points gained this round per player (0 for everyone else). */
  points: Record<PlayerId, number>;
};

export interface State {
  order: PlayerId[];
  settings: Settings;
  /** Resolved imposters per round. */
  imposterCount: number;
  round: number;
  phase: Phase;
  /** SECRET until reveal (crew only). */
  word: string;
  /** Label of the word's category. Secret from imposters when imposterHint is "nothing". */
  category: string;
  /** Category id (built-in id or "custom"). */
  categoryId: string;
  /** SECRET until reveal. */
  imposters: PlayerId[];
  /** Times each player has been imposter (for imposterPick "fair"). */
  imposterTally: Record<PlayerId, number>;
  /** "categoryId|word" keys already used this game. */
  usedWords: string[];
  clueOrder: PlayerId[];
  /** Index of the current clue turn (0 .. n*clueRounds-1). */
  turn: number;
  clues: Clue[];
  /** Ballots of this round; the open one is last. Votes SECRET until reveal. */
  ballots: Ballot[];
  closedBallots: BallotResult[];
  accused: PlayerId | null;
  guessOptions: string[] | null;
  guess: string | null;
  /** Epoch ms when the current timed phase/turn ends, or null. */
  deadline: number | null;
  scores: Record<PlayerId, number>;
  /** Public results of finished rounds (the current one too, once revealed). */
  history: RoundResult[];
}

export type Action =
  | { type: "clue"; text: string }
  | { type: "vote"; target: PlayerId }
  | { type: "guess"; text: string }
  | { type: "skipClue" }
  | { type: "startVote" }
  | { type: "closeVote" }
  | { type: "skipGuess" }
  | { type: "nextRound" }
  | { type: "@timeout" };

export interface View {
  phase: Phase;
  round: number;
  totalRounds: number;
  isLastRound: boolean;
  /** Viewer's own role; null for spectators. */
  role: Role | null;
  /** The secret word: crew only (null for imposters and spectators). */
  word: string | null;
  /** Category label: crew; imposters and spectators only if imposterHint is "category". */
  category: string | null;
  /** Other imposters, only for an imposter when impostersKnow and 2+ imposters. */
  fellowImposters: PlayerId[];
  imposterCount: number;
  order: PlayerId[];
  clueOrder: PlayerId[];
  /** 1-based clue pass during "clue" (clueRounds once clues are done). */
  clueRound: number;
  clueRounds: number;
  currentClueGiver: PlayerId | null;
  clues: Clue[];
  /** 1-based ballot number during "vote" (2 = revote), else number of ballots held. */
  ballot: number;
  /** Who can be voted for in the open ballot ([] outside "vote"). */
  candidates: PlayerId[];
  /** Who has voted in the open ballot. */
  voted: Record<PlayerId, boolean>;
  /** Viewer's own vote in the open ballot. */
  myVote: PlayerId | null;
  /** Closed ballots of this round, counts only (votes always null here). */
  closedBallots: BallotResult[];
  /** Public from "guess" on. */
  accused: PlayerId | null;
  accusedIsImposter: boolean | null;
  /** guessMode "choice", phase "guess" only. */
  guessOptions: string[] | null;
  /** This round's result in "reveal" / "over", else null. */
  result: RoundResult | null;
  history: RoundResult[];
  scores: Record<PlayerId, number>;
  rules: PublicRules;
}
