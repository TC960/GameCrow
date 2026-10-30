/**
 * Bluff (Cheat / "I Doubt It"), as played in India. See BRIEF.md for the full spec.
 * Play 1..N cards face down and claim a rank; others may call "Bluff!". A caught bluffer takes the
 * pile, a wrong caller takes it instead. First to empty their hand wins (or play on for a full ranking).
 */
import {
  check,
  defineGame,
  dealAll,
  fail,
  FREE_TEXT,
  isLegal,
  legalOfType,
  nextPlayer,
  rankOf,
  rankScores,
  removeCards,
  shuffledDeck,
  type Card,
  type PlayerId,
  type Rank,
} from "../../engine";
import { CLAIM_RANKS, LOG_LIMIT, SEQUENCE, type Action, type LogEntry, type State, type View, type Settings } from "./types";

export type { Action, State, View, Settings };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isFinished = (s: State, id: PlayerId) => s.finished.includes(id);
const unfinished = (s: State) => s.order.filter((id) => !isFinished(s, id));
const nextUnfinished = (s: State, id: PlayerId) => nextPlayer(s.order, id, (p) => isFinished(s, p));
const copiesPerRank = (s: State) => 4 * s.decks;

function pushLog(s: State, entry: LogEntry): LogEntry[] {
  const log = [...s.log, entry];
  return log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log;
}

/** Max cards `id` may play now. */
function maxPlay(s: State, id: PlayerId): number {
  return Math.min(s.settings.maxCards, copiesPerRank(s), s.hands[id]?.length ?? 0);
}

/** Rank the current turn player must claim; null = any rank. */
function requiredRank(s: State): Rank | null {
  if (s.settings.claimMode === "sequence") return SEQUENCE[s.seqIndex % SEQUENCE.length];
  if (s.settings.claimMode === "follow") return s.roundRank;
  return null;
}

function canPass(s: State): boolean {
  return s.phase === "turn" && s.settings.allowPass && s.roundPlays > 0;
}

/** Players who may call on a play by `claimant` (seat order starting after the claimant). */
function eligibleCallers(s: State, claimant: PlayerId): PlayerId[] {
  const others = unfinished(s).filter((id) => id !== claimant);
  if (others.length === 0) return [];
  if (s.settings.whoCanCall === "next") return [nextUnfinished(s, claimant)];
  const i = s.order.indexOf(claimant);
  const rotated = [...s.order.slice(i + 1), ...s.order.slice(0, i)];
  return rotated.filter((id) => others.includes(id));
}

function undecided(s: State): PlayerId[] {
  return s.eligible.filter((id) => !s.declined.includes(id));
}

function startRound(s: State, leader: PlayerId): State {
  return {
    ...s,
    phase: "turn",
    turn: leader,
    round: s.round + 1,
    roundLeader: leader,
    roundRank: null,
    roundPlays: 0,
    lastClaimant: null,
    passCount: 0,
  };
}

/** Mark `id` as finished; ends the game when the end rule says so. */
function finish(s: State, id: PlayerId): State {
  const finished = [...s.finished, id];
  let next: State = { ...s, finished, log: pushLog(s, { kind: "finish", playerId: id, place: finished.length }) };
  const left = next.order.filter((p) => !finished.includes(p)).length;
  if (s.settings.endMode !== "full" || left <= 1) next = { ...next, phase: "over", turn: null };
  return next;
}

function clearWindow(s: State): State {
  return { ...s, pending: null, eligible: [], declined: [], deadline: null };
}

/** Call window closed without a call. */
function closeWindow(state: State): State {
  const claimant = state.pending!.claimant;
  let s = clearWindow(state);
  if (s.hands[claimant].length === 0) s = finish(s, claimant);
  if (s.phase === "over") return s;
  return { ...s, phase: "turn", turn: nextUnfinished(s, claimant) };
}

function resolveCall(state: State, caller: PlayerId): State {
  const { claimant, cards, rank } = state.pending!;
  const truthful = cards.every((c) => rankOf(c) === rank);
  const taker = truthful ? caller : claimant;
  const pileSize = state.pile.length;
  const callResult = { id: state.callCount + 1, caller, claimant, rank, cards, truthful, taker, pileSize };
  let s: State = clearWindow({
    ...state,
    hands: { ...state.hands, [taker]: [...state.hands[taker], ...state.pile] },
    pile: [],
    lastCall: callResult,
    callCount: state.callCount + 1,
    log: pushLog(state, { kind: "call", caller, claimant, rank, cards, truthful, taker, pileSize }),
  });
  if (truthful && s.hands[claimant].length === 0) s = finish(s, claimant);
  if (s.phase === "over") return s;
  const winner = truthful ? claimant : caller;
  let leader =
    s.settings.afterCall === "loser" ? taker : s.settings.afterCall === "next" ? nextUnfinished(s, claimant) : winner;
  if (isFinished(s, leader)) leader = nextUnfinished(s, leader);
  return startRound(s, leader);
}

function play(state: State, actor: PlayerId, cards: Card[], rank: Rank, now: number): State {
  check(state.phase === "turn" && state.turn === actor, "It's not your turn");
  const hand = state.hands[actor];
  check(Array.isArray(cards) && cards.length >= 1, "Pick at least one card");
  check(cards.length <= maxPlay(state, actor), "Too many cards");
  check(cards.every((c) => typeof c === "string"), "Invalid card");
  check(new Set(cards).size === cards.length, "Pick each card once");
  check(cards.every((c) => hand.includes(c)), "You don't have that card");
  check(CLAIM_RANKS.includes(rank), "Pick a rank");
  const req = requiredRank(state);
  check(req === null || rank === req, "You must claim the round's rank");

  const isSeq = state.settings.claimMode === "sequence";
  let s: State = {
    ...state,
    hands: { ...state.hands, [actor]: removeCards(hand, cards) },
    pile: [...state.pile, ...cards],
    roundRank: state.settings.claimMode === "follow" ? (state.roundRank ?? rank) : null,
    roundPlays: state.roundPlays + 1,
    lastClaimant: actor,
    passCount: 0,
    seqIndex: isSeq ? state.seqIndex + 1 : state.seqIndex,
    log: pushLog(state, { kind: "play", playerId: actor, count: cards.length, rank }),
    pending: { claimant: actor, cards: [...cards], rank },
    phase: "respond",
    turn: null,
    declined: [],
  };
  const eligible = eligibleCallers(s, actor);
  const secs = s.settings.callSeconds;
  s = { ...s, eligible, deadline: secs > 0 ? now + secs * 1000 : null };
  if (eligible.length === 0) return closeWindow(s);
  return s;
}

function pass(state: State, actor: PlayerId): State {
  check(state.phase === "turn" && state.turn === actor, "It's not your turn");
  check(canPass(state), "You can't pass now");
  const passCount = state.passCount + 1;
  const last = state.lastClaimant!;
  const needed = unfinished(state).filter((id) => id !== last).length;
  let s: State = { ...state, passCount, log: pushLog(state, { kind: "pass", playerId: actor }) };
  if (passCount < needed) return { ...s, turn: nextUnfinished(s, actor) };
  // Everyone passed in a row: the round ends.
  const discard = s.settings.allPass !== "keep";
  s = {
    ...s,
    pile: discard ? [] : s.pile,
    discarded: discard ? [...s.discarded, ...s.pile] : s.discarded,
    log: pushLog(s, { kind: "clear", count: s.pile.length, discarded: discard }),
  };
  const leader = isFinished(s, last) ? nextUnfinished(s, last) : last;
  return startRound(s, leader);
}

const anyLegal = (n: number) => Array.from({ length: n }, () => FREE_TEXT);

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const bluff = defineGame<State, Action, View, Settings>({
  meta: {
    id: "bluff",
    name: "Bluff",
    tagline: "Play face down, claim a rank, lie with a straight face.",
    emoji: "🤥",
    category: "cards",
    minPlayers: 3,
    maxPlayers: 8,
    howToPlay: [
      "On your turn put 1–4 cards face down and claim a rank, e.g. \"three 7s\". You may lie.",
      "Once a round's rank is set, everyone must claim it (or pass).",
      "Think it's a lie? Tap Bluff! The cards are flipped: a liar takes the whole pile, otherwise you do.",
      "If everyone passes in a row, the pile is thrown away and the last player starts a new round.",
      "First to get rid of every card (without being caught) wins.",
    ],
  },
  settings: [
    {
      type: "select",
      key: "claimMode",
      label: "Claim rule",
      default: "follow",
      group: "Claims",
      options: [
        { value: "follow", label: "Follow the round's rank" },
        { value: "free", label: "Claim any rank every time" },
        { value: "sequence", label: "Sequence A, 2, 3 … K" },
      ],
      help: "Follow: the round leader names the rank and everyone keeps it until the round ends.",
    },
    { type: "number", key: "maxCards", label: "Max cards per play", default: 4, min: 1, max: 8, group: "Claims", help: "Never more than 4 per deck." },
    { type: "boolean", key: "allowPass", label: "Players may pass", default: true, group: "Claims", help: "The round leader can never pass." },
    {
      type: "select",
      key: "allPass",
      label: "When everyone passes",
      default: "discard",
      group: "Claims",
      visibleIf: { key: "allowPass", in: [true] },
      options: [
        { value: "discard", label: "Pile is thrown away" },
        { value: "keep", label: "Pile stays for the next round" },
      ],
    },
    {
      type: "select",
      key: "whoCanCall",
      label: "Who may call Bluff",
      default: "anyone",
      group: "Calling",
      options: [
        { value: "anyone", label: "Anyone (first caller wins)" },
        { value: "next", label: "Only the next player" },
      ],
    },
    { type: "number", key: "callSeconds", label: "Seconds to call Bluff", default: 8, min: 0, max: 30, group: "Calling", help: "0 = wait until everyone decides (host can skip)." },
    {
      type: "select",
      key: "afterCall",
      label: "After a call, who starts",
      default: "winner",
      group: "Calling",
      options: [
        { value: "winner", label: "Winner of the challenge" },
        { value: "loser", label: "Whoever picked up the pile" },
        { value: "next", label: "Next player after the claimer" },
      ],
    },
    {
      type: "select",
      key: "endMode",
      label: "End",
      default: "first",
      group: "Game",
      options: [
        { value: "first", label: "First to empty their hand wins" },
        { value: "full", label: "Play on for a full ranking" },
      ],
    },
    {
      type: "select",
      key: "decks",
      label: "Decks",
      default: "auto",
      group: "Game",
      options: [
        { value: "auto", label: "Auto (2 decks for 7+ players)" },
        { value: "1", label: "1 deck" },
        { value: "2", label: "2 decks" },
      ],
    },
  ],

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const decks = settings.decks === "2" || (settings.decks === "auto" && order.length >= 7) ? 2 : 1;
    const hands = dealAll(shuffledDeck(rng, { decks }), order.length, 0);
    return {
      order,
      hands: Object.fromEntries(order.map((id, i) => [id, hands[i]])),
      pile: [],
      discarded: [],
      decks,
      phase: "turn",
      turn: order[0],
      roundLeader: order[0],
      roundRank: null,
      roundPlays: 0,
      lastClaimant: null,
      passCount: 0,
      seqIndex: 0,
      pending: null,
      eligible: [],
      declined: [],
      deadline: null,
      finished: [],
      lastCall: null,
      callCount: 0,
      round: 1,
      log: [],
      settings,
    };
  },

  legalActions(state, actor) {
    if (!state.order.includes(actor.id)) return [];
    if (state.phase === "turn") {
      if (state.turn !== actor.id) return [];
      const req = requiredRank(state);
      const ranks = req ? [req] : CLAIM_RANKS;
      const out: Action[] = [];
      for (let k = 1; k <= maxPlay(state, actor.id); k++) {
        for (const rank of ranks) out.push({ type: "play", cards: anyLegal(k), rank });
      }
      if (canPass(state)) out.push({ type: "pass" });
      return out;
    }
    if (state.phase === "respond") {
      const open = undecided(state);
      const out: Action[] = [];
      if (open.includes(actor.id)) out.push({ type: "call" }, { type: "accept" });
      if (actor.isHost && state.deadline === null && open.some((id) => id !== actor.id)) out.push({ type: "skip" });
      return out;
    }
    return [];
  },

  reduce(state, action, { actor, now }) {
    switch (action.type) {
      case "play":
        return play(state, actor.id, action.cards, action.rank, now);
      case "pass":
        return pass(state, actor.id);
      case "call":
        check(state.phase === "respond" && undecided(state).includes(actor.id), "Too late to call");
        return resolveCall(state, actor.id);
      case "accept": {
        check(state.phase === "respond" && undecided(state).includes(actor.id), "Nothing to accept");
        const s = { ...state, declined: [...state.declined, actor.id] };
        return undecided(s).length === 0 ? closeWindow(s) : s;
      }
      case "skip":
        check(state.phase === "respond" && actor.isHost, "Only the host can skip");
        return closeWindow(state);
      case "@timeout":
        if (state.phase !== "respond" || state.deadline === null || now < state.deadline) return state;
        return closeWindow(state);
      default:
        fail("Unknown action");
    }
  },

  viewFor(state, playerId) {
    const seated = playerId !== null && state.order.includes(playerId);
    const turnPlayer = state.phase === "turn" ? state.turn : null;
    return {
      phase: state.phase,
      order: state.order,
      turn: turnPlayer,
      myHand: seated ? state.hands[playerId] : [],
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])),
      pileCount: state.pile.length,
      discardCount: state.discarded.length,
      decks: state.decks,
      round: state.round,
      roundLeader: state.roundLeader,
      roundRank: state.roundRank,
      roundPlays: state.roundPlays,
      requiredRank: turnPlayer ? requiredRank(state) : null,
      maxPlay: turnPlayer ? maxPlay(state, turnPlayer) : 0,
      canPass: canPass(state),
      claim: state.pending
        ? { claimant: state.pending.claimant, count: state.pending.cards.length, rank: state.pending.rank }
        : null,
      eligible: state.eligible,
      declined: state.declined,
      deadline: state.deadline,
      finished: state.finished,
      lastCall: state.lastCall,
      log: state.log,
      settings: state.settings,
    };
  },

  activePlayers(state) {
    if (state.phase === "turn") return state.turn ? [state.turn] : [];
    if (state.phase === "respond") return undecided(state);
    return [];
  },

  isOver: (state) => state.phase === "over",

  scores(state) {
    const n = state.order.length;
    const totals: Record<PlayerId, number> = {};
    for (const id of state.order) {
      const place = state.finished.indexOf(id);
      totals[id] = place >= 0 ? n - (place + 1) : 0 - state.hands[id].length;
    }
    return rankScores(totals, true);
  },

  deadline: (state) => (state.phase === "respond" ? state.deadline : null),

  botAction(view, legal, rng) {
    const has = (type: Action["type"]) => legal.some((a) => a.type === type);
    const hand = view.myHand;
    const countOf = (r: Rank) => hand.filter((c) => rankOf(c) === r).length;

    if (has("call") && view.claim) {
      const { claimant, count, rank } = view.claim;
      const held = countOf(rank);
      const copies = 4 * view.decks;
      // Chance that *someone* at the table calls, split across the eligible callers so the
      // table-wide rate does not grow with the player count.
      const goingOut = view.handCounts[claimant] === 0;
      let table = 0.1 + 0.08 * (count - 1) + 0.4 * (held / copies) + (goingOut ? 0.4 : 0);
      table -= Math.min(0.08, view.pileCount / 150);
      table = Math.max(0.04, Math.min(0.8, table));
      // A provable lie (I hold too many of that rank) is usually called, but not always, so
      // hands locked into full sets still move.
      if (held + count > copies) table = 0.7;
      const callers = Math.max(1, view.eligible.length);
      const p = 1 - Math.pow(1 - table, 1 / callers);
      return rng.chance(p) || !has("accept") ? { type: "call" } : { type: "accept" };
    }

    const plays = legalOfType(legal, "play");
    if (plays.length === 0) return rng.pick(legal);
    const maxK = Math.max(...plays.map((a) => a.cards.length));
    const ranks = [...new Set(plays.map((a) => a.rank))];
    const others = (r: Rank) => rng.shuffle(hand.filter((c) => rankOf(c) !== r));

    let rank: Rank;
    let cards: Card[];
    if (ranks.length > 1) {
      // Free choice: claim what I hold most of, truthfully (sometimes slip in one extra).
      const best = Math.max(...ranks.map(countOf));
      const candidates = ranks.filter((r) => countOf(r) === best);
      rank = rng.pick(candidates);
      cards = hand.filter((c) => rankOf(c) === rank).slice(0, maxK);
      const extra = others(rank);
      if (cards.length === 0) cards = extra.slice(0, 1);
      else if (cards.length < maxK && extra.length && rng.chance(0.2)) cards = [...cards, extra[0]];
    } else {
      rank = ranks[0];
      const real = hand.filter((c) => rankOf(c) === rank).slice(0, maxK);
      if (real.length > 0) {
        cards = real;
        const extra = others(rank);
        if (real.length < maxK && extra.length && rng.chance(0.15)) cards = [...real, extra[0]];
      } else {
        if (has("pass") && rng.chance(0.45)) return { type: "pass" };
        // Bluff with cards of ranks I hold few of; in sequence mode keep the ranks I'll need on
        // my next turns (if the turn order holds).
        const soon = new Set<Rank>();
        const at = SEQUENCE.indexOf(rank);
        if (view.settings.claimMode === "sequence" && at >= 0) {
          const m = Math.max(1, view.order.length - view.finished.length);
          for (let j = 1; j <= 3; j++) soon.add(SEQUENCE[(at + j * m) % SEQUENCE.length]);
        }
        const cost = (c: Card) => countOf(rankOf(c)) + (soon.has(rankOf(c)) ? 10 : 0);
        const sorted = others(rank).sort((a, b) => cost(a) - cost(b));
        cards = sorted.slice(0, Math.min(maxK, rng.chance(0.3) ? 2 : 1));
      }
    }
    const action: Action = { type: "play", cards, rank };
    if (cards.length > 0 && isLegal(legal, action)) return action;
    const fallback = rng.pick(plays);
    return { type: "play", cards: hand.slice(0, fallback.cards.length), rank: fallback.rank };
  },
});

export default bluff;
