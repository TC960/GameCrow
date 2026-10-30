/**
 * Joker (Old-Maid style). All cards are dealt, pairs are thrown out, and on your turn you draw one
 * face-down card from a neighbour's hand by position. Empty hand = safe. Whoever is left holding
 * the Joker (the one card that can never pair) loses. See BRIEF.md for the full rules.
 */
import {
  FREE_NUMBER,
  check,
  dealAll,
  defineGame,
  isJoker,
  isRedSuit,
  makeDeck,
  parseCard,
  rankScores,
  sortCards,
  type Card,
  type PlayerId,
  type Rng,
} from "../../engine";
import { JOKER, REMOVED_QUEEN } from "./types";
import type { Action, PairDiscard, State, View, Settings, DrawRecord, RoundResult } from "./types";

export type { Action, State, View, Settings };

const joker = defineGame<State, Action, View, Settings>({
  meta: {
    id: "joker",
    name: "Joker",
    tagline: "Draw blind from your neighbour. Don't get stuck with the Joker.",
    emoji: "🤡",
    category: "cards",
    minPlayers: 2,
    maxPlayers: 8,
    howToPlay: [
      "All cards are dealt. Pairs of the same rank are thrown out face up automatically.",
      "On your turn, pick one face-down card from your neighbour's hand.",
      "If it makes a pair with one of your cards, the pair is thrown out.",
      "Run out of cards and you're safe. Whoever is left holding the Joker loses.",
    ],
  },
  settings: [
    {
      type: "select",
      key: "deck",
      label: "Loser card",
      default: "joker",
      options: [
        { value: "joker", label: "Add one Joker (53 cards)" },
        { value: "queen", label: "Remove a Queen: Old Maid (51 cards)" },
      ],
    },
    {
      type: "boolean",
      key: "matchColour",
      label: "Pairs must match colour",
      help: "A pair is same rank and same colour (♠♣ or ♥♦).",
      default: false,
    },
    {
      type: "select",
      key: "drawFrom",
      label: "Draw from",
      default: "next",
      options: [
        { value: "next", label: "Next player (clockwise)" },
        { value: "previous", label: "Previous player (classic Old Maid)" },
      ],
    },
    {
      type: "select",
      key: "handOrder",
      label: "Hand order",
      help: "Arrange: before each draw, the player being drawn from may rearrange or shuffle their hand, then offers it.",
      default: "shuffle",
      options: [
        { value: "shuffle", label: "Auto-shuffled after every draw" },
        { value: "arrange", label: "Holder arranges, then offers" },
      ],
    },
    { type: "number", key: "rounds", label: "Rounds", default: 1, min: 1, max: 10, group: "Rounds" },
    {
      type: "select",
      key: "scoring",
      label: "Winner over rounds",
      group: "Rounds",
      default: "places",
      options: [
        { value: "places", label: "Most place points (first out scores most)" },
        { value: "losses", label: "Fewest times stuck with the Joker" },
      ],
      visibleIf: { key: "rounds", in: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
    },
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const zero = Object.fromEntries(order.map((id) => [id, 0]));
    const base: State = {
      order,
      settings,
      phase: "play",
      step: "draw",
      round: 1,
      hands: {},
      turn: null,
      target: null,
      places: {},
      pairs: [],
      lastDraw: null,
      points: { ...zero },
      losses: { ...zero },
      results: [],
      loserCards: [],
    };
    return dealRound(base, 1, rng);
  },

  legalActions(state, actor) {
    if (!state.order.includes(actor.id)) return [];
    if (state.phase === "roundOver") return actor.isHost ? [{ type: "nextRound" }] : [];
    if (state.phase !== "play" || !state.turn || !state.target) return [];
    const out: Action[] = [];
    const active = state.step === "offer" ? state.target : state.turn;
    if (state.step === "offer" && actor.id === state.target) {
      out.push({ type: "offer" });
      const hand = state.hands[actor.id];
      if (hand.length >= 2) {
        out.push({ type: "shuffle" });
        for (const card of hand) out.push({ type: "move", card, to: FREE_NUMBER as unknown as number });
      }
    }
    if (state.step === "draw" && actor.id === state.turn) {
      const n = state.hands[state.target].length;
      for (let index = 0; index < n; index++) out.push({ type: "draw", index });
    }
    if (actor.isHost && active !== actor.id) out.push({ type: "skipTurn" });
    return out;
  },

  reduce(state, action, { actor, rng }) {
    switch (action.type) {
      case "draw":
        return applyDraw(state, actor.id, action.index, rng);

      case "offer":
        check(state.phase === "play" && state.step === "offer" && actor.id === state.target, "Not your hand to offer");
        return { ...state, step: "draw" };

      case "shuffle": {
        check(state.phase === "play" && state.step === "offer" && actor.id === state.target, "You can't shuffle now");
        return { ...state, hands: { ...state.hands, [actor.id]: rng.shuffle(state.hands[actor.id]) } };
      }

      case "move": {
        check(state.phase === "play" && state.step === "offer" && actor.id === state.target, "You can't rearrange now");
        const hand = state.hands[actor.id];
        const from = hand.indexOf(action.card);
        check(from >= 0, "You don't have that card");
        const to = action.to;
        check(Number.isInteger(to) && to >= 0 && to < hand.length, "Pick a position in your hand");
        const rest = [...hand.slice(0, from), ...hand.slice(from + 1)];
        const next = [...rest.slice(0, to), action.card, ...rest.slice(to)];
        return { ...state, hands: { ...state.hands, [actor.id]: next } };
      }

      case "skipTurn": {
        check(state.phase === "play" && state.turn !== null, "Nothing to skip");
        if (state.step === "offer") return { ...state, step: "draw" };
        return passTurn(state, state.turn!);
      }

      case "nextRound": {
        check(state.phase === "roundOver", "The round isn't over");
        return dealRound(state, state.round + 1, rng);
      }
    }
  },

  viewFor(state, playerId) {
    const seated = playerId !== null && state.order.includes(playerId);
    const ld = state.lastDraw;
    return {
      phase: state.phase,
      step: state.phase === "play" ? state.step : null,
      round: state.round,
      totalRounds: state.settings.rounds,
      settings: state.settings,
      order: state.order,
      myHand: seated ? [...state.hands[playerId!]] : [],
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])),
      turn: state.turn,
      target: state.target,
      places: state.places,
      pairs: state.pairs,
      lastDraw: ld ? { drawer: ld.drawer, from: ld.from, index: ld.index, paired: ld.paired, out: ld.out } : null,
      myDrawnCard: seated && ld && ld.drawer === playerId ? ld.card : null,
      points: state.points,
      losses: state.losses,
      results: state.results,
      loserCards: state.loserCards,
    };
  },

  activePlayers(state) {
    if (state.phase !== "play" || !state.turn || !state.target) return [];
    return [state.step === "offer" ? state.target : state.turn];
  },

  isOver: (state) => state.phase === "over",

  scores(state) {
    if (state.settings.scoring === "losses") return rankScores({ ...state.losses }, false);
    const n = state.order.length;
    const totals: Record<PlayerId, number> = { ...state.points };
    if (state.phase === "play") {
      for (const id of state.order) {
        const place = state.places[id];
        if (place !== null) totals[id] += n - place;
      }
    }
    return rankScores(totals, true);
  },

  botAction(_view, legal, rng) {
    const draws = legal.filter((a) => a.type === "draw");
    if (draws.length) return rng.pick(draws);
    const offer = legal.find((a) => a.type === "offer");
    if (offer) {
      const shuffle = legal.find((a) => a.type === "shuffle");
      return shuffle && rng.chance(0.3) ? shuffle : offer;
    }
    const next = legal.find((a) => a.type === "nextRound");
    return next ?? rng.pick(legal);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Key that two cards must share to pair; null for the Joker (never pairs). */
function pairKey(card: Card, matchColour: boolean): string | null {
  if (isJoker(card)) return null;
  const p = parseCard(card);
  return matchColour ? `${p.rank}${isRedSuit(p.suit!) ? "r" : "b"}` : p.rank!;
}

function buildDeck(settings: Settings): Card[] {
  if (settings.deck === "queen") return makeDeck().filter((c) => c !== REMOVED_QUEEN);
  const deck = makeDeck({ jokers: 1 });
  check(deck.includes(JOKER), "Deck is missing the Joker");
  return deck;
}

/** Throw out every pair in a hand. Returns the kept cards and the pairs (deterministic order). */
function discardPairs(hand: readonly Card[], matchColour: boolean): { kept: Card[]; pairs: Card[][] } {
  const groups = new Map<string, Card[]>();
  const kept: Card[] = [];
  for (const c of sortCards(hand, "rank")) {
    const k = pairKey(c, matchColour);
    if (k === null) kept.push(c);
    else groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const pairs: Card[][] = [];
  for (const cards of groups.values()) {
    for (let i = 0; i + 1 < cards.length; i += 2) pairs.push([cards[i], cards[i + 1]]);
    if (cards.length % 2 === 1) kept.push(cards[cards.length - 1]);
  }
  return { kept, pairs };
}

/** Players still holding cards, in seat order. */
function holders(state: Pick<State, "order" | "hands">): PlayerId[] {
  return state.order.filter((id) => state.hands[id].length > 0);
}

/** Next player clockwise (dir 1) or counter-clockwise (dir -1) after `from` who holds cards, excluding `from`. */
function neighbour(state: Pick<State, "order" | "hands">, from: PlayerId, dir: 1 | -1): PlayerId | null {
  const n = state.order.length;
  const i = state.order.indexOf(from);
  for (let k = 1; k < n; k++) {
    const id = state.order[(((i + dir * k) % n) + n) % n];
    if (state.hands[id].length > 0) return id;
  }
  return null;
}

function targetOf(state: State, drawer: PlayerId): PlayerId | null {
  return neighbour(state, drawer, state.settings.drawFrom === "previous" ? -1 : 1);
}

/** Deal round `round` (fresh deck, initial discards) into `prev`, keeping points/losses/results. */
function dealRound(prev: State, round: number, rng: Rng): State {
  const { order, settings } = prev;
  const n = order.length;
  const starterSeat = (round - 1) % n;
  const dealt = dealAll(rng.shuffle(buildDeck(settings)), n, starterSeat);
  const hands: Record<PlayerId, Card[]> = {};
  const pairs: PairDiscard[] = [];
  order.forEach((id, seat) => {
    const { kept, pairs: thrown } = discardPairs(dealt[seat], settings.matchColour);
    for (const cards of thrown) pairs.push({ by: id, cards });
    hands[id] = rng.shuffle(kept);
  });
  const places: Record<PlayerId, number | null> = Object.fromEntries(
    order.map((id) => [id, hands[id].length === 0 ? 1 : null]),
  );
  let state: State = {
    ...prev,
    phase: "play",
    step: settings.handOrder === "arrange" ? "offer" : "draw",
    round,
    hands,
    turn: null,
    target: null,
    places,
    pairs,
    lastDraw: null,
    loserCards: [],
  };
  if (holders(state).length <= 1) return endRound(state);
  const starter = order[starterSeat];
  const turn = hands[starter].length > 0 ? starter : neighbour(state, starter, 1)!;
  state = { ...state, turn, target: targetOf(state, turn) };
  return state;
}

/** Pass the turn clockwise from `after` to the next holder; recompute target and step. */
function passTurn(state: State, after: PlayerId): State {
  const turn = neighbour(state, after, 1)!;
  return {
    ...state,
    turn,
    target: targetOf(state, turn),
    step: state.settings.handOrder === "arrange" ? "offer" : "draw",
  };
}

function applyDraw(state: State, drawer: PlayerId, index: number, rng: Rng): State {
  check(state.phase === "play" && state.step === "draw" && state.turn === drawer, "It's not your turn to draw");
  const from = state.target!;
  const fromHand = state.hands[from];
  check(Number.isInteger(index) && index >= 0 && index < fromHand.length, "Pick one of their cards");
  const card = fromHand[index];
  let targetHand = [...fromHand.slice(0, index), ...fromHand.slice(index + 1)];
  let drawerHand = state.hands[drawer];

  const { matchColour, handOrder } = state.settings;
  const key = pairKey(card, matchColour);
  const matchAt = key === null ? -1 : drawerHand.findIndex((c) => pairKey(c, matchColour) === key);
  let paired: Card[] | null = null;
  const pairs = [...state.pairs];
  if (matchAt >= 0) {
    paired = [drawerHand[matchAt], card];
    pairs.push({ by: drawer, cards: paired });
    drawerHand = [...drawerHand.slice(0, matchAt), ...drawerHand.slice(matchAt + 1)];
  } else if (handOrder === "arrange") {
    const at = rng.int(0, drawerHand.length);
    drawerHand = [...drawerHand.slice(0, at), card, ...drawerHand.slice(at)];
  } else {
    drawerHand = [...drawerHand, card];
  }
  if (handOrder !== "arrange") {
    drawerHand = rng.shuffle(drawerHand);
    targetHand = rng.shuffle(targetHand);
  }

  const hands = { ...state.hands, [drawer]: drawerHand, [from]: targetHand };
  const alreadyOut = state.order.filter((id) => state.places[id] !== null).length;
  const out = [from, drawer].filter((id) => hands[id].length === 0 && state.places[id] === null);
  const places = { ...state.places };
  for (const id of out) places[id] = alreadyOut + 1;
  const lastDraw: DrawRecord = { drawer, from, index, card, paired, out };

  const next: State = { ...state, hands, places, pairs, lastDraw };
  if (holders(next).length <= 1) return endRound(next);
  return passTurn(next, drawer);
}

/** Exactly one player still holds cards: they lose the round. */
function endRound(state: State): State {
  const n = state.order.length;
  const left = holders(state);
  check(left.length === 1, "Round ended without a single loser");
  const loser = left[0];
  const places: Record<PlayerId, number> = {};
  for (const id of state.order) places[id] = id === loser ? n : (state.places[id] ?? n);
  const roundPoints = Object.fromEntries(state.order.map((id) => [id, n - places[id]]));
  const result: RoundResult = {
    round: state.round,
    loser,
    places,
    points: roundPoints,
  };
  return {
    ...state,
    phase: state.round >= state.settings.rounds ? "over" : "roundOver",
    hands: { ...state.hands, [loser]: [] },
    turn: null,
    target: null,
    places,
    points: Object.fromEntries(state.order.map((id) => [id, state.points[id] + roundPoints[id]])),
    losses: { ...state.losses, [loser]: state.losses[loser] + 1 },
    results: [...state.results, result],
    loserCards: [...state.hands[loser]],
  };
}

export default joker;
