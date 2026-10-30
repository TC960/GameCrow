/**
 * Hearts. Trick-taking, avoid hearts (1 point each) and Q♠ (13); lowest total wins when someone
 * reaches the target. Simultaneous secret 3-card pass, shooting the moon, optional J♦ −10.
 * Full spec: games/hearts/BRIEF.md.
 */
import {
  check,
  deal,
  defineGame,
  fail,
  followSuitOptions,
  makeDeck,
  rankScores,
  rankValue,
  removeCard,
  removeCards,
  sortCards,
  suitOf,
  trickWinner,
  SYSTEM_ACTOR,
  type Card,
  type PlayerId,
  type Rng,
} from "../../engine";
import {
  HEART_POINTS,
  JACK_OF_DIAMONDS,
  JACK_POINTS,
  MOON_POINTS,
  OPENING_CARD,
  PASS_COUNT,
  QUEEN_OF_SPADES,
  QUEEN_POINTS,
  REMOVED_CARDS,
  passDirectionFor,
  passSource,
  passTarget,
  type Action,
  type HandResult,
  type Settings,
  type State,
  type TrickPlay,
  type View,
} from "./types";

export type { Action, State, View, Settings };

const isHeart = (c: Card) => suitOf(c) === "H";
const isPenalty = (c: Card) => isHeart(c) || c === QUEEN_OF_SPADES;
const byId = <T>(order: readonly PlayerId[], f: (id: PlayerId) => T): Record<PlayerId, T> =>
  Object.fromEntries(order.map((id) => [id, f(id)]));

// ---------------------------------------------------------------------------
// Hand lifecycle
// ---------------------------------------------------------------------------

function startHand(state: State, hand: number, rng: Rng, now: number): State {
  const { order, settings } = state;
  const n = order.length;
  const removed = REMOVED_CARDS[n] ?? [];
  const deck = rng.shuffle(makeDeck().filter((c) => !removed.includes(c)));
  const { hands } = deal(deck, n, deck.length / n);
  const passDirection = passDirectionFor(settings.passPattern, n, hand);
  const next: State = {
    ...state,
    phase: "pass",
    hand,
    dealer: (hand - 1) % n,
    passDirection,
    hands: byId(order, (id) => sortCards(hands[order.indexOf(id)])),
    passSelected: byId(order, () => []),
    passed: byId(order, () => null),
    received: byId(order, () => null),
    turn: null,
    leader: null,
    trick: [],
    trickNumber: 1,
    lastTrick: null,
    heartsBroken: false,
    taken: byId(order, () => []),
    tricksWon: byId(order, () => 0),
    removed,
    turnStartedAt: now,
  };
  return passDirection === "hold" ? beginPlay(next, now) : next;
}

function beginPlay(state: State, now: number): State {
  const { order } = state;
  const opening = OPENING_CARD[order.length];
  const leader =
    state.settings.firstLead === "leftOfDealer"
      ? order[(state.dealer + 1) % order.length]
      : order.find((id) => state.hands[id].includes(opening))!;
  return { ...state, phase: "play", turn: leader, leader, turnStartedAt: now };
}

function exchangePasses(state: State, now: number): State {
  const { order, passDirection } = state;
  const received = byId(order, (id) => state.passed[passSource(order, id, passDirection)!]!);
  const hands = byId(order, (id) => sortCards([...state.hands[id], ...received[id]]));
  return beginPlay({ ...state, hands, received }, now);
}

/** Cards `id` may play now (empty when it's not their turn). */
function legalPlays(state: State, id: PlayerId): Card[] {
  if (state.phase !== "play" || state.turn !== id) return [];
  const { settings } = state;
  const hand = state.hands[id];
  const firstTrick = state.trickNumber === 1;
  let opts: Card[];
  if (state.trick.length === 0) {
    if (firstTrick && settings.firstLead !== "leftOfDealer") {
      const opening = OPENING_CARD[state.order.length];
      return hand.includes(opening) ? [opening] : hand.slice();
    }
    opts = hand.slice();
    if (settings.heartsMustBreak && !state.heartsBroken) {
      const nonHearts = hand.filter((c) => !isHeart(c));
      if (nonHearts.length > 0) opts = nonHearts;
    }
  } else {
    opts = followSuitOptions(hand, suitOf(state.trick[0].card));
  }
  if (firstTrick && settings.noPointsFirstTrick) {
    const clean = opts.filter((c) => !isPenalty(c));
    if (clean.length > 0) opts = clean;
  }
  return opts;
}

function applyPlay(state: State, id: PlayerId, card: Card, now: number): State {
  const { order, settings } = state;
  const hands = { ...state.hands, [id]: removeCard(state.hands[id], card) };
  const trick = [...state.trick, { playerId: id, card }];
  const heartsBroken =
    state.heartsBroken || isHeart(card) || (settings.queenBreaksHearts && card === QUEEN_OF_SPADES);
  if (trick.length < order.length) {
    const turn = order[(order.indexOf(id) + 1) % order.length];
    return { ...state, hands, trick, heartsBroken, turn, turnStartedAt: now };
  }
  const winner = trick[trickWinner(trick.map((p) => p.card), null)].playerId;
  const taken = { ...state.taken, [winner]: [...state.taken[winner], ...trick.map((p) => p.card)] };
  const tricksWon = { ...state.tricksWon, [winner]: state.tricksWon[winner] + 1 };
  const handOver = order.every((p) => hands[p].length === 0);
  const next: State = {
    ...state,
    hands,
    trick: [],
    heartsBroken,
    taken,
    tricksWon,
    lastTrick: { plays: trick, winner },
    trickNumber: handOver ? state.trickNumber : state.trickNumber + 1,
    turn: winner,
    leader: winner,
    turnStartedAt: now,
  };
  return handOver ? scoreHand(next) : next;
}

/** Raw points taken from a pile of won cards. */
function rawPoints(cards: readonly Card[], settings: Settings): { penalty: number; points: number } {
  let penalty = 0;
  for (const c of cards) {
    if (isHeart(c)) penalty += HEART_POINTS;
    else if (c === QUEEN_OF_SPADES) penalty += QUEEN_POINTS;
  }
  const jack = settings.jackOfDiamonds && cards.includes(JACK_OF_DIAMONDS) ? JACK_POINTS : 0;
  return { penalty, points: penalty + jack };
}

function scoreHand(state: State): State {
  const { order, settings } = state;
  const raw = byId(order, (id) => rawPoints(state.taken[id], settings));
  const shooter = settings.moon === "off" ? null : order.find((id) => raw[id].penalty === MOON_POINTS) ?? null;
  const scores = byId(order, (id) => {
    const jack = raw[id].points - raw[id].penalty;
    if (shooter === null) return raw[id].points;
    if (settings.moon === "self") return (id === shooter ? -MOON_POINTS : 0) + jack;
    return (id === shooter ? 0 : MOON_POINTS) + jack;
  });
  const totals = byId(order, (id) => state.totals[id] + scores[id]);
  const result: HandResult = {
    hand: state.hand,
    points: byId(order, (id) => raw[id].points),
    scores,
    moon: shooter,
    totals,
  };
  const over = order.some((id) => totals[id] >= settings.targetScore);
  return {
    ...state,
    totals,
    history: [...state.history, result],
    phase: over ? "over" : "handEnd",
    turn: null,
    leader: null,
  };
}

function deadlineOf(state: State): number | null {
  const timer = state.settings.turnTimer;
  if (!timer || (state.phase !== "pass" && state.phase !== "play")) return null;
  return state.turnStartedAt + timer * 1000;
}

// ---------------------------------------------------------------------------
// Heuristics (bots and the turn timer)
// ---------------------------------------------------------------------------

/** Cards of `hand` ordered from most to least worth passing away. */
function rankPassCards(hand: readonly Card[], jackRule: boolean): Card[] {
  const count = (s: string) => hand.filter((c) => suitOf(c) === s).length;
  const danger = (c: Card): number => {
    const s = suitOf(c);
    const r = rankValue(c);
    if (c === QUEEN_OF_SPADES) return 100;
    if (jackRule && c === JACK_OF_DIAMONDS) return -100;
    if (s === "S" && r >= 13) return 77 + r;
    if (s === "H") return r >= 10 ? 50 + r : r * 1.5;
    const n = count(s);
    return r * 2 + (n <= 3 ? (4 - n) * 3 : 0);
  };
  return hand.slice().sort((a, b) => danger(b) - danger(a) || (a < b ? -1 : a > b ? 1 : 0));
}

interface PlayInfo {
  hand: readonly Card[];
  legal: readonly Card[];
  trick: readonly TrickPlay[];
  players: number;
  /** Q♠ has already been played this hand. */
  queenOut: boolean;
  jackRule: boolean;
}

const lowest = (cards: readonly Card[]) =>
  cards.reduce((lo, c) => (rankValue(c) < rankValue(lo) || (rankValue(c) === rankValue(lo) && c < lo) ? c : lo));
const highest = (cards: readonly Card[]) =>
  cards.reduce((hi, c) => (rankValue(c) > rankValue(hi) || (rankValue(c) === rankValue(hi) && c < hi) ? c : hi));

function chooseCard({ hand, legal, trick, players, queenOut, jackRule }: PlayInfo): Card {
  if (legal.length === 1) return legal[0];
  const queenThreat = !queenOut && !hand.includes(QUEEN_OF_SPADES);
  const notJack = (cards: Card[]) => {
    const rest = jackRule ? cards.filter((c) => c !== JACK_OF_DIAMONDS) : cards;
    return rest.length ? rest : cards;
  };
  if (trick.length === 0) {
    const safe = legal.filter(
      (c) => c !== QUEEN_OF_SPADES && !isHeart(c) && !(suitOf(c) === "S" && rankValue(c) >= 13 && queenThreat),
    );
    return lowest(safe.length ? safe : legal);
  }
  const lead = suitOf(trick[0].card);
  if (suitOf(legal[0]) === lead && legal.every((c) => suitOf(c) === lead)) {
    const winning = Math.max(...trick.filter((p) => suitOf(p.card) === lead).map((p) => rankValue(p.card)));
    const under = legal.filter((c) => rankValue(c) < winning);
    if (under.length) return highest(under);
    const last = trick.length === players - 1;
    const points = trick.some((p) => isPenalty(p.card));
    const nonQueen = legal.filter((c) => c !== QUEEN_OF_SPADES);
    const pool = nonQueen.length ? nonQueen : legal;
    return last && !points ? highest(pool) : lowest(pool);
  }
  // Void in the led suit: dump the most dangerous card.
  if (legal.includes(QUEEN_OF_SPADES)) return QUEEN_OF_SPADES;
  if (queenThreat) {
    const bigSpade = legal.filter((c) => suitOf(c) === "S" && rankValue(c) >= 13);
    if (bigSpade.length) return highest(bigSpade);
  }
  const hearts = legal.filter(isHeart);
  if (hearts.length) return highest(hearts);
  return highest(notJack(legal.slice()));
}

function autoPlay(state: State, id: PlayerId): Card {
  const played = [...Object.values(state.taken).flat(), ...state.trick.map((p) => p.card)];
  return chooseCard({
    hand: state.hands[id],
    legal: legalPlays(state, id),
    trick: state.trick,
    players: state.order.length,
    queenOut: played.includes(QUEEN_OF_SPADES),
    jackRule: state.settings.jackOfDiamonds,
  });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const hearts = defineGame<State, Action, View, Settings>({
  meta: {
    id: "hearts",
    name: "Hearts",
    tagline: "Dodge the hearts and the Queen of Spades. Lowest score wins.",
    emoji: "♥️",
    category: "cards",
    minPlayers: 3,
    maxPlayers: 6,
    howToPlay: [
      "Each hand, pass 3 cards (left, right, across, then keep), all at once.",
      "The 2♣ leads the first trick. Follow suit if you can; highest card of the led suit wins.",
      "Each heart you win is 1 point, the Q♠ is 13. Hearts can't be led until one has been played.",
      "Win every heart and the Q♠ to shoot the moon: everyone else takes 26.",
      "When someone reaches the target score, the lowest total wins.",
    ],
  },
  settings: [
    {
      type: "select",
      key: "passPattern",
      label: "Passing",
      group: "Passing",
      default: "standard",
      help: "3 cards each hand. With 3 or 5 players there is no across pass.",
      options: [
        { value: "standard", label: "Left, right, across, keep" },
        { value: "left", label: "Always left" },
        { value: "leftRight", label: "Left, then right" },
        { value: "none", label: "No passing" },
      ],
    },
    {
      type: "select",
      key: "firstLead",
      label: "First trick",
      group: "Play",
      default: "twoClubs",
      options: [
        { value: "twoClubs", label: "Lowest club (2♣) leads" },
        { value: "leftOfDealer", label: "Player left of the dealer leads" },
      ],
    },
    { type: "boolean", key: "noPointsFirstTrick", label: "No points on the first trick", group: "Play", default: true },
    { type: "boolean", key: "heartsMustBreak", label: "Hearts can't be led until broken", group: "Play", default: true },
    {
      type: "boolean",
      key: "queenBreaksHearts",
      label: "Playing the Q♠ breaks hearts",
      group: "Play",
      default: false,
      visibleIf: { key: "heartsMustBreak", in: [true] },
    },
    {
      type: "select",
      key: "moon",
      label: "Shooting the moon",
      group: "Scoring",
      default: "others",
      options: [
        { value: "others", label: "Everyone else +26" },
        { value: "self", label: "Shooter −26" },
        { value: "off", label: "Off" },
      ],
    },
    { type: "boolean", key: "jackOfDiamonds", label: "J♦ is −10 points", group: "Scoring", default: false },
    { type: "number", key: "targetScore", label: "Game ends at", group: "Scoring", default: 100, min: 10, max: 500, step: 5 },
    {
      type: "number",
      key: "turnTimer",
      label: "Turn timer (seconds)",
      group: "Timer",
      help: "0 = no timer. When time runs out a card is played (or passed) automatically.",
      default: 0,
      min: 0,
      max: 180,
      step: 15,
    },
  ],

  setup(players, settings, { rng, now }) {
    const order = players.map((p) => p.id);
    const base: State = {
      order,
      settings,
      phase: "pass",
      hand: 0,
      dealer: 0,
      passDirection: "hold",
      hands: {},
      passSelected: {},
      passed: {},
      received: {},
      turn: null,
      leader: null,
      trick: [],
      trickNumber: 1,
      lastTrick: null,
      heartsBroken: false,
      taken: {},
      tricksWon: {},
      totals: byId(order, () => 0),
      history: [],
      removed: [],
      turnStartedAt: now,
    };
    return startHand(base, 1, rng, now);
  },

  legalActions(state, actor) {
    const id = actor.id;
    if (!state.order.includes(id)) return [];
    switch (state.phase) {
      case "pass": {
        if (state.passed[id] !== null) return [];
        const sel = state.passSelected[id];
        const out: Action[] = state.hands[id]
          .filter((c) => sel.includes(c) || sel.length < PASS_COUNT)
          .map((card) => ({ type: "togglePass", card }));
        if (sel.length === PASS_COUNT) out.push({ type: "confirmPass" });
        return out;
      }
      case "play":
        return legalPlays(state, id).map((card) => ({ type: "play", card }));
      case "handEnd":
        return actor.isHost ? [{ type: "nextHand" }] : [];
      default:
        return [];
    }
  },

  reduce(state, action, { actor, rng, now }) {
    const id = actor.id;
    switch (action.type) {
      case "togglePass": {
        check(state.phase === "pass" && state.passed[id] === null, "You can't change your pass now");
        check(state.hands[id]?.includes(action.card), "You don't have that card");
        const sel = state.passSelected[id];
        const next = sel.includes(action.card) ? sel.filter((c) => c !== action.card) : [...sel, action.card];
        check(next.length <= PASS_COUNT, `Pick only ${PASS_COUNT} cards`);
        return { ...state, passSelected: { ...state.passSelected, [id]: next } };
      }
      case "confirmPass": {
        check(state.phase === "pass" && state.passed[id] === null, "You already passed");
        const sel = state.passSelected[id];
        check(sel.length === PASS_COUNT, `Pick ${PASS_COUNT} cards to pass`);
        const next: State = {
          ...state,
          hands: { ...state.hands, [id]: removeCards(state.hands[id], sel) },
          passed: { ...state.passed, [id]: sel },
          passSelected: { ...state.passSelected, [id]: [] },
        };
        return next.order.every((p) => next.passed[p] !== null) ? exchangePasses(next, now) : next;
      }
      case "play": {
        check(state.phase === "play" && state.turn === id, "It's not your turn");
        check(legalPlays(state, id).includes(action.card), "You can't play that card");
        return applyPlay(state, id, action.card, now);
      }
      case "nextHand": {
        check(state.phase === "handEnd" && actor.isHost, "Only the host can deal the next hand");
        return startHand(state, state.hand + 1, rng, now);
      }
      case "@timeout": {
        check(id === SYSTEM_ACTOR.id, "Not allowed");
        const due = deadlineOf(state);
        if (due === null || now < due) return state;
        if (state.phase === "pass") {
          let next = state;
          for (const p of state.order) {
            if (next.passed[p] !== null) continue;
            const sel = next.passSelected[p];
            const fill = rankPassCards(next.hands[p], state.settings.jackOfDiamonds).filter((c) => !sel.includes(c));
            const pass = [...sel, ...fill].slice(0, PASS_COUNT);
            next = {
              ...next,
              hands: { ...next.hands, [p]: removeCards(next.hands[p], pass) },
              passed: { ...next.passed, [p]: pass },
              passSelected: { ...next.passSelected, [p]: [] },
            };
          }
          return exchangePasses(next, now);
        }
        const turn = state.turn!;
        return applyPlay(state, turn, autoPlay(state, turn), now);
      }
      default:
        return fail("Unknown action");
    }
  },

  viewFor(state, playerId) {
    const { order, settings } = state;
    const me = playerId !== null && order.includes(playerId) ? playerId : null;
    const hold = state.passDirection === "hold";
    const scoring = (cards: Card[]) =>
      cards.filter((c) => isPenalty(c) || (settings.jackOfDiamonds && c === JACK_OF_DIAMONDS));
    return {
      phase: state.phase,
      hand: state.hand,
      order,
      dealer: order[state.dealer],
      passDirection: state.passDirection,
      passTo: me && !hold ? passTarget(order, me, state.passDirection) : null,
      passFrom: me && !hold ? passSource(order, me, state.passDirection) : null,
      myHand: me ? state.hands[me] : [],
      passSelected: me && state.phase === "pass" ? state.passSelected[me] : [],
      myPassed: me ? state.passed[me] : null,
      received: me ? state.received[me] : null,
      passConfirmed: byId(order, (id) => state.passed[id] !== null),
      handCounts: byId(order, (id) => state.hands[id].length),
      turn: state.turn,
      leader: state.leader,
      trick: state.trick,
      trickNumber: state.trickNumber,
      tricksPerHand: (52 - (REMOVED_CARDS[order.length]?.length ?? 0)) / order.length,
      lastTrick: state.lastTrick,
      heartsBroken: state.heartsBroken,
      pointCards: byId(order, (id) => scoring(state.taken[id])),
      handPoints: byId(order, (id) => rawPoints(state.taken[id], settings).points),
      tricksWon: state.tricksWon,
      totals: state.totals,
      history: state.history,
      lastHand: state.history.length ? state.history[state.history.length - 1] : null,
      removedCards: state.removed,
      targetScore: settings.targetScore,
      settings,
    };
  },

  activePlayers(state) {
    if (state.phase === "pass") return state.order.filter((id) => state.passed[id] === null);
    if (state.phase === "play" && state.turn) return [state.turn];
    return [];
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.totals, false),
  deadline: deadlineOf,

  botAction(view, legal, rng) {
    const confirm = legal.find((a) => a.type === "confirmPass");
    if (confirm) return confirm;
    const toggles = legal.filter((a): a is Extract<Action, { type: "togglePass" }> => a.type === "togglePass");
    if (toggles.length) {
      const want = rankPassCards(view.myHand, view.settings.jackOfDiamonds).slice(0, PASS_COUNT);
      const add = want.find((c) => !view.passSelected.includes(c) && toggles.some((t) => t.card === c));
      if (add) return { type: "togglePass", card: add };
      const drop = view.passSelected.find((c) => !want.includes(c));
      if (drop) return { type: "togglePass", card: drop };
      return rng.pick(toggles);
    }
    const plays = legal.filter((a): a is Extract<Action, { type: "play" }> => a.type === "play");
    if (plays.length) {
      const played = [...Object.values(view.pointCards).flat(), ...view.trick.map((p) => p.card)];
      const card = chooseCard({
        hand: view.myHand,
        legal: plays.map((a) => a.card),
        trick: view.trick,
        players: view.order.length,
        queenOut: played.includes(QUEEN_OF_SPADES),
        jackRule: view.settings.jackOfDiamonds,
      });
      return { type: "play", card };
    }
    return rng.pick(legal);
  },
});

export default hearts;
