/**
 * Spy Words: an original team word-association game (see BRIEF.md).
 * Two teams (Sun, Moon) each have a Handler who sees the secret key and gives one-word clues; the team's
 * Agents tap words on a 5x5 board. Find all your words first; reveal the Trap and your team loses.
 */
import {
  check,
  defineGame,
  fail,
  FREE_NUMBER,
  FREE_TEXT,
  legalOfType,
  rankScores,
  type PlayerId,
  type Rng,
} from "../../engine";
import { clueProblem, countProblem, normalizeClue } from "./shared";
import {
  BOARD_SIZE,
  TEAMS,
  UNLIMITED_GUESSES,
  type Action,
  type GameResult,
  type Settings,
  type State,
  type Team,
  type TileKind,
  type TurnEnd,
  type TurnRecord,
  type View,
  type Vote,
} from "./types";
import { BOT_CLUES, WORDS } from "./words";

export type { Action, State, View, Settings };

const other = (t: Team): Team => (t === "sun" ? "moon" : "sun");

const spywords = defineGame<State, Action, View, Settings>({
  meta: {
    id: "spywords",
    name: "Spy Words",
    tagline: "One-word clues. Find your agents. Dodge the trap.",
    emoji: "🕵️",
    category: "party",
    minPlayers: 4,
    maxPlayers: 12,
    howToPlay: [
      "Two teams, Sun ☀ and Moon ☾. Each team has one Handler who secretly sees which words belong to whom.",
      "On your turn the Handler gives a one-word clue and a number, like \"OCEAN 2\".",
      "Agents tap words they think match. Your word? Keep going (up to the number + 1).",
      "A neutral or rival word ends your turn. The Trap ✖ loses the game on the spot!",
      "First team to reveal all of its words wins. Handlers rotate each game.",
    ],
  },
  settings: [
    { type: "number", key: "games", label: "Games in the match", default: 1, min: 1, max: 9, group: "Match", help: "Handlers rotate every game. 1 point per game won." },
    { type: "boolean", key: "shuffleTeams", label: "Shuffle teams", default: false, group: "Match", help: "Off: alternate seats form the teams." },
    {
      type: "select",
      key: "starter",
      label: "Who starts later games",
      default: "alternate",
      group: "Match",
      help: "Game 1 is always random. The starting team gets 9 words.",
      options: [
        { value: "alternate", label: "Teams take turns" },
        { value: "random", label: "Random each game" },
      ],
    },
    {
      type: "select",
      key: "guessMode",
      label: "Guessing",
      default: "first",
      group: "Guessing",
      options: [
        { value: "first", label: "First tap counts" },
        { value: "vote", label: "Team majority vote" },
      ],
    },
    { type: "boolean", key: "extraGuess", label: "One bonus guess (number + 1)", default: true, group: "Guessing" },
    { type: "number", key: "trapCount", label: "Trap tiles", default: 1, min: 1, max: 3, group: "Guessing" },
    { type: "boolean", key: "strictClues", label: "Strict clues", default: true, group: "Clues", help: "Also block clues that start or end with a board word (SNOW when SNOWMAN is showing)." },
    { type: "boolean", key: "allowZero", label: "Allow 0 (unlimited guesses)", default: false, group: "Clues" },
    { type: "number", key: "clueTimer", label: "Clue timer (seconds, 0 = off)", default: 0, min: 0, max: 300, step: 15, group: "Timers" },
    { type: "number", key: "guessTimer", label: "Guess timer (seconds, 0 = off)", default: 0, min: 0, max: 300, step: 15, group: "Timers" },
  ],

  setup(players, settings, { rng, now }) {
    const order = players.map((p) => p.id);
    const seating = settings.shuffleTeams ? rng.shuffle(order) : order;
    const teams: Record<PlayerId, Team> = {};
    seating.forEach((id, i) => (teams[id] = i % 2 === 0 ? "sun" : "moon"));
    const members = {
      sun: order.filter((id) => teams[id] === "sun"),
      moon: order.filter((id) => teams[id] === "moon"),
    };
    const handlerOffset = {
      sun: rng.int(0, members.sun.length - 1),
      moon: rng.int(0, members.moon.length - 1),
    };
    const startingTeam: Team = rng.chance(0.5) ? "sun" : "moon";
    const base: State = {
      order,
      teams,
      members,
      handlerOffset,
      handlers: { sun: members.sun[0], moon: members.moon[0] },
      game: 1,
      phase: "clue",
      startingTeam,
      turn: startingTeam,
      words: [],
      key: [],
      revealed: [],
      clue: null,
      maxGuesses: 0,
      guessesMade: 0,
      votes: {},
      noAgreement: false,
      history: [],
      results: [],
      wins: { sun: 0, moon: 0 },
      usedWords: [],
      deadlineAt: null,
      settings,
    };
    return startGame(base, 1, startingTeam, rng, now);
  },

  legalActions(state, actor) {
    const out: Action[] = [];
    if (state.phase === "clue") {
      if (state.handlers[state.turn] === actor.id) out.push({ type: "clue", word: FREE_TEXT_T, count: FREE_NUMBER_T });
      if (actor.isHost && isSeated(state, actor.id)) out.push({ type: "skipTurn" });
    } else if (state.phase === "guess") {
      if (isAgent(state, actor.id) && !(isVoteMode(state) && actor.id in state.votes)) {
        state.revealed.forEach((r, tile) => !r && out.push({ type: "guess", tile }));
        if (state.guessesMade >= 1) out.push({ type: "endTurn" });
      }
      if (actor.isHost && isSeated(state, actor.id)) out.push({ type: "skipTurn" });
    } else if (state.phase === "gameEnd") {
      if (actor.isHost && isSeated(state, actor.id)) out.push({ type: "nextGame" });
    }
    return out;
  },

  reduce(state, action, { actor, rng, now }) {
    switch (action.type) {
      case "clue": {
        check(state.phase === "clue", "It's not time for a clue");
        check(state.handlers[state.turn] === actor.id, "Only your team's Handler gives the clue");
        check(typeof action.word === "string", "Type a one-word clue");
        const board = state.words.filter((_, i) => !state.revealed[i]);
        const wordProblem = clueProblem(action.word, board, state.settings.strictClues);
        if (wordProblem) fail(wordProblem);
        const countErr = countProblem(action.count, state.settings.allowZero);
        if (countErr) fail(countErr);
        const word = normalizeClue(action.word);
        const count = action.count;
        const maxGuesses = count === 0 ? UNLIMITED_GUESSES : count + (state.settings.extraGuess ? 1 : 0);
        const record: TurnRecord = { team: state.turn, clue: { word, count }, guesses: [], end: null };
        return {
          ...state,
          phase: "guess",
          clue: { word, count },
          maxGuesses,
          guessesMade: 0,
          votes: {},
          noAgreement: false,
          history: [...state.history, record],
          deadlineAt: timer(state.settings.guessTimer, now),
        };
      }
      case "guess": {
        check(state.phase === "guess", "Wait for the clue");
        check(isAgent(state, actor.id), "Only the guessing team's agents can tap");
        const tile = action.tile;
        check(Number.isInteger(tile) && tile >= 0 && tile < BOARD_SIZE && !state.revealed[tile], "Pick a hidden word");
        if (isVoteMode(state)) return castVote(state, actor.id, tile, now);
        return resolveGuess(state, tile, now);
      }
      case "endTurn": {
        check(state.phase === "guess", "Nothing to end");
        check(isAgent(state, actor.id), "Only the guessing team's agents can end the turn");
        check(state.guessesMade >= 1, "Make at least one guess first");
        if (isVoteMode(state)) return castVote(state, actor.id, "end", now);
        return passTurn(state, "stop", now);
      }
      case "skipTurn": {
        check(actor.isHost, "Only the host can skip");
        check(state.phase === "clue" || state.phase === "guess", "Nothing to skip");
        return passTurn(state, "skip", now);
      }
      case "nextGame": {
        check(actor.isHost, "Only the host starts the next game");
        check(state.phase === "gameEnd", "The game isn't finished");
        const game = state.game + 1;
        const starter: Team =
          state.settings.starter === "random" ? (rng.chance(0.5) ? "sun" : "moon") : other(state.startingTeam);
        return startGame(state, game, starter, rng, now);
      }
      case "@timeout": {
        if (state.phase !== "clue" && state.phase !== "guess") return state;
        if (state.deadlineAt === null || now < state.deadlineAt) return state;
        return passTurn(state, "timeout", now);
      }
    }
  },

  viewFor(state, playerId) {
    const me = playerId !== null && state.order.includes(playerId) ? playerId : null;
    const seated = me !== null;
    const myTeam = me !== null ? state.teams[me] : null;
    const isHandler = me !== null && (state.handlers.sun === me || state.handlers.moon === me);
    const gameDone = state.phase === "gameEnd" || state.phase === "over";
    return {
      phase: state.phase,
      game: state.game,
      totalGames: state.settings.games,
      teams: state.teams,
      members: state.members,
      handlers: state.handlers,
      myTeam,
      myRole: seated ? (isHandler ? "handler" : "agent") : null,
      turn: state.turn,
      startingTeam: state.startingTeam,
      tiles: state.words.map((word, i) => ({
        word,
        revealed: state.revealed[i],
        kind: state.revealed[i] ? state.key[i] : null,
      })),
      key: gameDone || isHandler ? state.key : null,
      remaining: { sun: remaining(state, "sun"), moon: remaining(state, "moon") },
      totals: { sun: owned(state, "sun"), moon: owned(state, "moon") },
      clue: state.clue,
      guessesLeft: state.phase === "guess" ? state.maxGuesses - state.guessesMade : null,
      unlimited: state.phase === "guess" && state.clue?.count === 0,
      guessesMade: state.guessesMade,
      votes: state.votes,
      noAgreement: state.noAgreement,
      history: state.history,
      results: state.results,
      lastResult: state.results.length ? state.results[state.results.length - 1] : null,
      wins: state.wins,
      settings: state.settings,
    };
  },

  activePlayers(state) {
    if (state.phase === "clue") return [state.handlers[state.turn]];
    if (state.phase === "guess") {
      const agents = agentsOf(state, state.turn);
      return isVoteMode(state) ? agents.filter((id) => !(id in state.votes)) : agents;
    }
    return [];
  },

  isOver: (state) => state.phase === "over",

  scores: (state) => rankScores(Object.fromEntries(state.order.map((id) => [id, state.wins[state.teams[id]]]))),

  deadline: (state) => (state.phase === "clue" || state.phase === "guess" ? state.deadlineAt : null),

  botAction(view, legal, rng) {
    if (legal.some((a) => a.type === "clue")) {
      const board = view.tiles.map((t) => t.word);
      const word = BOT_CLUES.filter((c) => !clueProblem(c, board, true))[0] ?? fallbackClue(board);
      return { type: "clue", word, count: 1 };
    }
    const guesses = legalOfType(legal, "guess");
    const end = legal.find((a) => a.type === "endTurn");
    if (guesses.length) {
      if (view.settings.guessMode === "vote") {
        const lead = leadingVote(view.votes);
        if (lead === "end" && end) return end;
        const match = guesses.find((g) => g.tile === lead);
        if (match) return match;
      }
      if (end && rng.chance(0.25)) return end;
      return rng.pick(guesses);
    }
    return rng.pick(legal);
  },
});

// FREE_* placeholders typed as the Action field types (the engine matches them structurally).
const FREE_TEXT_T = FREE_TEXT as string;
const FREE_NUMBER_T = FREE_NUMBER as unknown as number;

function isSeated(state: State, id: PlayerId): boolean {
  return state.order.includes(id);
}

function isVoteMode(state: State): boolean {
  return state.settings.guessMode === "vote";
}

function agentsOf(state: State, team: Team): PlayerId[] {
  return state.members[team].filter((id) => id !== state.handlers[team]);
}

function isAgent(state: State, id: PlayerId): boolean {
  return state.teams[id] === state.turn && state.handlers[state.turn] !== id && isSeated(state, id);
}

function owned(state: State, team: Team): number {
  return state.key.filter((k) => k === team).length;
}

function remaining(state: State, team: Team): number {
  return state.key.filter((k, i) => k === team && !state.revealed[i]).length;
}

function timer(seconds: number, now: number): number | null {
  return seconds > 0 ? now + seconds * 1000 : null;
}

/** New board, key and Handlers for game `game`; phase "clue" for `starter`. */
function startGame(state: State, game: number, starter: Team, rng: Rng, now: number): State {
  const used = new Set(state.usedWords);
  const fresh = WORDS.filter((w) => !used.has(w));
  const pool = fresh.length >= BOARD_SIZE ? fresh : WORDS;
  const words = rng.shuffle(pool).slice(0, BOARD_SIZE);
  const traps = state.settings.trapCount;
  const kinds: TileKind[] = [
    ...Array<TileKind>(9).fill(starter),
    ...Array<TileKind>(8).fill(other(starter)),
    ...Array<TileKind>(traps).fill("trap"),
    ...Array<TileKind>(BOARD_SIZE - 17 - traps).fill("neutral"),
  ];
  const handlers = Object.fromEntries(
    TEAMS.map((t) => {
      const m = state.members[t];
      return [t, m[(state.handlerOffset[t] + game - 1) % m.length]];
    }),
  ) as Record<Team, PlayerId>;
  return {
    ...state,
    game,
    phase: "clue",
    startingTeam: starter,
    turn: starter,
    handlers,
    words,
    key: rng.shuffle(kinds),
    revealed: Array<boolean>(BOARD_SIZE).fill(false),
    clue: null,
    maxGuesses: 0,
    guessesMade: 0,
    votes: {},
    noAgreement: false,
    history: [],
    usedWords: pool === fresh ? [...state.usedWords, ...words] : [...words],
    deadlineAt: timer(state.settings.clueTimer, now),
  };
}

/** Sets `end` on the open history entry of this turn (guess phase), or adds a clue-less entry (clue phase). */
function closeTurn(state: State, end: TurnEnd): TurnRecord[] {
  const last = state.history[state.history.length - 1];
  if (state.phase === "guess" && last && last.end === null) {
    return [...state.history.slice(0, -1), { ...last, end }];
  }
  return [...state.history, { team: state.turn, clue: null, guesses: [], end }];
}

function passTurn(state: State, end: TurnEnd, now: number): State {
  return {
    ...state,
    history: closeTurn(state, end),
    phase: "clue",
    turn: other(state.turn),
    clue: null,
    maxGuesses: 0,
    guessesMade: 0,
    votes: {},
    noAgreement: false,
    deadlineAt: timer(state.settings.clueTimer, now),
  };
}

function finishGame(state: State, winner: Team, reason: GameResult["reason"], end: TurnEnd): State {
  const wins = { ...state.wins, [winner]: state.wins[winner] + 1 };
  return {
    ...state,
    history: closeTurn(state, end),
    phase: state.game < state.settings.games ? "gameEnd" : "over",
    clue: null,
    maxGuesses: 0,
    guessesMade: 0,
    votes: {},
    noAgreement: false,
    results: [...state.results, { game: state.game, winner, reason }],
    wins,
    deadlineAt: null,
  };
}

function resolveGuess(state: State, tile: number, now: number): State {
  const revealed = state.revealed.slice();
  revealed[tile] = true;
  const last = state.history[state.history.length - 1];
  const history = [...state.history.slice(0, -1), { ...last, guesses: [...last.guesses, tile] }];
  const s: State = {
    ...state,
    revealed,
    history,
    guessesMade: state.guessesMade + 1,
    votes: {},
    noAgreement: false,
  };
  const team = state.turn;
  const kind = state.key[tile];
  if (kind === "trap") return finishGame(s, other(team), "trap", "trap");
  if (kind === "neutral") return passTurn(s, "neutral", now);
  if (kind !== team) {
    return remaining(s, kind) === 0 ? finishGame(s, kind, "words", "opponent") : passTurn(s, "opponent", now);
  }
  if (remaining(s, team) === 0) return finishGame(s, team, "words", "complete");
  if (s.guessesMade >= s.maxGuesses) return passTurn(s, "limit", now);
  return s;
}

function castVote(state: State, voter: PlayerId, choice: Vote, now: number): State {
  check(!(voter in state.votes), "You already voted");
  const votes = { ...state.votes, [voter]: choice };
  const agents = agentsOf(state, state.turn);
  const counts = new Map<Vote, number>();
  for (const v of Object.values(votes)) counts.set(v, (counts.get(v) ?? 0) + 1);
  for (const [option, n] of counts) {
    if (n * 2 > agents.length) {
      const cleared = { ...state, votes: {}, noAgreement: false };
      return option === "end" ? passTurn(cleared, "stop", now) : resolveGuess(cleared, option, now);
    }
  }
  if (agents.every((id) => id in votes)) return { ...state, votes: {}, noAgreement: true };
  return { ...state, votes };
}

/** The option with the most votes (ties: the earliest cast), or null. */
function leadingVote(votes: Record<PlayerId, Vote>): Vote | null {
  let best: Vote | null = null;
  let bestN = 0;
  const counts = new Map<Vote, number>();
  for (const v of Object.values(votes)) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** A letters-only clue guaranteed not to clash with normal words. */
function fallbackClue(board: readonly string[]): string {
  for (let k = 3; k < 20; k++) {
    const w = "QZX".repeat(k).slice(0, k + 2);
    if (!clueProblem(w, board, true)) return w;
  }
  return "QZXQZ";
}

export default spywords;
