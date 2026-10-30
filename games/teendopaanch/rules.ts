/**
 * Teen Do Paanch (3-2-5): the Indian 3-player trick game. Spec: games/teendopaanch/BRIEF.md.
 * 30 cards, 10 each, targets 5/3/2 rotating each hand, the 5-player calls trump after 5 cards,
 * follow suit, and overtrick players pull cards from short players at the start of the next hand.
 */
import {
  check,
  defineGame,
  deal,
  followSuitOptions,
  nextPlayer,
  rankScores,
  rankValue,
  removeCard,
  makeDeck,
  suitOf,
  trickWinner,
  SUITS,
  type Card,
  type PlayerId,
  type Rank,
  type Rng,
  type Suit,
} from "../../engine";
import {
  CARDS_PER_BATCH,
  TRICKS_PER_HAND,
  type Action,
  type Exchange,
  type PullStep,
  type Settings,
  type State,
  type View,
} from "./types";

export type { Action, State, View, Settings };

const RANKS_30: readonly Rank[] = ["7", "8", "9", "T", "J", "Q", "K", "A"];

const REMOVED_SEVENS: Record<string, Card[]> = {
  clubsDiamonds: ["7C", "7D"],
  heartsDiamonds: ["7H", "7D"],
  spadesClubs: ["7S", "7C"],
};

/** The 30-card deck for these settings (unshuffled). */
export function deckFor(settings: Pick<Settings, "removedSevens">): Card[] {
  const removed = REMOVED_SEVENS[settings.removedSevens] ?? REMOVED_SEVENS.clubsDiamonds;
  return makeDeck({ ranks: RANKS_30 }).filter((c) => !removed.includes(c));
}

const zeros = (order: PlayerId[]) => Object.fromEntries(order.map((id) => [id, 0])) as Record<PlayerId, number>;

/** Targets for hand `hand` (1-based): seat (h-1)%3 gets 5, h%3 gets 3, (h+1)%3 gets 2 (the dealer). */
function seatsFor(order: PlayerId[], hand: number) {
  const n = order.length;
  const five = order[(hand - 1) % n];
  const three = order[hand % n];
  const two = order[(hand + 1) % n];
  return { five, three, two, targets: { [five]: 5, [three]: 3, [two]: 2 } as Record<PlayerId, number> };
}

/** Deal a new hand onto `base` (which carries order, settings, totals, history). */
function dealHand(
  base: Pick<State, "order" | "settings" | "totals" | "history">,
  hand: number,
  owed: Record<PlayerId, number>,
  rng: Rng,
): State {
  const { order, settings } = base;
  const deck = rng.shuffle(deckFor(settings));
  const first = deal(deck, order.length, CARDS_PER_BATCH);
  const second = deal(first.rest, order.length, CARDS_PER_BATCH);
  const all = settings.trumpCallAfter === "all";
  const seats = seatsFor(order, hand);
  return {
    order,
    settings,
    phase: "trump",
    hand,
    dealer: seats.two,
    targets: seats.targets,
    trumpMaker: seats.five,
    trump: null,
    hands: Object.fromEntries(order.map((id, i) => [id, all ? [...first.hands[i], ...second.hands[i]] : first.hands[i]])),
    secondBatch: Object.fromEntries(order.map((id, i) => [id, all ? [] : second.hands[i]])),
    pullQueue: [],
    exchanges: [],
    owed,
    leader: seats.five,
    turn: null,
    trick: [],
    lastTrick: null,
    tricksWon: zeros(order),
    totals: base.totals,
    history: base.history,
  };
}

/** Pulls for this hand: pullers clockwise from the trump maker, victims clockwise after each puller. */
export function computePulls(order: PlayerId[], owed: Record<PlayerId, number>, trumpMaker: PlayerId): PullStep[] {
  const rotate = (from: PlayerId) => {
    const i = order.indexOf(from);
    return order.map((_, k) => order[(i + k) % order.length]);
  };
  const deficit: Record<PlayerId, number> = Object.fromEntries(order.map((id) => [id, Math.max(0, -(owed[id] ?? 0))]));
  const steps: PullStep[] = [];
  for (const puller of rotate(trumpMaker)) {
    let surplus = Math.max(0, owed[puller] ?? 0);
    for (const victim of rotate(puller).slice(1)) {
      while (surplus > 0 && deficit[victim] > 0) {
        steps.push({ puller, victim });
        surplus--;
        deficit[victim]--;
      }
    }
  }
  return steps;
}

function startPlay(state: State): State {
  return { ...state, phase: "play", pullQueue: [], leader: state.trumpMaker, turn: state.trumpMaker, trick: [] };
}

function endHand(state: State): State {
  const diffs = Object.fromEntries(state.order.map((id) => [id, state.tricksWon[id] - state.targets[id]]));
  const totals = Object.fromEntries(state.order.map((id) => [id, state.totals[id] + diffs[id]]));
  const history = [
    ...state.history,
    { hand: state.hand, dealer: state.dealer, trump: state.trump!, targets: state.targets, tricks: state.tricksWon, diffs },
  ];
  const s = state.settings;
  const reached = s.endRule === "points" && Object.values(totals).some((t) => t >= s.targetPoints);
  const over = state.hand >= s.hands || reached;
  return { ...state, totals, history, phase: over ? "over" : "handEnd", turn: null, trick: [] };
}

function legalPlays(state: State, id: PlayerId): Card[] {
  const lead = state.trick.length ? suitOf(state.trick[0].card) : null;
  return followSuitOptions(state.hands[id], lead);
}

const teendopaanch = defineGame<State, Action, View, Settings>({
  meta: {
    id: "teendopaanch",
    name: "Teen Do Paanch",
    tagline: "3-2-5: hit your trick target, then pull cards from whoever fell short.",
    emoji: "🎯",
    category: "cards",
    minPlayers: 3,
    maxPlayers: 3,
    howToPlay: [
      "30 cards, 10 each. Targets rotate every hand: 5, 3 and 2 tricks (the dealer needs 2).",
      "The 5-trick player picks trump after seeing their first 5 cards, then leads.",
      "Follow suit if you can. Highest trump wins, else highest card of the led suit.",
      "Score = tricks won minus target, added up over all hands.",
      "Next hand, players with extra tricks pull: pass a card, get back the victim's highest of that suit.",
    ],
  },
  settings: [
    { type: "number", key: "hands", label: "Hands", default: 6, min: 1, max: 30, help: "Multiples of 3 give everyone each target equally. In 'first to points' mode this is the maximum." },
    {
      type: "select",
      key: "endRule",
      label: "Game ends",
      default: "hands",
      options: [
        { value: "hands", label: "After a fixed number of hands" },
        { value: "points", label: "When someone reaches a total" },
      ],
    },
    { type: "number", key: "targetPoints", label: "Winning total", default: 5, min: 1, max: 20, visibleIf: { key: "endRule", in: ["points"] } },
    {
      type: "select",
      key: "removedSevens",
      label: "Sevens removed",
      default: "clubsDiamonds",
      group: "Deck & deal",
      options: [
        { value: "clubsDiamonds", label: "7♣ and 7♦ (keep 7♠ 7♥)" },
        { value: "heartsDiamonds", label: "7♥ and 7♦ (keep black 7s)" },
        { value: "spadesClubs", label: "7♠ and 7♣ (keep red 7s)" },
      ],
    },
    {
      type: "select",
      key: "trumpCallAfter",
      label: "Trump is called after",
      default: "five",
      group: "Deck & deal",
      options: [
        { value: "five", label: "The first 5 cards" },
        { value: "all", label: "All 10 cards (easier)" },
      ],
    },
    {
      type: "select",
      key: "pullRule",
      label: "Pulling cards",
      default: "highest",
      group: "Exchange",
      help: "Each extra trick lets you pass a card to a player who fell short; they must return their highest card of that suit.",
      options: [
        { value: "highest", label: "On (return highest of the suit)" },
        { value: "off", label: "Off" },
      ],
    },
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    return dealHand({ order, settings, totals: zeros(order), history: [] }, 1, zeros(order), rng);
  },

  legalActions(state, actor) {
    const id = actor.id;
    if (!state.order.includes(id)) return [];
    switch (state.phase) {
      case "trump":
        return id === state.trumpMaker ? SUITS.map((suit) => ({ type: "trump" as const, suit })) : [];
      case "exchange":
        return state.pullQueue[0]?.puller === id ? state.hands[id].map((card) => ({ type: "pull" as const, card })) : [];
      case "play":
        return state.turn === id ? legalPlays(state, id).map((card) => ({ type: "play" as const, card })) : [];
      case "handEnd":
        return actor.isHost ? [{ type: "nextHand" as const }] : [];
      default:
        return [];
    }
  },

  reduce(state, action, { actor, rng }) {
    switch (action.type) {
      case "trump": {
        check(state.phase === "trump" && actor.id === state.trumpMaker, "Only the 5-trick player picks trump");
        check((SUITS as readonly string[]).includes(action.suit), "Pick a suit");
        const hands = Object.fromEntries(state.order.map((id) => [id, [...state.hands[id], ...state.secondBatch[id]]]));
        const secondBatch = Object.fromEntries(state.order.map((id) => [id, [] as Card[]]));
        const pullQueue =
          state.settings.pullRule === "highest" ? computePulls(state.order, state.owed, state.trumpMaker) : [];
        const next: State = { ...state, trump: action.suit, hands, secondBatch, pullQueue };
        return pullQueue.length ? { ...next, phase: "exchange" } : startPlay(next);
      }
      case "pull": {
        const step = state.pullQueue[0];
        check(state.phase === "exchange" && step?.puller === actor.id, "It's not your pull");
        const given = action.card;
        const pullerHand = removeCard(state.hands[step.puller], given);
        const victimHand = [...state.hands[step.victim], given];
        const suit = suitOf(given);
        const returned = victimHand
          .filter((c) => suitOf(c) === suit)
          .reduce((best, c) => (rankValue(c) > rankValue(best) ? c : best));
        const hands =
          returned === given
            ? state.hands
            : { ...state.hands, [step.puller]: [...pullerHand, returned], [step.victim]: removeCard(victimHand, returned) };
        const exchange: Exchange = { puller: step.puller, victim: step.victim, given, returned };
        const next: State = { ...state, hands, pullQueue: state.pullQueue.slice(1), exchanges: [...state.exchanges, exchange] };
        return next.pullQueue.length ? next : startPlay(next);
      }
      case "play": {
        check(state.phase === "play" && state.turn === actor.id, "It's not your turn");
        check(legalPlays(state, actor.id).includes(action.card), "You must follow suit");
        const hands = { ...state.hands, [actor.id]: removeCard(state.hands[actor.id], action.card) };
        const trick = [...state.trick, { playerId: actor.id, card: action.card }];
        if (trick.length < state.order.length) {
          return { ...state, hands, trick, turn: nextPlayer(state.order, actor.id) };
        }
        const winner = trick[trickWinner(trick.map((t) => t.card), state.trump)].playerId;
        const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
        const next: State = { ...state, hands, trick: [], tricksWon, lastTrick: { plays: trick, winner }, leader: winner, turn: winner };
        const played = Object.values(tricksWon).reduce((a, b) => a + b, 0);
        return played >= TRICKS_PER_HAND ? endHand(next) : next;
      }
      case "nextHand": {
        check(state.phase === "handEnd" && actor.isHost, "Only the host deals the next hand");
        const owed = state.history[state.history.length - 1].diffs;
        return dealHand(state, state.hand + 1, owed, rng);
      }
    }
  },

  viewFor(state, playerId) {
    const me = playerId !== null && state.order.includes(playerId) ? playerId : null;
    const played = Object.values(state.tricksWon).reduce((a, b) => a + b, 0);
    return {
      phase: state.phase,
      hand: state.hand,
      totalHands: state.settings.hands,
      settings: state.settings,
      order: state.order,
      dealer: state.dealer,
      targets: state.targets,
      trumpMaker: state.trumpMaker,
      trump: state.trump,
      myHand: me ? state.hands[me] : [],
      awaitingSecondBatch: state.order.some((id) => state.secondBatch[id].length > 0),
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])),
      pullQueue: state.pullQueue,
      exchanges: state.exchanges.map((e) =>
        me === e.puller || me === e.victim ? e : { puller: e.puller, victim: e.victim, given: null, returned: null },
      ),
      owed: state.owed,
      leader: state.leader,
      turn: state.turn,
      trick: state.trick,
      trickNumber: Math.min(TRICKS_PER_HAND, played + 1),
      lastTrick: state.lastTrick,
      tricksWon: state.tricksWon,
      totals: state.totals,
      history: state.history,
    };
  },

  activePlayers(state) {
    switch (state.phase) {
      case "trump":
        return [state.trumpMaker];
      case "exchange":
        return state.pullQueue.length ? [state.pullQueue[0].puller] : [];
      case "play":
        return state.turn ? [state.turn] : [];
      default:
        return [];
    }
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.totals),

  botAction(view, legal, rng) {
    const trumps = legal.filter((a) => a.type === "trump");
    if (trumps.length) return botTrump(view.myHand);
    const pulls = legal.filter((a) => a.type === "pull");
    if (pulls.length) return { type: "pull", card: lowestPreferNonTrump(pulls.map((a) => a.card), view.trump) };
    const plays = legal.filter((a) => a.type === "play");
    if (plays.length) return { type: "play", card: botPlay(view, plays.map((a) => a.card)) };
    return rng.pick(legal);
  },
});

// ---------------------------------------------------------------------------
// Bot helpers (only use the bot's own view)
// ---------------------------------------------------------------------------

function botTrump(hand: Card[]): Action {
  let best: Suit = SUITS[0];
  let bestKey = [-1, -1];
  for (const s of SUITS) {
    const cards = hand.filter((c) => suitOf(c) === s);
    const key = [cards.length, cards.reduce((t, c) => t + rankValue(c), 0)];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = s;
      bestKey = key;
    }
  }
  return { type: "trump", suit: best };
}

const lowest = (cards: Card[]) => cards.reduce((lo, c) => (rankValue(c) < rankValue(lo) ? c : lo));
const highest = (cards: Card[]) => cards.reduce((hi, c) => (rankValue(c) > rankValue(hi) ? c : hi));

function lowestPreferNonTrump(cards: Card[], trump: Suit | null): Card {
  const plain = cards.filter((c) => suitOf(c) !== trump);
  return lowest(plain.length ? plain : cards);
}

function botPlay(view: View, options: Card[]): Card {
  if (view.trick.length === 0) {
    const top = highest(options);
    if (top[0] === "A") return top;
    const plain = options.filter((c) => suitOf(c) !== view.trump);
    if (!plain.length) return lowest(options);
    const count = (s: Suit) => plain.filter((c) => suitOf(c) === s).length;
    const longest = plain.reduce((a, c) => (count(suitOf(c)) > count(suitOf(a)) ? c : a));
    return lowest(plain.filter((c) => suitOf(c) === suitOf(longest)));
  }
  const cards = view.trick.map((t) => t.card);
  const winners = options.filter((c) => trickWinner([...cards, c], view.trump) === cards.length);
  if (winners.length) return lowest(winners);
  return lowestPreferNonTrump(options, view.trump);
}

export default teendopaanch;
