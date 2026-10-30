/**
 * Imposter: everyone sees a secret word except the Imposter(s). Players take turns giving one-word
 * clues, discuss, then vote. A caught Imposter gets one last guess at the word to steal the round.
 * See games/imposter/BRIEF.md for the full rules.
 */
import { check, defineGame, fail, rankScores, FREE_TEXT, type PlayerId, type Rng } from "../../engine";
import { WORDS } from "./words";
import {
  CATEGORIES,
  CLUE_MAX_LENGTH,
  CUSTOM_CATEGORY,
  CUSTOM_MAX_WORDS,
  CUSTOM_MIN_WORDS,
  CUSTOM_WORD_MAX_LENGTH,
  GUESS_CHOICES,
  GUESS_MAX_LENGTH,
  type Ballot,
  type BallotResult,
  type RoundResult,
} from "./types";
import type { Action, State, View, Settings } from "./types";

export type { Action, State, View, Settings };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Accents removed, lowercase, only a-z0-9 kept. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/** Custom words: split on commas/newlines, trimmed, deduplicated (normalized), max 100. */
export function parseCustomWords(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const w = collapse(raw);
    const n = normalize(w);
    if (!n || w.length > CUSTOM_WORD_MAX_LENGTH || seen.has(n)) continue;
    seen.add(n);
    out.push(w);
    if (out.length >= CUSTOM_MAX_WORDS) break;
  }
  return out;
}

export function resolveImposterCount(setting: string, players: number): number {
  if (setting === "auto") return players >= 8 ? 2 : 1;
  const k = Number(setting);
  return Number.isInteger(k) && k >= 1 ? k : 1;
}

/** Guess is right if it equals the word after normalizing, allowing a trailing "s"/"es" either way. */
export function guessMatches(guess: string, word: string): boolean {
  const a = normalize(guess);
  const b = normalize(word);
  if (!a || !b) return false;
  return a === b || a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a;
}

/** Whether a clue gives away the secret word. Short words (< 3 letters) only match exactly. */
function containsWord(clue: string, word: string): boolean {
  const c = normalize(clue);
  const w = normalize(word);
  if (!w) return false;
  return w.length >= 3 ? c.includes(w) : c === w;
}

function wordsOf(categoryId: string, settings: Settings): string[] {
  if (categoryId === CUSTOM_CATEGORY.id) return parseCustomWords(settings.customWords);
  return [...(WORDS[categoryId as keyof typeof WORDS] ?? [])];
}

function categoryLabel(categoryId: string): string {
  if (categoryId === CUSTOM_CATEGORY.id) return CUSTOM_CATEGORY.label;
  return CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId;
}

const timer = (seconds: number, now: number) => (seconds > 0 ? now + seconds * 1000 : null);
const zeros = (order: PlayerId[]) => Object.fromEntries(order.map((id) => [id, 0]));
const wordKey = (categoryId: string, word: string) => `${categoryId}|${word}`;

function currentGiver(state: State): PlayerId | null {
  if (state.phase !== "clue") return null;
  return state.clueOrder[state.turn % state.order.length] ?? null;
}

function openBallotOf(state: State): Ballot | null {
  return state.phase === "vote" ? state.ballots[state.ballots.length - 1] ?? null : null;
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

function pickImposters(state: State, rng: Rng): PlayerId[] {
  const k = state.imposterCount;
  const shuffled = rng.shuffle(state.order);
  if (state.settings.imposterPick === "fair") {
    // Stable sort keeps the random order among players with the same tally.
    return shuffled
      .map((id, i) => ({ id, i }))
      .sort((a, b) => state.imposterTally[a.id] - state.imposterTally[b.id] || a.i - b.i)
      .slice(0, k)
      .map((x) => x.id);
  }
  return shuffled.slice(0, k);
}

function pickWord(state: State, rng: Rng): { categoryId: string; word: string; usedWords: string[] } {
  const cats = state.settings.categories;
  const available = (used: string[]) =>
    cats
      .map((id) => ({ id, words: wordsOf(id, state.settings).filter((w) => !used.includes(wordKey(id, w))) }))
      .filter((c) => c.words.length > 0);
  let used = state.usedWords;
  let pool = available(used);
  if (pool.length === 0) {
    // Every word was used: start over, but not with last round's word if there is any other.
    used = state.usedWords.slice(-1);
    pool = available(used);
    if (pool.length === 0) {
      used = [];
      pool = available(used);
    }
  }
  check(pool.length > 0, "No words to play with");
  const cat = rng.pick(pool);
  const word = rng.pick(cat.words);
  return { categoryId: cat.id, word, usedWords: [...used, wordKey(cat.id, word)] };
}

function startRound(state: State, round: number, rng: Rng, now: number): State {
  const imposters = pickImposters(state, rng);
  const { categoryId, word, usedWords } = pickWord(state, rng);
  const n = state.order.length;
  const start = state.settings.firstClue === "random" ? rng.int(0, n - 1) : (round - 1) % n;
  const clueOrder = state.order.map((_, i) => state.order[(start + i) % n]);
  const imposterTally = { ...state.imposterTally };
  for (const id of imposters) imposterTally[id] += 1;
  return {
    ...state,
    round,
    phase: "clue",
    word,
    category: categoryLabel(categoryId),
    categoryId,
    imposters,
    imposterTally,
    usedWords,
    clueOrder,
    turn: 0,
    clues: [],
    ballots: [],
    closedBallots: [],
    accused: null,
    guessOptions: null,
    guess: null,
    deadline: timer(state.settings.clueSeconds, now),
  };
}

function openBallot(state: State, candidates: PlayerId[], now: number): State {
  const ballot: Ballot = { candidates, votes: Object.fromEntries(state.order.map((id) => [id, null])) };
  return { ...state, phase: "vote", ballots: [...state.ballots, ballot], deadline: timer(state.settings.voteSeconds, now) };
}

function endClues(state: State, now: number): State {
  if (state.settings.discussion) {
    return { ...state, phase: "discuss", deadline: timer(state.settings.discussSeconds, now) };
  }
  return openBallot(state, state.order, now);
}

function recordClue(state: State, text: string | null, now: number): State {
  const n = state.order.length;
  const giver = currentGiver(state)!;
  const clues = [...state.clues, { playerId: giver, text, clueRound: Math.floor(state.turn / n) + 1 }];
  const turn = state.turn + 1;
  const next = { ...state, clues, turn };
  if (turn >= n * state.settings.clueRounds) return endClues(next, now);
  return { ...next, deadline: timer(state.settings.clueSeconds, now) };
}

function closeBallot(state: State, rng: Rng, now: number): State {
  const ballot = openBallotOf(state);
  if (!ballot) fail("No vote is open");
  const tallies: Record<PlayerId, number> = Object.fromEntries(ballot.candidates.map((id) => [id, 0]));
  for (const target of Object.values(ballot.votes)) if (target !== null && target in tallies) tallies[target] += 1;
  const closed: BallotResult = { candidates: ballot.candidates, tallies, votes: { ...ballot.votes } };
  const next: State = { ...state, closedBallots: [...state.closedBallots, closed], deadline: null };
  const top = Math.max(0, ...Object.values(tallies));
  const leaders = ballot.candidates.filter((id) => tallies[id] === top);
  let accused: PlayerId | null = null;
  if (top > 0 && leaders.length === 1) accused = leaders[0];
  else if (top > 0) {
    const rule = state.settings.tieRule;
    if (rule === "revote" && next.closedBallots.length === 1) return openBallot(next, leaders, now);
    if (rule === "random") accused = rng.pick(leaders);
  }
  return afterAccusation(next, accused, rng, now);
}

function afterAccusation(state: State, accused: PlayerId | null, rng: Rng, now: number): State {
  const caught = accused !== null && state.imposters.includes(accused);
  if (caught && state.settings.lastChanceGuess) {
    let guessOptions: string[] | null = null;
    if (state.settings.guessMode === "choice") {
      const others = rng.shuffle(wordsOf(state.categoryId, state.settings).filter((w) => w !== state.word));
      guessOptions = rng.shuffle([state.word, ...others.slice(0, GUESS_CHOICES - 1)]);
    }
    return { ...state, phase: "guess", accused, guessOptions, deadline: timer(state.settings.guessSeconds, now) };
  }
  return finishRound({ ...state, accused }, null, null);
}

function finishRound(state: State, guess: string | null, guessCorrect: boolean | null): State {
  const s = state.settings;
  const caught = state.accused !== null && state.imposters.includes(state.accused);
  const stole = caught && guessCorrect === true;
  const winner: RoundResult["winner"] = caught && !stole ? "crew" : "imposters";
  const how: RoundResult["how"] = !caught ? "escaped" : stole ? "stole" : "caught";
  const points: Record<PlayerId, number> = zeros(state.order);
  const isImp = (id: PlayerId) => state.imposters.includes(id);
  for (const id of state.order) {
    if (isImp(id)) {
      if (how === "escaped") points[id] += s.imposterEscapePoints;
      if (how === "stole") points[id] += s.imposterStealPoints;
    } else if (winner === "crew") {
      points[id] += s.crewWinPoints;
    }
  }
  const last = state.closedBallots[state.closedBallots.length - 1];
  if (last && s.correctVoteBonus > 0) {
    for (const id of state.order) {
      const target = last.votes?.[id] ?? null;
      if (!isImp(id) && target !== null && isImp(target)) points[id] += s.correctVoteBonus;
    }
  }
  const result: RoundResult = {
    round: state.round,
    word: state.word,
    category: state.category,
    imposters: [...state.imposters],
    ballots: state.closedBallots.map((b) => ({ ...b, votes: s.revealVotes ? b.votes : null })),
    accused: state.accused,
    caught,
    guess,
    guessCorrect,
    winner,
    how,
    points,
  };
  const scores = Object.fromEntries(state.order.map((id) => [id, state.scores[id] + points[id]]));
  return { ...state, phase: "reveal", guess, deadline: null, scores, history: [...state.history, result] };
}

function cleanClue(state: State, raw: string, byImposter: boolean): string {
  const text = collapse(raw);
  const s = state.settings;
  check(normalize(text).length > 0, "Type a clue");
  check(text.length <= CLUE_MAX_LENGTH, `Keep it to ${CLUE_MAX_LENGTH} letters`);
  if (s.oneWordClues) check(!text.includes(" "), "One word only");
  if (s.uniqueClues) {
    const n = normalize(text);
    check(!state.clues.some((c) => c.text !== null && normalize(c.text) === n), "Someone already said that");
  }
  if (s.blockSecretWord && !byImposter) check(!containsWord(text, state.word), "Don't say the secret word!");
  return text;
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

/** Generic one-word clues for bots (checked to contain no word from words.ts). */
export const BOT_CLUES = [
  "tasty", "outdoors", "noisy", "tiny", "huge", "colorful", "classic", "useful", "fancy", "messy",
  "quick", "slow", "shiny", "fluffy", "heavy", "summer", "winter", "weekend", "expensive", "cheap",
  "famous", "everyday", "tricky", "relaxing", "exciting", "wet", "dry", "loud", "quiet", "round",
  "pointy", "soft", "hard", "wild", "popular", "rare", "old", "modern", "family", "travel",
  "holiday", "morning", "night", "city", "village", "sweet", "salty", "spicy", "warm", "cold",
  "bright", "dark", "strong", "gentle", "long", "short", "simple", "clever", "silly", "smelly",
];

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const imposter = defineGame<State, Action, View, Settings>({
  meta: {
    id: "imposter",
    name: "Imposter",
    tagline: "Everyone knows the secret word. Except one of you.",
    emoji: "🕵️",
    category: "party",
    minPlayers: 4,
    maxPlayers: 12,
    howToPlay: [
      "Hold to see the secret word. One player is the Imposter and only sees the category.",
      "Take turns giving a one-word clue: prove you know the word without giving it away.",
      "Discuss, then everyone votes for who they think the Imposter is.",
      "Catch the Imposter and the crew scores, unless the Imposter then guesses the word.",
      "An Imposter who isn't caught scores. Most points after the last round wins.",
    ],
  },
  settings: [
    { type: "number", key: "rounds", label: "Rounds", default: 5, min: 1, max: 20, group: "Game" },
    {
      type: "select",
      key: "imposterCount",
      label: "Imposters per round",
      default: "auto",
      group: "Game",
      help: "Auto: 1 for up to 7 players, 2 for 8 or more.",
      options: [
        { value: "auto", label: "Auto" },
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
      ],
    },
    {
      type: "boolean",
      key: "impostersKnow",
      label: "Imposters know each other",
      default: false,
      group: "Game",
      visibleIf: { key: "imposterCount", in: ["auto", "2", "3"] },
    },
    {
      type: "select",
      key: "imposterHint",
      label: "The Imposter sees",
      default: "category",
      group: "Game",
      options: [
        { value: "category", label: "The category" },
        { value: "nothing", label: "Nothing" },
      ],
    },
    {
      type: "select",
      key: "imposterPick",
      label: "Choosing the Imposter",
      default: "random",
      group: "Game",
      options: [
        { value: "random", label: "Random each round" },
        { value: "fair", label: "Fair turns (least picked first)" },
      ],
    },
    {
      type: "multiselect",
      key: "categories",
      label: "Word categories",
      default: CATEGORIES.map((c) => c.id),
      minSelected: 1,
      group: "Words",
      options: [
        ...CATEGORIES.map((c) => ({ value: c.id, label: `${c.emoji} ${c.label}` })),
        { value: CUSTOM_CATEGORY.id, label: `${CUSTOM_CATEGORY.emoji} Custom words (below)` },
      ],
    },
    {
      type: "text",
      key: "customWords",
      label: "Custom words",
      default: "",
      maxLength: 1000,
      multiline: true,
      placeholder: "Comma separated, e.g. Goa, Jalebi, Monsoon",
      help: "Used when the Custom category is selected. Everyone can see this list.",
      group: "Words",
    },
    { type: "number", key: "clueRounds", label: "Clues per player", default: 2, min: 1, max: 3, group: "Clues" },
    {
      type: "select",
      key: "firstClue",
      label: "First clue",
      default: "rotate",
      group: "Clues",
      options: [
        { value: "rotate", label: "Moves one seat each round" },
        { value: "random", label: "Random player" },
      ],
    },
    { type: "boolean", key: "oneWordClues", label: "One-word clues only", default: true, group: "Clues" },
    { type: "boolean", key: "uniqueClues", label: "No repeated clues", default: true, group: "Clues" },
    { type: "boolean", key: "blockSecretWord", label: "Block clues that say the word", default: true, group: "Clues" },
    {
      type: "boolean",
      key: "discussion",
      label: "Discussion before voting",
      default: true,
      group: "Voting",
      help: "The host starts the vote when you're done talking.",
    },
    {
      type: "select",
      key: "tieRule",
      label: "Tied vote",
      default: "revote",
      group: "Voting",
      options: [
        { value: "revote", label: "Revote between tied players" },
        { value: "escape", label: "Imposter escapes" },
        { value: "random", label: "Pick one tied player at random" },
      ],
    },
    { type: "boolean", key: "revealVotes", label: "Show who voted for whom", default: true, group: "Voting" },
    { type: "boolean", key: "lastChanceGuess", label: "Caught Imposter guesses the word", default: true, group: "Voting" },
    {
      type: "select",
      key: "guessMode",
      label: "Imposter's guess",
      default: "choice",
      group: "Voting",
      visibleIf: { key: "lastChanceGuess", in: [true] },
      options: [
        { value: "choice", label: `Pick from ${GUESS_CHOICES} words` },
        { value: "text", label: "Type the word" },
      ],
    },
    { type: "number", key: "crewWinPoints", label: "Crew catches the Imposter", default: 1, min: 0, max: 10, group: "Scoring" },
    { type: "number", key: "correctVoteBonus", label: "Bonus for voting an Imposter", default: 0, min: 0, max: 5, group: "Scoring" },
    { type: "number", key: "imposterEscapePoints", label: "Imposter escapes", default: 2, min: 0, max: 10, group: "Scoring" },
    {
      type: "number",
      key: "imposterStealPoints",
      label: "Caught Imposter guesses the word",
      default: 2,
      min: 0,
      max: 10,
      group: "Scoring",
      visibleIf: { key: "lastChanceGuess", in: [true] },
    },
    { type: "number", key: "clueSeconds", label: "Seconds per clue (0 = off)", default: 0, min: 0, max: 120, step: 5, group: "Timers" },
    {
      type: "number",
      key: "discussSeconds",
      label: "Discussion seconds (0 = host decides)",
      default: 0,
      min: 0,
      max: 300,
      step: 15,
      group: "Timers",
      visibleIf: { key: "discussion", in: [true] },
    },
    { type: "number", key: "voteSeconds", label: "Voting seconds (0 = off)", default: 0, min: 0, max: 180, step: 5, group: "Timers" },
    {
      type: "number",
      key: "guessSeconds",
      label: "Guess seconds (0 = off)",
      default: 0,
      min: 0,
      max: 120,
      step: 5,
      group: "Timers",
      visibleIf: { key: "lastChanceGuess", in: [true] },
    },
  ],

  validateSettings(settings, players) {
    const n = players.length;
    const k = resolveImposterCount(settings.imposterCount, n);
    if (2 * k >= n) return `Too many imposters for ${n} players`;
    if (settings.categories.includes(CUSTOM_CATEGORY.id) && parseCustomWords(settings.customWords).length < CUSTOM_MIN_WORDS) {
      return `Add at least ${CUSTOM_MIN_WORDS} custom words (comma separated)`;
    }
    return null;
  },

  setup(players, settings, { rng, now }) {
    const order = players.map((p) => p.id);
    const base: State = {
      order,
      settings,
      imposterCount: resolveImposterCount(settings.imposterCount, order.length),
      round: 0,
      phase: "clue",
      word: "",
      category: "",
      categoryId: "",
      imposters: [],
      imposterTally: zeros(order),
      usedWords: [],
      clueOrder: [],
      turn: 0,
      clues: [],
      ballots: [],
      closedBallots: [],
      accused: null,
      guessOptions: null,
      guess: null,
      deadline: null,
      scores: zeros(order),
      history: [],
    };
    return startRound(base, 1, rng, now);
  },

  legalActions(state, actor) {
    if (!state.order.includes(actor.id)) return [];
    const host = actor.isHost;
    switch (state.phase) {
      case "clue": {
        const out: Action[] = currentGiver(state) === actor.id ? [{ type: "clue", text: FREE_TEXT }] : [];
        if (host) out.push({ type: "skipClue" });
        return out;
      }
      case "discuss":
        return host ? [{ type: "startVote" }] : [];
      case "vote": {
        const ballot = openBallotOf(state)!;
        const out: Action[] =
          ballot.votes[actor.id] === null
            ? ballot.candidates.filter((c) => c !== actor.id).map((target) => ({ type: "vote", target }))
            : [];
        if (host) out.push({ type: "closeVote" });
        return out;
      }
      case "guess": {
        const out: Action[] = [];
        if (actor.id === state.accused) {
          if (state.guessOptions) out.push(...state.guessOptions.map((text) => ({ type: "guess" as const, text })));
          else out.push({ type: "guess", text: FREE_TEXT });
        }
        if (host) out.push({ type: "skipGuess" });
        return out;
      }
      case "reveal":
        return host ? [{ type: "nextRound" }] : [];
      case "over":
        return [];
    }
  },

  reduce(state, action, { actor, rng, now }) {
    switch (action.type) {
      case "clue": {
        check(state.phase === "clue" && currentGiver(state) === actor.id, "It's not your turn");
        const text = cleanClue(state, action.text, state.imposters.includes(actor.id));
        return recordClue(state, text, now);
      }
      case "skipClue":
        check(state.phase === "clue", "No clue to skip");
        return recordClue(state, null, now);
      case "startVote":
        check(state.phase === "discuss", "Not discussing right now");
        return openBallot(state, state.order, now);
      case "vote": {
        const ballot = openBallotOf(state);
        check(ballot, "No vote is open");
        check(ballot.votes[actor.id] === null, "You already voted");
        check(action.target !== actor.id && ballot.candidates.includes(action.target), "You can't vote for them");
        const votes = { ...ballot.votes, [actor.id]: action.target };
        const ballots = [...state.ballots.slice(0, -1), { ...ballot, votes }];
        const next = { ...state, ballots };
        return Object.values(votes).every((v) => v !== null) ? closeBallot(next, rng, now) : next;
      }
      case "closeVote":
        return closeBallot(state, rng, now);
      case "guess": {
        check(state.phase === "guess" && actor.id === state.accused, "Only the caught Imposter can guess");
        const text = collapse(action.text);
        check(text.length > 0, "Type a guess");
        check(text.length <= GUESS_MAX_LENGTH, "That guess is too long");
        if (state.guessOptions) check(state.guessOptions.includes(text), "Pick one of the words");
        return finishRound(state, text, guessMatches(text, state.word));
      }
      case "skipGuess":
        check(state.phase === "guess", "No guess to skip");
        return finishRound(state, null, false);
      case "nextRound":
        check(state.phase === "reveal", "The round isn't over");
        if (state.round >= state.settings.rounds) return { ...state, phase: "over", deadline: null };
        return startRound(state, state.round + 1, rng, now);
      case "@timeout": {
        if (state.deadline === null) return state;
        switch (state.phase) {
          case "clue":
            return recordClue(state, null, now);
          case "discuss":
            return openBallot(state, state.order, now);
          case "vote":
            return closeBallot(state, rng, now);
          case "guess":
            return finishRound(state, null, false);
          default:
            return { ...state, deadline: null };
        }
      }
    }
  },

  viewFor(state, playerId) {
    const seated = playerId !== null && state.order.includes(playerId);
    const role = seated ? (state.imposters.includes(playerId) ? "imposter" : "crew") : null;
    const revealed = state.phase === "reveal" || state.phase === "over";
    const ballot = openBallotOf(state);
    const n = state.order.length;
    const { customWords: _customWords, ...rules } = state.settings;
    const accusedPublic = state.phase === "guess" || revealed;
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.settings.rounds,
      isLastRound: state.round >= state.settings.rounds,
      role,
      word: role === "crew" ? state.word : null,
      category: role === "crew" || state.settings.imposterHint === "category" ? state.category : null,
      fellowImposters:
        role === "imposter" && state.settings.impostersKnow && state.imposters.length > 1
          ? state.imposters.filter((id) => id !== playerId)
          : [],
      imposterCount: state.imposterCount,
      order: state.order,
      clueOrder: state.clueOrder,
      clueRound: state.phase === "clue" ? Math.floor(state.turn / n) + 1 : state.settings.clueRounds,
      clueRounds: state.settings.clueRounds,
      currentClueGiver: currentGiver(state),
      clues: state.clues,
      ballot: state.ballots.length,
      candidates: ballot ? ballot.candidates : [],
      voted: Object.fromEntries(state.order.map((id) => [id, ballot ? ballot.votes[id] !== null : false])),
      myVote: ballot && seated ? ballot.votes[playerId] ?? null : null,
      closedBallots: state.closedBallots.map((b) => ({ candidates: b.candidates, tallies: b.tallies, votes: null })),
      accused: accusedPublic ? state.accused : null,
      accusedIsImposter: accusedPublic && state.accused !== null ? state.imposters.includes(state.accused) : null,
      guessOptions: state.phase === "guess" ? state.guessOptions : null,
      result: revealed ? state.history[state.history.length - 1] ?? null : null,
      history: state.history,
      scores: state.scores,
      rules,
    };
  },

  activePlayers(state) {
    switch (state.phase) {
      case "clue":
        return [currentGiver(state)!];
      case "vote": {
        const ballot = openBallotOf(state)!;
        return state.order.filter((id) => ballot.votes[id] === null);
      }
      case "guess":
        return state.accused ? [state.accused] : [];
      default:
        return [];
    }
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.scores),
  deadline: (state) => state.deadline,

  botAction(view, legal, rng) {
    if (legal.some((a) => a.type === "clue")) {
      const used = new Set(view.clues.flatMap((c) => (c.text === null ? [] : [normalize(c.text)])));
      const options = BOT_CLUES.filter((c) => !used.has(c) && !(view.word && containsWord(c, view.word)));
      return { type: "clue", text: options.length ? rng.pick(options) : `hint${view.clues.length + 1}` };
    }
    const guesses = legal.filter((a) => a.type === "guess");
    if (guesses.length) {
      if (view.guessOptions) return rng.pick(guesses);
      const said = view.clues.flatMap((c) => (c.text === null ? [] : [c.text]));
      return { type: "guess", text: said.length ? rng.pick(said) : "pass" };
    }
    const votes = legal.filter((a) => a.type === "vote");
    if (votes.length) return rng.pick(votes);
    return rng.pick(legal);
  },
});

export default imposter;
