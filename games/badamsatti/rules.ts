/**
 * Badam Satti / Sevens.
 * The whole deck is dealt. The 7♥ holder starts. A 7 opens its suit; open suits grow one rank at a time
 * down towards the Ace (or 2) and up towards the King (or Ace). You must play if able, else pass.
 * First to empty their hand wins the round (or play on to rank everyone). Multi-round games add up
 * penalty points; lowest total wins.
 */
import {
  check,
  defineGame,
  dealAll,
  legalOfType,
  makeCard,
  nextPlayer,
  rankOf,
  rankScores,
  removeCard,
  shuffledDeck,
  sortCards,
  suitOf,
  SUITS,
  type Card,
  type PlayerId,
  type Rank,
  type Rng,
  type Suit,
} from "../../engine";
import {
  BOARD_SUIT_ORDER,
  LOG_LIMIT,
  START_CARD,
  rankLine,
  type Action,
  type LogEntry,
  type RoundResult,
  type Settings,
  type State,
  type SuitRange,
  type SuitRow,
  type View,
} from "./types";

export type { Action, State, View, Settings };

const badamsatti = defineGame<State, Action, View, Settings>({
  meta: {
    id: "badamsatti",
    name: "Badam Satti",
    tagline: "Sevens: build the suits out from the 7s. Empty your hand first.",
    emoji: "7️⃣",
    category: "cards",
    minPlayers: 3,
    maxPlayers: 8,
    howToPlay: [
      "The whole deck is dealt. Whoever holds the 7♥ starts by playing it.",
      "Play a 7 to open its suit, or the next card down or up on an open suit (6 or 8, then 5 or 9…).",
      "Ace is low by default: suits run A … 7 … K.",
      "You must play a card if you can. If you can't, you pass.",
      "First to empty their hand wins. Everyone else is ranked by the cards they still hold.",
    ],
  },

  settings: [
    {
      type: "boolean",
      key: "firstCard7H",
      label: "First card must be the 7♥",
      help: "Off: the 7♥ holder still starts, but may open with any 7.",
      default: true,
      group: "Play",
    },
    {
      type: "boolean",
      key: "aceHigh",
      label: "Ace above King",
      help: "Off: Ace sits below the 2 (A … 7 … K). On: Ace goes above the King (2 … 7 … A).",
      default: false,
      group: "Play",
    },
    {
      type: "boolean",
      key: "allowPassWhenAble",
      label: "Allow passing with a playable card",
      help: "Off: you must play if you can. The first card of a round is always forced.",
      default: false,
      group: "Play",
    },
    {
      type: "boolean",
      key: "playToEnd",
      label: "Play on to rank everyone",
      help: "Keep playing after the first player goes out, until one player is left holding cards.",
      default: false,
      group: "Scoring",
    },
    {
      type: "number",
      key: "rounds",
      label: "Rounds",
      help: "Each round adds penalty points (cards left, or place − 1 when playing on). Lowest total wins.",
      default: 1,
      min: 1,
      max: 10,
      step: 1,
      group: "Scoring",
    },
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const zero = Object.fromEntries(order.map((id) => [id, 0]));
    return dealRound(
      {
        order,
        hands: {},
        board: emptyBoard(),
        phase: "play",
        round: 0,
        turn: null,
        starter: order[0],
        playedCount: 0,
        finishOrder: [],
        passedLastTurn: {},
        log: [],
        logN: 0,
        totals: zero,
        history: [],
        settings,
      },
      rng,
    );
  },

  legalActions(state, actor) {
    if (state.phase === "roundOver") return actor.isHost ? [{ type: "nextRound" }] : [];
    if (state.phase !== "play" || actor.id !== state.turn) return [];
    const plays = playableCards(state, state.hands[actor.id] ?? []);
    const out: Action[] = plays.map((card) => ({ type: "play", card }));
    if (canPass(state, plays)) out.push({ type: "pass" });
    return out;
  },

  reduce(state, action, { actor, rng }) {
    switch (action.type) {
      case "play": {
        check(state.phase === "play", "The round is over");
        check(actor.id === state.turn, "It's not your turn");
        const hand = state.hands[actor.id] ?? [];
        check(hand.includes(action.card), "You don't have that card");
        if (state.playedCount === 0 && state.settings.firstCard7H) {
          check(action.card === START_CARD, "The first card must be the 7♥");
        }
        check(isPlayable(state, action.card), "That card doesn't fit on the table yet");
        const newHand = removeCard(hand, action.card);
        const hands = { ...state.hands, [actor.id]: newHand };
        const board = { ...state.board, [suitOf(action.card)]: extend(state.board[suitOf(action.card)], rankOf(action.card), state.settings.aceHigh) };
        const finishOrder = newHand.length === 0 ? [...state.finishOrder, actor.id] : state.finishOrder;
        const next: State = {
          ...state,
          hands,
          board,
          finishOrder,
          playedCount: state.playedCount + 1,
          passedLastTurn: { ...state.passedLastTurn, [actor.id]: false },
          ...pushLog(state, {
            playerId: actor.id,
            kind: "play",
            card: action.card,
            wentOut: newHand.length === 0 ? finishOrder.length : null,
          }),
        };
        const stillIn = next.order.filter((id) => next.hands[id].length > 0);
        const roundDone = next.settings.playToEnd ? stillIn.length <= 1 : finishOrder.length > 0;
        if (roundDone) return endRound(next);
        return { ...next, turn: nextTurn(next, actor.id) };
      }
      case "pass": {
        check(state.phase === "play", "The round is over");
        check(actor.id === state.turn, "It's not your turn");
        const plays = playableCards(state, state.hands[actor.id] ?? []);
        check(canPass(state, plays), state.playedCount === 0 ? "You must start with a 7" : "You have a card you can play");
        const next: State = {
          ...state,
          passedLastTurn: { ...state.passedLastTurn, [actor.id]: true },
          ...pushLog(state, { playerId: actor.id, kind: "pass", card: null, wentOut: null }),
        };
        return { ...next, turn: nextTurn(next, actor.id) };
      }
      case "nextRound": {
        check(state.phase === "roundOver", "The round isn't over yet");
        check(actor.isHost, "Only the host can start the next round");
        return dealRound(state, rng);
      }
    }
  },

  viewFor(state, playerId) {
    const s = state.settings;
    const seated = playerId !== null && state.order.includes(playerId);
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: s.rounds,
      rules: {
        openWithSevenOfHearts: s.firstCard7H,
        aceHigh: s.aceHigh,
        allowPassWhenAble: s.allowPassWhenAble,
        playToEnd: s.playToEnd,
        rounds: s.rounds,
      },
      order: state.order,
      turn: state.turn,
      starter: state.starter,
      openingMove: state.playedCount === 0,
      myHand: seated ? state.hands[playerId] ?? [] : [],
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])),
      board: BOARD_SUIT_ORDER.map((suit) => suitRow(suit, state.board[suit], s.aceHigh)),
      log: state.log,
      passedLastTurn: state.passedLastTurn,
      finishOrder: state.finishOrder,
      history: state.history,
      totals: state.totals,
    };
  },

  activePlayers: (state) => (state.phase === "play" && state.turn ? [state.turn] : []),
  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.totals, false),

  botAction(view, legal, rng) {
    const plays = legalOfType(legal, "play");
    if (plays.length === 0) return legal[0];
    // Always play when able. Prefer cards that unlock our own next card, avoid opening suits
    // we hold little of, and keep some randomness so games differ.
    const line = rankLine(view.rules.aceHigh);
    const mine = new Set(view.myHand);
    const score = (card: Card): number => {
      const suit = suitOf(card);
      const i = line.indexOf(rankOf(card));
      const row = view.board.find((r) => r.suit === suit)!;
      let v = rng.next() * 0.5;
      if (!row.open) {
        const ownInSuit = view.myHand.filter((c) => suitOf(c) === suit).length;
        v += ownInSuit * 0.3 - 2;
        return v;
      }
      const dir = row.low !== null && i < line.indexOf(row.low) ? -1 : 1;
      const after = line[i + dir];
      if (after && mine.has(makeCard(after, suit))) v += 2;
      return v + 1;
    };
    const scored = plays.map((a) => ({ a, v: score(a.card) }));
    return scored.reduce((best, x) => (x.v > best.v ? x : best)).a;
  },
});

export default badamsatti;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyBoard(): Record<Suit, SuitRange> {
  return Object.fromEntries(SUITS.map((s) => [s, null])) as Record<Suit, SuitRange>;
}

/** Deal a fresh round (round number + 1) from `state`, keeping totals and history. */
function dealRound(state: State, rng: Rng): State {
  const round = state.round + 1;
  const n = state.order.length;
  // The first card dealt rotates one seat each round.
  const dealt = dealAll(shuffledDeck(rng), n, (round - 1) % n);
  const hands = Object.fromEntries(
    state.order.map((id, i) => [id, sortCards(dealt[i], "suit", { aceLow: !state.settings.aceHigh })]),
  );
  const starter = state.order.find((id) => hands[id].includes(START_CARD))!;
  return {
    ...state,
    hands,
    board: emptyBoard(),
    phase: "play",
    round,
    turn: starter,
    starter,
    playedCount: 0,
    finishOrder: [],
    passedLastTurn: Object.fromEntries(state.order.map((id) => [id, false])),
    log: [],
    logN: 0,
  };
}

function rankIndex(rank: Rank, aceHigh: boolean): number {
  return rankLine(aceHigh).indexOf(rank);
}

/** Can `card` go on the table now (ignoring the opening-card rule)? */
function fitsBoard(board: Record<Suit, SuitRange>, card: Card, aceHigh: boolean): boolean {
  const range = board[suitOf(card)];
  const r = rankOf(card);
  if (!range) return r === "7";
  const i = rankIndex(r, aceHigh);
  return i === rankIndex(range.low, aceHigh) - 1 || i === rankIndex(range.high, aceHigh) + 1;
}

function isPlayable(state: State, card: Card): boolean {
  if (state.playedCount === 0 && state.settings.firstCard7H) return card === START_CARD;
  return fitsBoard(state.board, card, state.settings.aceHigh);
}

function playableCards(state: State, hand: readonly Card[]): Card[] {
  return hand.filter((c) => isPlayable(state, c));
}

/** Pass is allowed with no playable card, or (house rule) any time after the opening card. */
function canPass(state: State, plays: readonly Card[]): boolean {
  if (plays.length === 0) return true;
  return state.settings.allowPassWhenAble && state.playedCount > 0;
}

/** Add `rank` to its suit's range (fitsBoard already checked it touches one end). */
function extend(range: SuitRange, rank: Rank, aceHigh: boolean): SuitRange {
  if (!range) return { low: rank, high: rank };
  return rankIndex(rank, aceHigh) < rankIndex("7", aceHigh) ? { ...range, low: rank } : { ...range, high: rank };
}

function suitRow(suit: Suit, range: SuitRange, aceHigh: boolean): SuitRow {
  const line = rankLine(aceHigh);
  if (!range) {
    return { suit, open: false, low: null, high: null, played: [], nextDown: null, nextUp: null, complete: false };
  }
  const lo = line.indexOf(range.low);
  const hi = line.indexOf(range.high);
  const nextDown = lo > 0 ? line[lo - 1] : null;
  const nextUp = hi < line.length - 1 ? line[hi + 1] : null;
  return {
    suit,
    open: true,
    low: range.low,
    high: range.high,
    played: line.slice(lo, hi + 1),
    nextDown,
    nextUp,
    complete: nextDown === null && nextUp === null,
  };
}

function nextTurn(state: State, from: PlayerId): PlayerId {
  return nextPlayer(state.order, from, (p) => state.hands[p].length === 0);
}

function pushLog(state: State, entry: Omit<LogEntry, "n">): { log: LogEntry[]; logN: number } {
  const log = [...state.log, { n: state.logN, ...entry }];
  return { log: log.slice(-LOG_LIMIT), logN: state.logN + 1 };
}

/** Close the round: places, penalties, totals; then roundOver or over. */
function endRound(state: State): State {
  const { order, hands, settings } = state;
  const cardsLeft: Record<PlayerId, number> = Object.fromEntries(order.map((id) => [id, hands[id].length]));
  const places: Record<PlayerId, number> = {};
  const penalty: Record<PlayerId, number> = {};
  if (settings.playToEnd) {
    state.finishOrder.forEach((id, i) => (places[id] = i + 1));
    const last = state.finishOrder.length + 1;
    for (const id of order) if (!(id in places)) places[id] = last;
    for (const id of order) penalty[id] = places[id] - 1;
  } else {
    for (const id of order) {
      places[id] = 1 + order.filter((o) => cardsLeft[o] < cardsLeft[id]).length;
      penalty[id] = cardsLeft[id];
    }
  }
  const result: RoundResult = { round: state.round, finishOrder: state.finishOrder, places, cardsLeft, penalty };
  const totals = Object.fromEntries(order.map((id) => [id, state.totals[id] + penalty[id]]));
  return {
    ...state,
    totals,
    history: [...state.history, result],
    phase: state.round >= settings.rounds ? "over" : "roundOver",
    turn: null,
  };
}
