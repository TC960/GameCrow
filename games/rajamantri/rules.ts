/**
 * Raja Mantri Chor Sipahi. Every round each player is secretly dealt one role. The guesser
 * (Mantri by default) and the Raja are revealed; the guesser must find the Chor among the hidden
 * players. A correct guess scores everyone their role's points; a wrong one hands the guesser's
 * points to the Chor (house rule). The host starts each next round. Highest total wins.
 */
import { check, defineGame, rankScores, type PlayerId, type Rng, type SettingField } from "../../engine";
import {
  DEFAULT_ROLE_POINTS,
  ROLE_EMOJI,
  ROLE_NAMES,
  ROLE_ORDER,
  ROLE_POINTS_KEY,
  type Action,
  type Role,
  type RoundResult,
  type Settings,
  type State,
  type View,
} from "./types";

export type { Action, State, View, Settings };

const pointsField = (role: Role, group: string, help?: string): SettingField => ({
  type: "number",
  key: ROLE_POINTS_KEY[role],
  label: `${ROLE_EMOJI[role]} ${ROLE_NAMES[role]} points`,
  default: DEFAULT_ROLE_POINTS[role],
  min: 0,
  max: 5000,
  step: 50,
  group,
  ...(help ? { help } : {}),
});

const EXTRA_GROUP = "Extra roles (5–8 players)";

const rajamantri = defineGame<State, Action, View, Settings>({
  meta: {
    id: "rajamantri",
    name: "Raja Mantri Chor Sipahi",
    tagline: "Secret roles. Can the Mantri catch the Chor?",
    emoji: "👑",
    category: "party",
    minPlayers: 4,
    maxPlayers: 8,
    howToPlay: [
      "Each round everyone gets a secret role. Hold your card to peek at yours.",
      "The Mantri (or Sipahi, by house rule) and the Raja are revealed to all.",
      "The Mantri must point out the Chor among the hidden players.",
      "Right guess: everyone scores their role's points. Wrong: the Chor steals the Mantri's points.",
      "The host starts each next round. Highest total after the last round wins.",
    ],
  },
  settings: [
    { type: "number", key: "rounds", label: "Rounds", default: 5, min: 1, max: 20, group: "Game" },
    {
      type: "select",
      key: "guesser",
      label: "Who guesses the Chor",
      default: "mantri",
      group: "Game",
      options: [
        { value: "mantri", label: "🎩 Mantri" },
        { value: "sipahi", label: "🛡️ Sipahi" },
      ],
    },
    {
      type: "boolean",
      key: "revealRaja",
      label: "Raja reveals himself",
      help: "Show the Raja to everyone each round. Off: the Raja stays hidden and can be (wrongly) accused.",
      default: true,
      group: "Game",
    },
    {
      type: "select",
      key: "wrongGuess",
      label: "Wrong guess",
      default: "swap",
      group: "Game",
      options: [
        { value: "swap", label: "Chor takes the guesser's points" },
        { value: "zero", label: "Guesser scores 0, Chor scores as usual" },
      ],
    },
    pointsField("raja", "Points"),
    pointsField("mantri", "Points"),
    pointsField("sipahi", "Points"),
    pointsField("chor", "Points", "What the Chor scores when caught."),
    pointsField("rani", EXTRA_GROUP, "Added with 5+ players."),
    pointsField("sainik", EXTRA_GROUP, "Added with 6+ players."),
    pointsField("daku", EXTRA_GROUP, "Added with 7+ players."),
    pointsField("pandit", EXTRA_GROUP, "Added with 8 players."),
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    return {
      order,
      settings,
      round: 1,
      history: [],
      totals: Object.fromEntries(order.map((id) => [id, 0])),
      redeals: 0,
      ...dealRound(order, settings, rng),
    };
  },

  legalActions(state, actor) {
    if (!state.order.includes(actor.id)) return [];
    if (state.phase === "guess") {
      if (actor.id === state.guesser) return hiddenPlayers(state).map((target) => ({ type: "guess", target }));
      return actor.isHost ? [{ type: "redeal" }] : [];
    }
    if (state.phase === "reveal" && actor.isHost) return [{ type: "nextRound" }];
    return [];
  },

  reduce(state, action, { actor, rng }) {
    switch (action.type) {
      case "guess": {
        check(state.phase === "guess", "It's not time to guess");
        check(actor.id === state.guesser, `Only the ${ROLE_NAMES[state.settings.guesser]} can guess`);
        check(hiddenPlayers(state).includes(action.target), "Pick one of the hidden players");
        const result = scoreRound(state, action.target);
        const totals = Object.fromEntries(state.order.map((id) => [id, state.totals[id] + result.points[id]]));
        return { ...state, phase: "reveal", history: [...state.history, result], totals };
      }
      case "redeal": {
        check(state.phase === "guess", "You can only re-deal before the guess");
        check(actor.isHost, "Only the host can re-deal");
        check(actor.id !== state.guesser, "You're the guesser: make your guess");
        return { ...state, ...dealRound(state.order, state.settings, rng), redeals: state.redeals + 1 };
      }
      case "nextRound": {
        check(state.phase === "reveal", "The round isn't finished yet");
        check(actor.isHost, "Only the host can start the next round");
        if (state.round >= state.settings.rounds) return { ...state, phase: "over" };
        return { ...state, round: state.round + 1, ...dealRound(state.order, state.settings, rng) };
      }
    }
  },

  viewFor(state, playerId) {
    const me = playerId !== null && state.order.includes(playerId) ? playerId : null;
    const open = state.phase !== "guess";
    const rajaPublic = open || state.settings.revealRaja;
    const roles = Object.fromEntries(
      state.order.map((id) => {
        const visible = open || id === me || id === state.guesser || (rajaPublic && id === state.raja);
        return [id, visible ? state.roles[id] : null];
      }),
    ) as Record<PlayerId, Role | null>;
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.settings.rounds,
      isLastRound: state.round >= state.settings.rounds,
      myRole: me ? state.roles[me] : null,
      roles,
      hiddenPlayers: open ? [] : hiddenPlayers(state),
      guesser: state.guesser,
      guesserRole: state.settings.guesser,
      raja: rajaPublic ? state.raja : null,
      amGuesser: me !== null && me === state.guesser,
      lastResult: open ? state.history[state.history.length - 1] ?? null : null,
      history: state.history,
      totals: state.totals,
      roleTable: rolesInPlay(state.order.length).map((role) => ({
        role,
        name: ROLE_NAMES[role],
        emoji: ROLE_EMOJI[role],
        points: rolePoints(state.settings, role),
      })),
      redeals: state.redeals,
      settings: state.settings,
    };
  },

  activePlayers(state) {
    return state.phase === "guess" ? [state.guesser] : [];
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.totals),

  botAction(_view, legal, rng) {
    // Guess at random among the hidden players; never re-deal.
    const guesses = legal.filter((a) => a.type === "guess");
    return rng.pick(guesses.length ? guesses : legal);
  },
});

function rolesInPlay(n: number): Role[] {
  return ROLE_ORDER.slice(0, n);
}

function rolePoints(settings: Settings, role: Role): number {
  return settings[ROLE_POINTS_KEY[role]];
}

function holderOf(roles: Record<PlayerId, Role>, role: Role): PlayerId {
  return Object.keys(roles).find((id) => roles[id] === role)!;
}

/** Shuffle a fresh set of roles and open the guessing phase. */
function dealRound(
  order: PlayerId[],
  settings: Settings,
  rng: Rng,
): Pick<State, "roles" | "guesser" | "raja" | "phase"> {
  const deck = rng.shuffle(rolesInPlay(order.length));
  const roles = Object.fromEntries(order.map((id, i) => [id, deck[i]])) as Record<PlayerId, Role>;
  return { roles, guesser: holderOf(roles, settings.guesser), raja: holderOf(roles, "raja"), phase: "guess" };
}

/** Players whose role is not public during the guess (never filtered by anyone's secret knowledge). */
function hiddenPlayers(state: State): PlayerId[] {
  return state.order.filter((id) => id !== state.guesser && !(state.settings.revealRaja && id === state.raja));
}

function scoreRound(state: State, accused: PlayerId): RoundResult {
  const { settings, roles, guesser } = state;
  const chor = holderOf(roles, "chor");
  const correct = accused === chor;
  const points = Object.fromEntries(state.order.map((id) => [id, rolePoints(settings, roles[id])]));
  if (!correct) {
    points[guesser] = 0;
    if (settings.wrongGuess === "swap") points[chor] = rolePoints(settings, settings.guesser);
  }
  return { round: state.round, roles, guesser, accused, chor, correct, points };
}

export default rajamantri;
