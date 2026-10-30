/**
 * Public types for Psych (shared by rules.ts, ui.tsx and tests).
 * Nothing secret lives here: the prompt packs and real answers are in prompts.ts, imported only by rules.ts.
 */
import type { PlayerId } from "../../engine";

// ---------------------------------------------------------------------------
// Constants (safe to ship to clients)
// ---------------------------------------------------------------------------

export type Mode = "trivia" | "friends" | "mixed";
export type FriendsRealAnswer = "none" | "subject";

export const MODES: { value: Mode; label: string }[] = [
  { value: "trivia", label: "Trivia (real answers)" },
  { value: "friends", label: "About the players" },
  { value: "mixed", label: "Mixed (alternate)" },
];

export type PackId = "general" | "animals" | "food" | "science" | "history" | "india";

/** Trivia packs, in display order. */
export const PACKS: { value: PackId; label: string }[] = [
  { value: "general", label: "General knowledge" },
  { value: "animals", label: "Animals" },
  { value: "food", label: "Food & drink" },
  { value: "science", label: "Science & space" },
  { value: "history", label: "History" },
  { value: "india", label: "India" },
];

export const PACK_IDS: PackId[] = PACKS.map((p) => p.value);

/** Max length of an answer after trimming and collapsing spaces. */
export const MAX_ANSWER_LENGTH = 60;
/** Max length of the whole custom-prompts text setting. */
export const MAX_CUSTOM_PROMPTS_LENGTH = 4000;
/** Max length of one custom question (longer lines are cut). */
export const MAX_CUSTOM_QUESTION_LENGTH = 200;
/** The blank shown in prompts. */
export const BLANK = "___";
/** Placeholder replaced by the subject's name in "about the players" prompts. */
export const PLAYER_PLACEHOLDER = "{player}";

// ---------------------------------------------------------------------------
// Settings (house rules; see NOTES.md)
// ---------------------------------------------------------------------------

export type Settings = {
  mode: Mode;
  /** Trivia packs used for trivia rounds. */
  packs: PackId[];
  /** About-the-players rounds: "subject" = the subject writes the true answer (+truthPoints for picking it). */
  friendsRealAnswer: FriendsRealAnswer;
  /** Extra prompts, one per line: "Question | Answer" (answer optional; {player} allowed). Always played. */
  customPrompts: string;
  rounds: number;
  /** 0 = no timer. */
  answerSeconds: number;
  /** 0 = no timer. */
  voteSeconds: number;
  /** Points each author gets per vote their fake answer receives. */
  fooledPoints: number;
  /** Points for voting for the real answer. */
  truthPoints: number;
};

// ---------------------------------------------------------------------------
// State (server only; never sent to clients)
// ---------------------------------------------------------------------------

export type Phase = "answer" | "vote" | "reveal" | "over";

/**
 * Where a round's true answer comes from:
 * - "fact": a known real answer (trivia or a custom "Question | Answer" line);
 * - "subject": the subject writes the true answer (friendsRealAnswer = "subject");
 * - "none": no real answer, only fakes.
 */
export type TruthSource = "fact" | "subject" | "none";

export type RoundPrompt = {
  /** Prompt text; may contain {player}. */
  text: string;
  /** Known real answer (truth "fact") or null. SECRET until reveal. */
  answer: string | null;
  /** Other spellings that also count as the real answer. SECRET. */
  alts: string[];
  /** Subject of an about-the-players prompt (the {player}), else null. */
  subject: PlayerId | null;
  truth: TruthSource;
  /** Trivia pack id, "friends" or "custom". */
  source: PackId | "friends" | "custom";
};

export type OptionRecord = {
  /** "o1".."oN" in the stored (shuffled) display order. */
  id: string;
  text: string;
  /** Players credited for this option. For the real option of a "subject" round: the subject first, then anyone whose answer matched. */
  authors: PlayerId[];
  isReal: boolean;
};

export type State = {
  order: PlayerId[];
  names: Record<PlayerId, string>;
  settings: Settings;
  /** One prompt per round, chosen and shuffled at setup. */
  prompts: RoundPrompt[];
  /** 1-based. */
  round: number;
  phase: Phase;
  /** Submitted answers this round (trimmed), null = not yet. SECRET until reveal (except your own). */
  answers: Record<PlayerId, string | null>;
  /** Vote options (shuffled), built when answering ends. Authors and isReal are SECRET until reveal. */
  options: OptionRecord[];
  /** Who may vote this round (set when voting starts). */
  voters: PlayerId[];
  /** Option id each voter picked, null = not yet. SECRET until reveal (except your own). */
  votes: Record<PlayerId, string | null>;
  /** Epoch ms when the current phase times out, or null. */
  deadline: number | null;
  scores: Record<PlayerId, number>;
  /** Points scored in the round being revealed. */
  roundPoints: Record<PlayerId, number>;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  /** Write your answer (fake, or the truth if you are the subject of a "subject" round). 1-60 chars. */
  | { type: "answer"; text: string }
  /** Vote for an option by id (not your own). */
  | { type: "vote"; option: string }
  /** Host: stop waiting and move on with whoever has answered / voted. */
  | { type: "skip" }
  /** Host: after the reveal, start the next round (or finish after the last one). */
  | { type: "nextRound" }
  /** Engine: the phase timer ran out (same effect as "skip"). */
  | { type: "@timeout" };

// ---------------------------------------------------------------------------
// View (what one player sees)
// ---------------------------------------------------------------------------

/** A vote option as shown while voting (anonymous). */
export type ViewOption = {
  id: string;
  text: string;
  /** You wrote it (or are its subject-truth author). You can't vote for it. Always false for spectators. */
  isMine: boolean;
};

/** A fully revealed option (reveal/over only). */
export type RevealOption = {
  id: string;
  text: string;
  isReal: boolean;
  /** Who wrote it. Real trivia answers have no authors; a subject's truth lists the subject first. */
  authors: PlayerId[];
  /** Who voted for it. */
  voters: PlayerId[];
  /** Points EACH fake author got from this option's votes (0 for the real option). */
  pointsPerAuthor: number;
  isMine: boolean;
};

export type RevealInfo = {
  /** The real answer, or null when the round had none. */
  realAnswer: string | null;
  /** Every option, in the same order as during voting. */
  options: RevealOption[];
  /** In a "subject" round: players (not the subject) whose answer matched the truth (+truthPoints each). */
  truthGuessers: PlayerId[];
  /** Points each player scored this round. */
  roundPoints: Record<PlayerId, number>;
  /** Players who did not answer / did not vote (skipped or timed out). */
  noAnswer: PlayerId[];
  noVote: PlayerId[];
  /** True when voting was skipped (fewer than 2 answers). */
  voteSkipped: boolean;
};

export type View = {
  phase: Phase;
  round: number;
  totalRounds: number;
  /** "trivia" = a question with a known answer or a custom line; "friends" = about a player. */
  kind: "trivia" | "friends";
  /** Prompt text, with {player} already replaced by the subject's name. Contains "___" for the blank. */
  promptText: string;
  /** Pack label, "About the players" or "Custom". */
  sourceLabel: string;
  subject: PlayerId | null;
  subjectName: string | null;
  iAmSubject: boolean;
  /** Where the true answer comes from this round (public: it follows from the settings). */
  truth: TruthSource;
  /** True when I must write the TRUE answer (I'm the subject of a "subject" round). */
  writeTruth: boolean;
  /** Who has answered this round (never what). */
  answered: Record<PlayerId, boolean>;
  answeredCount: number;
  /** How many answers the game waits for in total. */
  answerTarget: number;
  /** My own answer this round, or null. */
  myAnswer: string | null;
  /** Vote options (vote, reveal, over), anonymous; null during answering. */
  options: ViewOption[] | null;
  /** Who votes this round (vote/reveal/over; empty during answering). */
  voters: PlayerId[];
  /** Who has voted (never for what). */
  voted: Record<PlayerId, boolean>;
  /** My vote (option id) or null. */
  myVote: string | null;
  /** Full results; only in reveal/over. */
  reveal: RevealInfo | null;
  scores: Record<PlayerId, number>;
  /** Public rule numbers the UI may show. */
  rules: {
    mode: Mode;
    answerSeconds: number;
    voteSeconds: number;
    fooledPoints: number;
    truthPoints: number;
    maxAnswerLength: number;
  };
  /** True after the last round's reveal (host's next tap ends the game). */
  isLastRound: boolean;
};
