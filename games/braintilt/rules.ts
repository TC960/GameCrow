/**
 * Brain Tilt: an original forehead-guessing party game.
 * The guesser holds their phone on their forehead; the others describe the word on it.
 * Tilt down (or tap) = got it, tilt up = pass. Timed rounds via deadline + @timeout.
 * See BRIEF.md for the full spec.
 */
import { check, defineGame, fail, rankScores, type PlayerId, type Rng } from "../../engine";
import { DECK_WORDS } from "./decks";
import {
  DECKS,
  type Action,
  type EndedBy,
  type Role,
  type RoundRecord,
  type Settings,
  type State,
  type View,
  type WordResult,
} from "./types";

export type { Action, State, View, Settings };

const ALL_DECK_IDS = DECKS.map((d) => d.id as string);

function teamOf(state: State, id: PlayerId): number | null {
  if (!state.teams) return null;
  const t = state.teams.findIndex((members) => members.includes(id));
  return t < 0 ? null : t;
}

function guesserOf(state: State): PlayerId | null {
  return state.phase === "over" ? null : (state.turnOrder[state.turn] ?? null);
}

function buildPool(decks: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of DECKS) {
    if (!decks.includes(d.id)) continue;
    for (const w of DECK_WORDS[d.id]) {
      if (!seen.has(w)) {
        seen.add(w);
        out.push(w);
      }
    }
  }
  return out;
}

/** Draw a round's stack. A word repeats only after the whole pool was shown. */
function drawStack(state: State, rng: Rng): { stack: string[]; used: string[] } {
  const pool = buildPool(state.settings.decks);
  const n = Math.min(state.settings.cardsPerRound, pool.length);
  const used = new Set(state.used);
  const unused = pool.filter((w) => !used.has(w));
  if (unused.length >= n) return { stack: rng.shuffle(unused).slice(0, n), used: state.used };
  // New cycle: all unused words first, then old words, avoiding the previous round's words if possible.
  const recent = new Set((state.lastRound?.words ?? []).map((w) => w.word));
  const unusedSet = new Set(unused);
  const older = pool.filter((w) => !unusedSet.has(w) && !recent.has(w));
  const recentOld = pool.filter((w) => !unusedSet.has(w) && recent.has(w));
  const stack = [...rng.shuffle(unused), ...rng.shuffle(older), ...rng.shuffle(recentOld)].slice(0, n);
  return { stack, used: [] };
}

/** Reveal the first card of the stack as the current word. */
function revealNext(state: State): State {
  const [current, ...stack] = state.stack;
  return {
    ...state,
    current,
    stack,
    wordNo: state.wordNo + 1,
    used: [...state.used, current],
  };
}

function beginPlaying(state: State, now: number): State {
  const start = Math.max(state.startsAt ?? now, now);
  return revealNext({
    ...state,
    phase: "playing",
    startsAt: start,
    endsAt: start + state.settings.roundSeconds * 1000,
    wordNo: 0,
  });
}

function endRound(state: State, endedBy: EndedBy): State {
  const guesser = state.turnOrder[state.turn];
  const words: WordResult[] = [...state.roundWords];
  if (endedBy === "time" && state.current !== null) words.push({ word: state.current, result: "timeout" });
  const correct = words.filter((w) => w.result === "correct").length;
  const passed = words.filter((w) => w.result === "pass").length;
  const points = correct - (state.settings.passCostsPoint ? passed : 0);
  const team = teamOf(state, guesser);
  const summary = { turn: state.turn, guesser, team, correct, passed, points, endedBy };
  const record: RoundRecord = { ...summary, words };
  const teamPoints = state.teamPoints ? state.teamPoints.map((p, i) => (i === team ? p + points : p)) : null;
  const turn = state.turn + 1;
  return {
    ...state,
    turn,
    phase: turn >= state.turnOrder.length ? "over" : "ready",
    stack: [],
    current: null,
    wordNo: 0,
    roundWords: [],
    startsAt: null,
    endsAt: null,
    lastRound: record,
    history: [...state.history, summary],
    points: { ...state.points, [guesser]: state.points[guesser] + points },
    teamPoints,
  };
}

const braintilt = defineGame<State, Action, View, Settings>({
  meta: {
    id: "braintilt",
    name: "Brain Tilt",
    tagline: "Phone on your forehead. Friends give clues. Tilt to score!",
    emoji: "🙃",
    category: "party",
    minPlayers: 2,
    maxPlayers: 12,
    orientation: "any",
    howToPlay: [
      "On your turn, tap Start and hold your phone sideways on your forehead, screen facing out.",
      "Everyone else describes or acts out the word on your screen without saying it.",
      "Tilt down (or tap ✓) when you guess it; tilt up (or tap ↷) to pass.",
      "Each correct word scores a point before the timer runs out. Then the next player guesses.",
      "Most points after everyone's turns wins.",
    ],
  },
  settings: [
    { type: "number", key: "roundSeconds", label: "Seconds per round", default: 60, min: 30, max: 180, step: 15, group: "Rounds" },
    { type: "number", key: "getReadySeconds", label: "Get-ready countdown (seconds)", default: 3, min: 0, max: 10, group: "Rounds", help: "Time to put the phone on your forehead after tapping Start." },
    { type: "number", key: "turnsEach", label: "Turns per player", default: 1, min: 1, max: 3, group: "Rounds" },
    { type: "number", key: "cardsPerRound", label: "Cards per round", default: 30, min: 10, max: 50, step: 5, group: "Rounds", help: "The round also ends if all its cards are used." },
    {
      type: "multiselect",
      key: "decks",
      label: "Decks",
      default: [...ALL_DECK_IDS],
      minSelected: 1,
      options: DECKS.map((d) => ({ value: d.id, label: `${d.emoji} ${d.label}` })),
      group: "Words",
    },
    { type: "boolean", key: "othersSeeWord", label: "Show the word on describers' phones", default: true, group: "Screens" },
    {
      type: "select",
      key: "guesserScreen",
      label: "Guesser's phone",
      default: "forehead",
      options: [
        { value: "forehead", label: "Shows the word (on the forehead)" },
        { value: "hidden", label: "Never shows the word" },
      ],
      help: "Hidden: the guesser just listens and taps; others read the word on their own phones.",
      group: "Screens",
    },
    { type: "boolean", key: "passCostsPoint", label: "Each pass costs 1 point", default: false, group: "Scoring" },
    {
      type: "select",
      key: "scoring",
      label: "Scoring",
      default: "solo",
      options: [
        { value: "solo", label: "Every player for themselves" },
        { value: "teams", label: "Teams" },
      ],
      group: "Scoring",
    },
    { type: "number", key: "teamCount", label: "Number of teams", default: 2, min: 2, max: 4, group: "Scoring", visibleIf: { key: "scoring", in: ["teams"] } },
  ],

  validateSettings(settings, players) {
    if (settings.scoring === "teams" && players.length < settings.teamCount * 2) {
      return `Teams need at least 2 players each (${settings.teamCount} teams need ${settings.teamCount * 2} players)`;
    }
    if (settings.guesserScreen === "hidden" && !settings.othersSeeWord) {
      return "Someone has to see the word: turn on \"Show the word on describers' phones\"";
    }
    return null;
  },

  setup(players, settings) {
    const order = players.map((p) => p.id);
    let teams: PlayerId[][] | null = null;
    let turnOrder: PlayerId[] = [];
    if (settings.scoring === "teams") {
      const T = settings.teamCount;
      teams = Array.from({ length: T }, (_, t) => players.filter((p) => p.seat % T === t).map((p) => p.id));
      const largest = Math.max(...teams.map((m) => m.length));
      for (let k = 0; k < settings.turnsEach * largest; k++) {
        for (const members of teams) turnOrder.push(members[k % members.length]);
      }
    } else {
      for (let r = 0; r < settings.turnsEach; r++) turnOrder = turnOrder.concat(order);
    }
    return {
      order,
      settings,
      teams,
      turnOrder,
      turn: 0,
      phase: "ready",
      stack: [],
      current: null,
      wordNo: 0,
      roundWords: [],
      startsAt: null,
      endsAt: null,
      used: [],
      lastRound: null,
      history: [],
      points: Object.fromEntries(order.map((id) => [id, 0])),
      teamPoints: teams ? teams.map(() => 0) : null,
    };
  },

  legalActions(state, actor) {
    if (!state.order.includes(actor.id)) return [];
    const guesser = guesserOf(state);
    if (state.phase === "ready") {
      if (actor.id === guesser) return [{ type: "start" }, { type: "skipTurn" }];
      if (actor.isHost) return [{ type: "skipTurn" }];
      return [];
    }
    if (state.phase === "playing" && actor.id === guesser && state.current !== null) {
      return [
        { type: "mark", result: "correct", wordNo: state.wordNo },
        { type: "mark", result: "pass", wordNo: state.wordNo },
      ];
    }
    return [];
  },

  reduce(state, action, { actor, rng, now }) {
    const guesser = guesserOf(state);
    switch (action.type) {
      case "start": {
        check(state.phase === "ready", "The round already started");
        check(actor.id === guesser, "It's not your turn to guess");
        const { stack, used } = drawStack(state, rng);
        check(stack.length > 0, "No words to play");
        const startsAt = now + state.settings.getReadySeconds * 1000;
        const next: State = { ...state, stack, used, roundWords: [], wordNo: 0, current: null, startsAt, endsAt: null };
        return state.settings.getReadySeconds > 0 ? { ...next, phase: "countdown" } : beginPlaying(next, now);
      }
      case "skipTurn": {
        check(state.phase === "ready", "You can only skip before the round starts");
        check(actor.id === guesser || actor.isHost, "Only the guesser or the host can skip");
        return endRound(state, "skip");
      }
      case "mark": {
        check(state.phase === "playing" && state.current !== null, "The round isn't running");
        check(actor.id === guesser, "Only the guesser can mark words");
        check(action.wordNo === state.wordNo, "That word is already done");
        check(action.result === "correct" || action.result === "pass", "Invalid result");
        // Timer already ran out (the server timeout just hasn't fired yet): end the round, ignore the mark.
        if (state.endsAt !== null && now >= state.endsAt) return endRound(state, "time");
        const marked: State = {
          ...state,
          roundWords: [...state.roundWords, { word: state.current, result: action.result }],
          current: null,
        };
        return marked.stack.length === 0 ? endRound(marked, "cards") : revealNext(marked);
      }
      case "@timeout": {
        if (state.phase === "countdown") return beginPlaying(state, now);
        if (state.phase === "playing") return endRound(state, "time");
        return state;
      }
      default:
        fail("Unknown action");
    }
  },

  viewFor(state, playerId) {
    const seated = playerId !== null && state.order.includes(playerId);
    const guesser = guesserOf(state);
    const amGuesser = seated && playerId === guesser;
    const myTeam = seated ? teamOf(state, playerId) : null;
    const guesserTeam = guesser ? teamOf(state, guesser) : null;

    let role: Role;
    if (!seated) role = "spectator";
    else if (state.phase === "over") role = "none";
    else if (amGuesser) role = "guesser";
    else if (state.teams && myTeam !== guesserTeam) role = "watcher";
    else role = "describer";

    let word: string | null = null;
    if (state.phase === "playing" && seated) {
      const allowed = amGuesser ? state.settings.guesserScreen === "forehead" : state.settings.othersSeeWord;
      if (allowed) word = state.current;
    }

    const next = state.turn + 1 < state.turnOrder.length && state.phase !== "over" ? state.turnOrder[state.turn + 1] : null;

    return {
      phase: state.phase,
      settings: state.settings,
      turn: state.turn,
      totalTurns: state.turnOrder.length,
      turnOrder: state.turnOrder,
      guesser,
      nextGuesser: next,
      role,
      teams: state.teams,
      myTeam,
      guesserTeam,
      word,
      wordNo: state.wordNo,
      cardsLeft: state.stack.length,
      roundWords: state.roundWords,
      startsAt: state.startsAt,
      endsAt: state.endsAt,
      lastRound: state.lastRound,
      history: state.history,
      points: state.points,
      teamPoints: state.teamPoints,
    };
  },

  activePlayers(state) {
    const g = guesserOf(state);
    return g ? [g] : [];
  },

  isOver: (state) => state.phase === "over",

  scores(state) {
    if (state.teams && state.teamPoints) {
      const tp = state.teamPoints;
      return rankScores(Object.fromEntries(state.order.map((id) => [id, tp[teamOf(state, id) ?? 0]])));
    }
    return rankScores(state.points);
  },

  deadline(state) {
    if (state.phase === "countdown") return state.startsAt;
    if (state.phase === "playing") return state.endsAt;
    return null;
  },

  botAction(_view, legal, rng) {
    const start = legal.find((a) => a.type === "start");
    if (start) return start;
    const marks = legal.filter((a) => a.type === "mark");
    if (marks.length) {
      const want = rng.chance(0.6) ? "correct" : "pass";
      return marks.find((a) => a.type === "mark" && a.result === want) ?? marks[0];
    }
    return rng.pick(legal);
  },
});

export default braintilt;
