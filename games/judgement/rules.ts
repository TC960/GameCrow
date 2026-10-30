/**
 * Judgement (a.k.a. Kachuful / Oh Hell): bid exactly how many tricks you will take.
 * See games/judgement/BRIEF.md and NOTES.md for the rules and house-rule settings.
 */
import {
  check,
  deal,
  defineGame,
  fail,
  followSuitOptions,
  nextPlayer,
  rankScores,
  rankValue,
  removeCard,
  shuffledDeck,
  sortCards,
  suitOf,
  trickWinner,
  type Actor,
  type Card,
  type PlayerId,
  type Rng,
  type Suit,
} from "../../engine";
import {
  HURRY_MS,
  handSizeSequence,
  trumpForRound,
  type Action,
  type CompletedTrick,
  type RoundResult,
  type Settings,
  type State,
  type View,
} from "./types";

export type { Action, State, View, Settings };

type MoveAction = Extract<Action, { type: "bid" } | { type: "play" }>;

const judgement = defineGame<State, Action, View, Settings>({
  meta: {
    id: "judgement",
    name: "Judgement",
    tagline: "Bid your tricks. Hit the number exactly.",
    emoji: "⚖️",
    category: "cards",
    minPlayers: 3,
    maxPlayers: 8,
    howToPlay: [
      "Every round deals one card fewer: 7 cards each, then 6, down to 1. Trump rotates ♠ ♦ ♣ ♥.",
      "Starting left of the dealer, everyone bids how many tricks they will win. The dealer bids last and can't make the bids add up to the cards dealt.",
      "Follow the led suit if you can; if you can't, play anything. Highest trump wins, otherwise the highest card of the led suit.",
      "Win exactly your bid to score 10 + your bid. Miss by any amount and you score 0.",
      "The host starts each next round. Highest total after the last round wins.",
    ],
  },

  settings: [
    { type: "number", key: "startCards", label: "Starting cards", default: 7, min: 1, max: 13, group: "Rounds", help: "Cards each in the biggest round. Cards × players must fit in 52." },
    {
      type: "select",
      key: "sequence",
      label: "Hand sizes",
      default: "down",
      group: "Rounds",
      options: [
        { value: "down", label: "Down (7, 6 … 1)" },
        { value: "downUp", label: "Down and back up (7 … 1 … 7)" },
        { value: "up", label: "Up (1, 2 … 7)" },
      ],
    },
    { type: "boolean", key: "noTrump", label: "No-trump round", default: false, group: "Trumps", help: "Adds a no-trump round after Hearts in the ♠ ♦ ♣ ♥ rotation." },
    { type: "boolean", key: "lastBidderRule", label: "Dealer can't make bids add up", default: true, group: "Bidding", help: "The last bidder may not bid the number that makes the total equal the cards dealt." },
    { type: "boolean", key: "mustTrumpWhenVoid", label: "Must trump when void", default: false, group: "Play", help: "If you can't follow suit but hold a trump, you must play a trump." },
    { type: "number", key: "exactBonus", label: "Bonus for an exact bid", default: 10, min: 0, max: 50, group: "Scoring" },
    { type: "number", key: "perTrick", label: "Points per bid trick", default: 1, min: 0, max: 10, group: "Scoring", help: "Exact bid scores bonus + this × bid." },
    {
      type: "select",
      key: "missPenalty",
      label: "Missed bid",
      default: "zero",
      group: "Scoring",
      options: [
        { value: "zero", label: "Score 0" },
        { value: "minusBid", label: "Lose your bid (−bid)" },
        { value: "minusDiff", label: "Lose the difference (−|bid − won|)" },
      ],
    },
    { type: "number", key: "turnTimer", label: "Turn timer (seconds, 0 = off)", default: 0, min: 0, max: 120, step: 15, group: "Timer", help: "When time runs out the game bids or plays for that player." },
  ],

  validateSettings(settings, players) {
    const need = settings.startCards * players.length;
    if (need > 52) {
      const max = Math.floor(52 / players.length);
      return `${settings.startCards} cards × ${players.length} players needs ${need} cards, but the deck has 52. Set Starting cards to ${max} or fewer.`;
    }
    return null;
  },

  setup(players, settings, { rng, now }) {
    const order = players.map((p) => p.id);
    const zero = Object.fromEntries(order.map((id) => [id, 0]));
    const base = {
      order,
      settings,
      handSizes: handSizeSequence(settings.startCards, settings.sequence),
      totals: zero,
      history: [],
    };
    return startRound(base, 1, order[0], rng, now);
  },

  legalActions(state, actor) {
    const out: Action[] = [...moveOptions(state, actor.id)];
    if (actor.isHost) out.push(...hostOptions(state, actor));
    return out;
  },

  reduce(state, action, { actor, rng, now }) {
    switch (action.type) {
      case "bid": {
        check(state.phase === "bidding", "It's not time to bid");
        check(state.turn === actor.id, "It's not your turn to bid");
        return applyMove(state, actor.id, action, now);
      }
      case "play": {
        check(state.phase === "playing", "It's not time to play cards");
        check(state.turn === actor.id, "It's not your turn");
        return applyMove(state, actor.id, action, now);
      }
      case "nextRound": {
        check(actor.isHost, "Only the host can start the next round");
        check(state.phase === "summary", "The round isn't over yet");
        return startRound(state, state.round + 1, nextPlayer(state.order, state.dealer), rng, now);
      }
      case "hurry": {
        check(actor.isHost, "Only the host can hurry players");
        check(state.phase === "bidding" || state.phase === "playing", "Nobody to hurry right now");
        check(state.turn !== null && state.turn !== actor.id, "It's your own turn");
        check(state.deadline === null, "A timer is already running");
        return { ...state, deadline: now + HURRY_MS };
      }
      case "@timeout": {
        if ((state.phase !== "bidding" && state.phase !== "playing") || state.turn === null || state.deadline === null) {
          return state.deadline === null ? state : { ...state, deadline: null };
        }
        const who = state.turn;
        const move = chooseMove(viewFor(state, who), moveOptions(state, who), rng);
        return applyMove(state, who, move, now);
      }
    }
  },

  viewFor,

  activePlayers(state) {
    return (state.phase === "bidding" || state.phase === "playing") && state.turn !== null ? [state.turn] : [];
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.totals),
  deadline: (state) => state.deadline,

  botAction(view, legal, rng) {
    const moves = legal.filter((a): a is MoveAction => a.type === "bid" || a.type === "play");
    if (moves.length) return chooseMove(view, moves, rng);
    return legal.find((a) => a.type === "nextRound") ?? rng.pick(legal);
  },
});

export default judgement;

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

type RoundBase = Pick<State, "order" | "settings" | "handSizes" | "totals" | "history">;

function startRound(base: RoundBase, round: number, dealer: PlayerId, rng: Rng, now: number): State {
  const { order, settings, handSizes } = base;
  const handSize = handSizes[round - 1];
  const di = order.indexOf(dealer);
  const bidOrder = order.map((_, k) => order[(di + 1 + k) % order.length]);
  const { hands } = deal(shuffledDeck(rng), order.length, handSize);
  const state: State = {
    order,
    settings,
    handSizes,
    totals: base.totals,
    history: base.history,
    phase: "bidding",
    round,
    handSize,
    trump: trumpForRound(round, settings.noTrump),
    dealer,
    bidOrder,
    hands: Object.fromEntries(order.map((id, i) => [id, sortCards(hands[i])])),
    bids: Object.fromEntries(order.map((id) => [id, null])),
    tricksWon: Object.fromEntries(order.map((id) => [id, 0])),
    turn: bidOrder[0],
    leader: null,
    trick: [],
    lastTrick: null,
    tricksPlayed: 0,
    deadline: null,
  };
  return withTimer(state, now);
}

/** Turn timer: a fresh deadline for whoever must move now (or none). */
function withTimer(state: State, now: number): State {
  const waiting = (state.phase === "bidding" || state.phase === "playing") && state.turn !== null;
  const deadline = waiting && state.settings.turnTimer > 0 ? now + state.settings.turnTimer * 1000 : null;
  return state.deadline === deadline ? state : { ...state, deadline };
}

/** The bid the current bidder may not make, or null. */
function forbiddenBid(state: State): number | null {
  if (state.phase !== "bidding" || !state.settings.lastBidderRule) return null;
  const others = state.bidOrder.filter((id) => state.bids[id] !== null);
  if (others.length !== state.order.length - 1) return null;
  const sum = others.reduce((s, id) => s + (state.bids[id] ?? 0), 0);
  const f = state.handSize - sum;
  return f >= 0 && f <= state.handSize ? f : null;
}

function ledSuit(state: State): Suit | null {
  return state.trick.length ? suitOf(state.trick[0].card) : null;
}

/** Cards `id` may play now (empty when it's not their turn). */
function playableCards(state: State, id: PlayerId): Card[] {
  if (state.phase !== "playing" || state.turn !== id) return [];
  const hand = state.hands[id] ?? [];
  const led = ledSuit(state);
  const options = followSuitOptions(hand, led);
  if (led !== null && state.settings.mustTrumpWhenVoid && state.trump !== null && !options.some((c) => suitOf(c) === led)) {
    const trumps = options.filter((c) => suitOf(c) === state.trump);
    if (trumps.length) return trumps;
  }
  return options;
}

/** Bids/plays `id` may make now. */
function moveOptions(state: State, id: PlayerId): MoveAction[] {
  if (state.turn !== id) return [];
  if (state.phase === "bidding") {
    const forbidden = forbiddenBid(state);
    const out: MoveAction[] = [];
    for (let b = 0; b <= state.handSize; b++) if (b !== forbidden) out.push({ type: "bid", bid: b });
    return out;
  }
  if (state.phase === "playing") return playableCards(state, id).map((card) => ({ type: "play", card }));
  return [];
}

function hostOptions(state: State, actor: Actor): Action[] {
  if (state.phase === "summary") return [{ type: "nextRound" }];
  if ((state.phase === "bidding" || state.phase === "playing") && state.turn !== null && state.turn !== actor.id && state.deadline === null) {
    return [{ type: "hurry" }];
  }
  return [];
}

function applyMove(state: State, who: PlayerId, move: MoveAction, now: number): State {
  if (move.type === "bid") {
    check(state.phase === "bidding", "It's not time to bid");
    const bid = move.bid;
    check(Number.isInteger(bid) && bid >= 0 && bid <= state.handSize, `Bid between 0 and ${state.handSize}`);
    const forbidden = forbiddenBid(state);
    if (bid === forbidden) fail(`You can't bid ${bid}: the bids would add up to ${state.handSize}`);
    const bids = { ...state.bids, [who]: bid };
    const idx = state.bidOrder.indexOf(who);
    const done = idx === state.bidOrder.length - 1;
    const next: State = done
      ? { ...state, bids, phase: "playing", turn: state.bidOrder[0], leader: state.bidOrder[0] }
      : { ...state, bids, turn: state.bidOrder[idx + 1] };
    return withTimer({ ...next, deadline: null }, now);
  }

  check(state.phase === "playing", "It's not time to play cards");
  const hand = state.hands[who] ?? [];
  check(hand.includes(move.card), "You don't have that card");
  if (!playableCards(state, who).includes(move.card)) {
    const led = ledSuit(state)!;
    const hasLed = hand.some((c) => suitOf(c) === led);
    fail(hasLed ? "You must follow suit" : "You must play a trump");
  }
  const hands = { ...state.hands, [who]: removeCard(hand, move.card) };
  const trick = [...state.trick, { player: who, card: move.card }];
  if (trick.length < state.order.length) {
    return withTimer({ ...state, hands, trick, turn: nextPlayer(state.order, who), deadline: null }, now);
  }

  // Trick complete.
  const w = trickWinner(trick.map((p) => p.card), state.trump);
  const lastTrick: CompletedTrick = { plays: trick, winner: trick[w].player, winningCard: trick[w].card };
  const tricksWon = { ...state.tricksWon, [lastTrick.winner]: state.tricksWon[lastTrick.winner] + 1 };
  const tricksPlayed = state.tricksPlayed + 1;
  const after: State = { ...state, hands, trick: [], lastTrick, tricksWon, tricksPlayed, deadline: null };
  if (tricksPlayed < state.handSize) {
    return withTimer({ ...after, turn: lastTrick.winner, leader: lastTrick.winner }, now);
  }
  return finishRound(after);
}

function roundPoints(bid: number, won: number, s: Settings): number {
  if (bid === won) return s.exactBonus + s.perTrick * bid;
  const loss = s.missPenalty === "minusBid" ? bid : s.missPenalty === "minusDiff" ? Math.abs(bid - won) : 0;
  return loss === 0 ? 0 : -loss;
}

function finishRound(state: State): State {
  const bids = Object.fromEntries(state.order.map((id) => [id, state.bids[id] ?? 0]));
  const points = Object.fromEntries(state.order.map((id) => [id, roundPoints(bids[id], state.tricksWon[id], state.settings)]));
  const totals = Object.fromEntries(state.order.map((id) => [id, state.totals[id] + points[id]]));
  const result: RoundResult = {
    round: state.round,
    handSize: state.handSize,
    trump: state.trump,
    dealer: state.dealer,
    bids,
    won: { ...state.tricksWon },
    points,
    made: Object.fromEntries(state.order.map((id) => [id, bids[id] === state.tricksWon[id]])),
    totals,
  };
  const last = state.round >= state.handSizes.length;
  return {
    ...state,
    totals,
    history: [...state.history, result],
    phase: last ? "over" : "summary",
    turn: null,
    leader: null,
    deadline: null,
  };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function viewFor(state: State, playerId: PlayerId | null): View {
  const seated = playerId !== null && state.order.includes(playerId);
  const bidTotal = state.order.reduce((s, id) => s + (state.bids[id] ?? 0), 0);
  const ended = state.phase === "summary" || state.phase === "over";
  const hasNext = state.round < state.handSizes.length;
  return {
    phase: state.phase,
    round: state.round,
    totalRounds: state.handSizes.length,
    handSizes: state.handSizes,
    handSize: state.handSize,
    trump: state.trump,
    dealer: state.dealer,
    order: state.order,
    bidOrder: state.bidOrder,
    turn: state.turn,
    myHand: seated ? state.hands[playerId] ?? [] : [],
    handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id]?.length ?? 0])),
    bids: state.bids,
    bidTotal,
    forbiddenBid: forbiddenBid(state),
    tricksWon: state.tricksWon,
    leader: state.leader,
    trick: state.trick,
    ledSuit: ledSuit(state),
    lastTrick: state.lastTrick,
    tricksPlayed: state.tricksPlayed,
    totals: state.totals,
    history: state.history,
    lastRound: ended ? state.history[state.history.length - 1] ?? null : null,
    next: hasNext
      ? {
          round: state.round + 1,
          handSize: state.handSizes[state.round],
          trump: trumpForRound(state.round + 1, state.settings.noTrump),
          dealer: nextPlayer(state.order, state.dealer),
        }
      : null,
    settings: state.settings,
  };
}

// ---------------------------------------------------------------------------
// Bot policy (also used when a turn timer or the host's "hurry" runs out)
// ---------------------------------------------------------------------------

/** Rough number of tricks a hand should take. */
function estimateTricks(hand: readonly Card[], trump: Suit | null, players: number): number {
  const crowd = players >= 6 ? 0.85 : 1;
  let est = 0;
  for (const c of hand) {
    const r = rankValue(c);
    const s = suitOf(c);
    const suitLen = hand.filter((x) => suitOf(x) === s).length;
    if (trump !== null && s === trump) {
      est += r >= 12 ? 1 : r >= 10 ? 0.6 : 0.35;
    } else if (r === 14) {
      est += 0.9 * crowd;
    } else if (r === 13) {
      est += (suitLen >= 2 ? 0.55 : 0.3) * crowd;
    } else if (r === 12 && trump === null) {
      est += 0.25 * crowd;
    }
  }
  return est;
}

function strength(card: Card, trump: Suit | null): number {
  return rankValue(card) + (trump !== null && suitOf(card) === trump ? 100 : 0);
}

function chooseMove(view: View, legal: readonly MoveAction[], rng: Rng): MoveAction {
  const bids = legal.filter((a): a is Extract<MoveAction, { type: "bid" }> => a.type === "bid");
  if (bids.length) {
    const est = estimateTricks(view.myHand, view.trump, view.order.length);
    let best = bids[0];
    for (const b of bids) {
      const d = Math.abs(b.bid - est) - Math.abs(best.bid - est);
      if (d < -1e-9 || (Math.abs(d) <= 1e-9 && rng.chance(0.5))) best = b;
    }
    return best;
  }

  const plays = legal.filter((a): a is Extract<MoveAction, { type: "play" }> => a.type === "play");
  if (!plays.length) return legal[0];
  const cards = plays.map((p) => p.card);
  const trump = view.trump;
  const byStrength = cards.slice().sort((a, b) => strength(a, trump) - strength(b, trump));
  const lowest = byStrength[0];
  const highest = byStrength[byStrength.length - 1];
  const me = view.turn;
  const want = me !== null && (view.bids[me] ?? 0) > (view.tricksWon[me] ?? 0);
  const play = (card: Card): MoveAction => ({ type: "play", card });

  if (view.trick.length === 0) {
    if (!want) return play(lowest);
    const aces = byStrength.filter((c) => rankValue(c) === 14 && suitOf(c) !== trump);
    return play(aces.length ? aces[aces.length - 1] : highest);
  }

  const onTable = view.trick.map((p) => p.card);
  const winsNow = (c: Card) => trickWinner([...onTable, c], trump) === onTable.length;
  const winners = byStrength.filter(winsNow);
  const losers = byStrength.filter((c) => !winsNow(c));
  const lastToPlay = view.trick.length === view.order.length - 1;

  if (want) {
    if (!winners.length) return play(lowest);
    if (lastToPlay) return play(winners[0]);
    const plain = winners.filter((c) => trump === null || suitOf(c) !== trump);
    return play(plain.length ? plain[plain.length - 1] : winners[0]);
  }
  if (losers.length) return play(losers[losers.length - 1]);
  return play(lastToPlay ? highest : lowest);
}
