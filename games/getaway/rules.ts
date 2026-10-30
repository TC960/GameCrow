/**
 * Get Away (Bhabhi): an Indian shedding trick game. See BRIEF.md for the binding rules.
 * Deal the whole deck; the A♠ holder leads; follow suit if able. If everyone follows, the trick is
 * discarded and the highest card leads. If someone can't follow, they cut: the trick ends and the
 * highest card of the led suit picks the whole trick up. Empty your hand to get away; the last
 * player holding cards is the Bhabhi.
 */
import {
  check,
  dealAll,
  defineGame,
  followSuitOptions,
  legalOfType,
  nextPlayer,
  rankScores,
  rankValue,
  removeCard,
  shuffledDeck,
  sortCards,
  suitOf,
  type Card,
  type PlayerId,
  type Rng,
  type Suit,
} from "../../engine";
import {
  ALL_OUT_RULE,
  OPENING_CARD,
  OPENING_LEAD,
  SCORING,
  type Action,
  type Play,
  type ResolvedTrick,
  type RoundResult,
  type Settings,
  type State,
  type View,
} from "./types";

export type { Action, State, View, Settings };

const BOT_SUIT_ORDER: readonly Suit[] = ["S", "H", "C", "D"];

const getaway = defineGame<State, Action, View, Settings>({
  meta: {
    id: "getaway",
    name: "Get Away (Bhabhi)",
    tagline: "Shed every card. Don't be the Bhabhi.",
    emoji: "🏃",
    category: "cards",
    minPlayers: 3,
    maxPlayers: 8,
    howToPlay: [
      "The whole deck is dealt. Whoever has the A♠ leads it.",
      "Follow suit if you can. If everyone follows, the trick is thrown away and the highest card leads next.",
      "Can't follow? Play any card to cut: the trick stops and the highest card of the led suit picks it all up.",
      "Empty your hand to get away safely.",
      "The last player still holding cards is the Bhabhi and loses.",
    ],
  },
  settings: [
    {
      type: "number",
      key: "rounds",
      label: "Rounds",
      default: 1,
      min: 1,
      max: 10,
      group: "Match",
      help: "The host deals each next round. Losses are counted across rounds.",
    },
    {
      type: "select",
      key: "scoring",
      label: "Ranking",
      default: SCORING.placement,
      group: "Match",
      options: [
        { value: SCORING.placement, label: "Finishing order (points for getting away early)" },
        { value: SCORING.losses, label: "Fewest times Bhabhi" },
      ],
    },
    {
      type: "select",
      key: "openingLead",
      label: "Opening lead",
      default: OPENING_LEAD.aceSpades,
      group: "Play",
      options: [
        { value: OPENING_LEAD.aceSpades, label: "A♠ holder must lead the A♠" },
        { value: OPENING_LEAD.anyCard, label: "A♠ holder leads any card" },
      ],
    },
    {
      type: "boolean",
      key: "firstTrickCut",
      label: "Allow cuts on the first trick",
      default: false,
      group: "Play",
      help: "Off: on the first trick an off-suit card does not cut; the trick is thrown away as normal.",
    },
    {
      type: "boolean",
      key: "lastCardSafe",
      label: "Your last card always gets you away",
      default: false,
      group: "Play",
      help: "On: if you played your last card you never pick up a cut trick; the next-highest card still in hand does.",
    },
    {
      type: "select",
      key: "allOutRule",
      label: "If everyone left runs out on the same trick",
      default: ALL_OUT_RULE.trickWinner,
      group: "Play",
      options: [
        { value: ALL_OUT_RULE.trickWinner, label: "Highest card of that trick is the Bhabhi" },
        { value: ALL_OUT_RULE.draw, label: "No Bhabhi that round" },
      ],
    },
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const zero = () => Object.fromEntries(order.map((id) => [id, 0]));
    const base: State = {
      order,
      settings,
      phase: "play",
      round: 0,
      hands: {},
      trickNo: 1,
      trickPlayers: [],
      trick: [],
      ledSuit: null,
      turn: null,
      safe: [],
      discardCount: 0,
      lastTrick: null,
      bhabhi: null,
      losses: zero(),
      points: zero(),
      history: [],
    };
    return startRound(base, 1, rng);
  },

  legalActions(state, actor) {
    if (state.phase === "roundOver") return actor.isHost ? [{ type: "nextRound" }] : [];
    if (state.phase !== "play" || actor.id !== state.turn) return [];
    const hand = state.hands[actor.id] ?? [];
    return playableCards(state, hand).map((card) => ({ type: "play", card }));
  },

  reduce(state, action, { actor, rng }) {
    switch (action.type) {
      case "nextRound": {
        check(state.phase === "roundOver", "The round isn't over yet");
        check(actor.isHost, "Only the host can deal the next round");
        return startRound(state, state.round + 1, rng);
      }
      case "play": {
        check(state.phase === "play", "The round is over");
        check(state.turn === actor.id, "It's not your turn");
        const hand = state.hands[actor.id] ?? [];
        check(hand.includes(action.card), "You don't have that card");
        check(playableCards(state, hand).includes(action.card), "You must follow suit");
        return playCard(state, actor.id, action.card);
      }
    }
  },

  viewFor(state, playerId) {
    const isSeated = playerId !== null && state.order.includes(playerId);
    const safeSet = new Set(state.safe.flat());
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.settings.rounds,
      settings: state.settings,
      myHand: isSeated ? [...(state.hands[playerId] ?? [])] : [],
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id]?.length ?? 0])),
      trickNo: state.trickNo,
      trickPlayers: state.trickPlayers,
      trick: state.trick,
      ledSuit: state.ledSuit,
      turn: state.turn,
      cutsAllowed: cutsAllowed(state),
      highest: state.ledSuit ? highestOfSuit(state.trick, state.ledSuit)?.playerId ?? null : null,
      safe: state.safe,
      inPlay: state.order.filter((id) => !safeSet.has(id)),
      discardCount: state.discardCount,
      lastTrick: state.lastTrick,
      bhabhi: state.bhabhi,
      losses: state.losses,
      points: state.points,
      history: state.history,
    };
  },

  activePlayers: (state) => (state.phase === "play" && state.turn ? [state.turn] : []),
  isOver: (state) => state.phase === "over",

  scores(state) {
    if (state.settings.scoring === SCORING.losses) return rankScores(state.losses, false);
    const totals = { ...state.points };
    if (state.phase === "play") {
      const earned = placementPoints(state.order.length, state.safe);
      for (const id of state.order) totals[id] += earned[id] ?? 0;
    }
    return rankScores(totals, true);
  },

  botAction(view, legal, _rng: Rng) {
    const plays = legalOfType(legal, "play");
    if (plays.length === 0) return legal[0];
    if (plays.length === 1) return plays[0];
    const cards = plays.map((a) => a.card);
    const play = (card: Card): Action => ({ type: "play", card });
    const byRank = (a: Card, b: Card) => rankValue(a) - rankValue(b);
    const lowest = (cs: Card[]) => cs.slice().sort(byRank)[0];
    const highest = (cs: Card[]) => cs.slice().sort(byRank)[cs.length - 1];

    // Leading: lowest card of the longest suit.
    if (view.trick.length === 0 || view.ledSuit === null) {
      let best: Suit = BOT_SUIT_ORDER[0];
      let bestLen = -1;
      for (const s of BOT_SUIT_ORDER) {
        const len = cards.filter((c) => suitOf(c) === s).length;
        if (len > bestLen) {
          best = s;
          bestLen = len;
        }
      }
      return play(lowest(cards.filter((c) => suitOf(c) === best)));
    }

    const led = view.ledSuit;
    const following = cards.every((c) => suitOf(c) === led);
    if (!following) return play(highest(cards)); // void: dump the biggest liability

    const lastToPlay = view.trick.length === view.trickPlayers.length - 1;
    if (lastToPlay) return play(highest(cards));
    const top = highestOfSuit(view.trick, led);
    const under = top ? cards.filter((c) => rankValue(c) < rankValue(top.card)) : [];
    if (under.length > 0) return play(highest(under));
    return play(lowest(cards));
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startRound(state: State, round: number, rng: Rng): State {
  const n = state.order.length;
  const dealt = dealAll(shuffledDeck(rng), n, round % n);
  const hands = Object.fromEntries(state.order.map((id, i) => [id, sortCards(dealt[i])]));
  const leader = state.order.find((id) => hands[id].includes(OPENING_CARD))!;
  return {
    ...state,
    phase: "play",
    round,
    hands,
    trickNo: 1,
    trickPlayers: trickPlayersFrom(state.order, hands, leader),
    trick: [],
    ledSuit: null,
    turn: leader,
    safe: [],
    discardCount: 0,
    lastTrick: null,
    bhabhi: null,
  };
}

/** Everyone holding cards, clockwise from the leader. */
function trickPlayersFrom(order: PlayerId[], hands: Record<PlayerId, Card[]>, leader: PlayerId): PlayerId[] {
  const start = order.indexOf(leader);
  const out: PlayerId[] = [];
  for (let k = 0; k < order.length; k++) {
    const id = order[(start + k) % order.length];
    if ((hands[id]?.length ?? 0) > 0) out.push(id);
  }
  return out;
}

function cutsAllowed(state: State): boolean {
  return state.trickNo > 1 || state.settings.firstTrickCut;
}

function playableCards(state: State, hand: Card[]): Card[] {
  if (state.ledSuit === null) {
    if (state.trickNo === 1 && state.settings.openingLead === OPENING_LEAD.aceSpades && hand.includes(OPENING_CARD)) {
      return [OPENING_CARD];
    }
    return hand.slice();
  }
  return followSuitOptions(hand, state.ledSuit);
}

function highestOfSuit(plays: readonly Play[], suit: Suit): Play | null {
  let best: Play | null = null;
  for (const p of plays) {
    if (suitOf(p.card) !== suit) continue;
    if (!best || rankValue(p.card) > rankValue(best.card)) best = p;
  }
  return best;
}

function playCard(state: State, actor: PlayerId, card: Card): State {
  const hands = { ...state.hands, [actor]: removeCard(state.hands[actor], card) };
  const trick = [...state.trick, { playerId: actor, card }];
  const ledSuit = state.ledSuit ?? suitOf(card);
  const next: State = { ...state, hands, trick, ledSuit };
  const isCut = suitOf(card) !== ledSuit && cutsAllowed(state);
  if (isCut) return endTrick(next, actor);
  if (trick.length >= state.trickPlayers.length) return endTrick(next, null);
  return { ...next, turn: state.trickPlayers[trick.length] };
}

/** Resolve the trick in `state.trick`. `cutBy` is the cutter, or null when the trick completed. */
function endTrick(state: State, cutBy: PlayerId | null): State {
  const ledSuit = state.ledSuit!;
  const plays = state.trick;
  const top = highestOfSuit(plays, ledSuit)!; // the lead is always of the led suit
  const hasCards = (hands: Record<PlayerId, Card[]>, id: PlayerId) => (hands[id]?.length ?? 0) > 0;
  let hands = state.hands;
  let discardCount = state.discardCount;
  let pickedUpBy: PlayerId | null = null;
  let nextLeader: PlayerId;

  if (cutBy !== null) {
    const candidates = state.settings.lastCardSafe ? plays.filter((p) => hasCards(hands, p.playerId)) : plays;
    const picker = highestOfSuit(candidates, ledSuit);
    if (picker) {
      pickedUpBy = picker.playerId;
      hands = { ...hands, [picker.playerId]: sortCards([...hands[picker.playerId], ...plays.map((p) => p.card)]) };
      nextLeader = picker.playerId;
    } else {
      discardCount += plays.length;
      nextLeader = top.playerId;
    }
  } else {
    discardCount += plays.length;
    nextLeader = top.playerId;
  }

  // Escapes: trick players left with no cards.
  const escaped = state.trickPlayers.filter((id) => !hasCards(hands, id));
  let safe = escaped.length > 0 ? [...state.safe, escaped] : state.safe;
  const remaining = state.order.filter((id) => hasCards(hands, id));

  if (!hasCards(hands, nextLeader) && remaining.length > 0) {
    nextLeader = nextPlayer(state.order, nextLeader, (id) => !hasCards(hands, id));
  }

  const resolved: ResolvedTrick = {
    trickNo: state.trickNo,
    plays,
    ledSuit,
    outcome: pickedUpBy ? "pickedUp" : "discarded",
    cutBy,
    pickedUpBy,
    highest: top.playerId,
    nextLeader: remaining.length >= 2 ? nextLeader : null,
    escaped,
  };
  const base: State = { ...state, hands, discardCount, lastTrick: resolved, trick: [], ledSuit: null };

  if (remaining.length >= 2) {
    return {
      ...base,
      safe,
      trickNo: state.trickNo + 1,
      trickPlayers: trickPlayersFrom(state.order, hands, nextLeader),
      turn: nextLeader,
    };
  }

  let bhabhi: PlayerId | null = remaining[0] ?? null;
  if (remaining.length === 0 && state.settings.allOutRule === ALL_OUT_RULE.trickWinner) {
    bhabhi = top.playerId;
    const last = safe[safe.length - 1].filter((id) => id !== bhabhi);
    safe = last.length > 0 ? [...safe.slice(0, -1), last] : safe.slice(0, -1);
  }
  return finishRound({ ...base, safe }, bhabhi);
}

/** n - (players in this group and every earlier group), for each safe player. */
function placementPoints(n: number, safe: PlayerId[][]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  let finished = 0;
  for (const group of safe) {
    finished += group.length;
    for (const id of group) out[id] = n - finished;
  }
  return out;
}

function finishRound(state: State, bhabhi: PlayerId | null): State {
  const earned = placementPoints(state.order.length, state.safe);
  const roundPoints = Object.fromEntries(state.order.map((id) => [id, earned[id] ?? 0]));
  const points = Object.fromEntries(state.order.map((id) => [id, state.points[id] + roundPoints[id]]));
  const losses = bhabhi ? { ...state.losses, [bhabhi]: state.losses[bhabhi] + 1 } : state.losses;
  const result: RoundResult = { round: state.round, safe: state.safe, bhabhi, points: roundPoints };
  return {
    ...state,
    phase: state.round >= state.settings.rounds ? "over" : "roundOver",
    turn: null,
    trickPlayers: [],
    bhabhi,
    points,
    losses,
    history: [...state.history, result],
  };
}

export default getaway;
