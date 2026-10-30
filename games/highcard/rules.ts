/**
 * High Card Duel: the reference plugin for ENGINE_CONTRACT.md (hidden from the production lobby).
 * Everyone is dealt a hand. Each round all players secretly pick a card; when everyone has picked,
 * the cards are revealed and the highest rank scores. The host moves to the next round.
 * It shows: hidden hands, simultaneous secret choices, host-only actions, house rules, scoring.
 */
import {
  check,
  defineGame,
  rankScores,
  rankValue,
  removeCard,
  shuffledDeck,
  deal,
  type Card,
  type PlayerId,
} from "../../engine";
import type { Action, State, View, Settings } from "./types";

export type { Action, State, View, Settings };

const highcard = defineGame<State, Action, View, Settings>({
  meta: {
    id: "highcard",
    name: "High Card Duel",
    tagline: "Pick a card in secret. Highest wins.",
    emoji: "🃏",
    category: "cards",
    minPlayers: 2,
    maxPlayers: 8,
    hidden: true,
    howToPlay: [
      "Everyone secretly picks one card from their hand.",
      "When all have picked, cards are revealed. Highest rank scores 1 point.",
      "The host starts each next round. Most points when hands run out wins.",
    ],
  },
  settings: [
    { type: "number", key: "handSize", label: "Cards per player", default: 5, min: 1, max: 6 },
    {
      type: "select",
      key: "tieRule",
      label: "Ties",
      default: "all",
      options: [
        { value: "all", label: "Everyone tied scores" },
        { value: "none", label: "Nobody scores on a tie" },
      ],
    },
    { type: "boolean", key: "aceLow", label: "Ace is low", default: false, group: "Card ranks" },
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const { hands } = deal(shuffledDeck(rng), order.length, settings.handSize);
    return {
      order,
      hands: Object.fromEntries(order.map((id, i) => [id, hands[i]])),
      picks: Object.fromEntries(order.map((id) => [id, null])),
      scores: Object.fromEntries(order.map((id) => [id, 0])),
      round: 1,
      phase: "pick",
      lastWinners: [],
      settings,
    };
  },

  legalActions(state, actor) {
    if (state.phase === "pick") {
      const hand = state.hands[actor.id];
      if (!hand || state.picks[actor.id] !== null) return [];
      return hand.map((card) => ({ type: "pick", card }));
    }
    if (state.phase === "reveal" && actor.isHost) return [{ type: "nextRound" }];
    return [];
  },

  reduce(state, action, { actor }) {
    // The engine only calls reduce with actions from legalActions(); the checks here are a second line of defence.
    switch (action.type) {
      case "pick": {
        check(state.hands[actor.id]?.includes(action.card), "You don't have that card");
        return resolveIfAllPicked({ ...state, picks: { ...state.picks, [actor.id]: action.card } });
      }
      case "nextRound": {
        const hands = Object.fromEntries(
          state.order.map((id) => [id, removeCard(state.hands[id], state.picks[id]!)]),
        );
        const over = Object.values(hands).every((h) => h.length === 0);
        return {
          ...state,
          hands,
          picks: Object.fromEntries(state.order.map((id) => [id, null])),
          round: over ? state.round : state.round + 1,
          phase: over ? "over" : "pick",
        };
      }
    }
  },

  viewFor(state, playerId) {
    // Picks are public only while the round is revealed (they are reset when the next round starts).
    const showAll = state.phase === "reveal";
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.settings.handSize,
      myHand: playerId ? state.hands[playerId] ?? [] : [],
      myPick: playerId ? state.picks[playerId] ?? null : null,
      picked: Object.fromEntries(state.order.map((id) => [id, state.picks[id] !== null])),
      revealed: showAll ? (state.picks as Record<PlayerId, Card>) : null,
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])),
      lastWinners: state.lastWinners,
      scores: state.scores,
    };
  },

  activePlayers(state) {
    if (state.phase !== "pick") return [];
    return state.order.filter((id) => state.picks[id] === null);
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.scores),

  botAction(_view, legal, rng) {
    // Play the lowest card half the time, otherwise random.
    const picks = legal.filter((a) => a.type === "pick");
    if (picks.length && rng.chance(0.5)) {
      return picks.reduce((lo, a) => (rankValue(a.card) < rankValue(lo.card) ? a : lo));
    }
    return rng.pick(legal);
  },
});

function resolveIfAllPicked(state: State): State {
  if (state.order.some((id) => state.picks[id] === null)) return state;
  const value = (c: Card) => rankValue(c, state.settings.aceLow);
  const best = Math.max(...state.order.map((id) => value(state.picks[id]!)));
  const winners = state.order.filter((id) => value(state.picks[id]!) === best);
  const scoring = winners.length > 1 && state.settings.tieRule === "none" ? [] : winners;
  const scores = { ...state.scores };
  for (const id of scoring) scores[id] += 1;
  return { ...state, scores, lastWinners: winners, phase: "reveal" };
}

export default highcard;
