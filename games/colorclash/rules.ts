/**
 * Color Clash: an original colour-matching shedding game for 2–10 players. Spec: games/colorclash/BRIEF.md.
 * Server-only (never imported by ui.tsx).
 */
import {
  check,
  clone,
  defineGame,
  fail,
  rankScores,
  type PlayerId,
  type Rng,
  type SettingField,
} from "../../engine";
import {
  cardPoints,
  colorOf,
  faceOf,
  handPoints,
  isNumber,
  isWild,
  makeDeck,
  parseCard,
  valueOf,
} from "./cards";
import { COLORS, DECK_SIZE, type Action, type CardId, type ColorId, type LogEntry, type Settings, type State, type View } from "./types";

export type { Action, State, View, Settings };

const LOG_LIMIT = 20;
const DISCARD_SHOWN = 4;

const SETTINGS: SettingField[] = [
  {
    type: "select",
    key: "scoring",
    label: "Scoring",
    group: "Scoring",
    default: "points",
    options: [
      { value: "points", label: "Points: play rounds to a target" },
      { value: "single", label: "Single round: first out wins" },
    ],
  },
  {
    type: "number",
    key: "targetScore",
    label: "Points to win",
    group: "Scoring",
    default: 500,
    min: 100,
    max: 1000,
    step: 50,
    visibleIf: { key: "scoring", in: ["points"] },
  },
  { type: "number", key: "handSize", label: "Cards per player", group: "Deal", default: 7, min: 5, max: 10 },
  {
    type: "select",
    key: "decks",
    label: "Decks",
    group: "Deal",
    help: "Auto uses 2 decks for 7 or more players.",
    default: "auto",
    options: [
      { value: "auto", label: "Auto" },
      { value: "1", label: "1 deck (108 cards)" },
      { value: "2", label: "2 decks (216 cards)" },
    ],
  },
  {
    type: "select",
    key: "drawRule",
    label: "When you can't play",
    group: "Drawing",
    default: "one",
    options: [
      { value: "one", label: "Draw one, may play it" },
      { value: "untilPlayable", label: "Draw until you can play" },
    ],
  },
  {
    type: "boolean",
    key: "mustPlay",
    label: "Must play if able",
    group: "Drawing",
    help: "No drawing while you hold a playable card.",
    default: false,
  },
  {
    type: "select",
    key: "stacking",
    label: "Stacking +2 / +4",
    group: "Action cards",
    default: "off",
    options: [
      { value: "off", label: "Off" },
      { value: "same", label: "+2 on +2, +4 on +4" },
      { value: "any", label: "Also +4 on +2" },
    ],
  },
  {
    type: "select",
    key: "wild4Rule",
    label: "Rainbow +4",
    group: "Action cards",
    default: "challenge",
    options: [
      { value: "challenge", label: "Can be challenged" },
      { value: "strict", label: "Only with no card of the colour" },
      { value: "free", label: "Play any time" },
    ],
  },
  {
    type: "boolean",
    key: "sevenZero",
    label: "7 swaps, 0 rotates hands",
    group: "Action cards",
    default: false,
  },
  {
    type: "boolean",
    key: "jumpIn",
    label: "Jump-in",
    group: "Action cards",
    help: "Play an identical card out of turn.",
    default: false,
  },
  {
    type: "boolean",
    key: "twoPlayerFlip",
    label: "2 players: Flip acts as Freeze",
    group: "Action cards",
    default: true,
  },
  {
    type: "select",
    key: "clashRule",
    label: "Clash! call",
    group: "Clash!",
    default: "penalty",
    options: [
      { value: "penalty", label: "Call it or get caught" },
      { value: "off", label: "Off" },
    ],
  },
  {
    type: "number",
    key: "clashPenalty",
    label: "Penalty cards when caught",
    group: "Clash!",
    default: 2,
    min: 1,
    max: 4,
    visibleIf: { key: "clashRule", in: ["penalty"] },
  },
  {
    type: "number",
    key: "catchSeconds",
    label: "Catch window (seconds)",
    group: "Clash!",
    default: 5,
    min: 2,
    max: 15,
    visibleIf: { key: "clashRule", in: ["penalty"] },
  },
];

// ---------------------------------------------------------------------------
// Helpers (operate on a mutable draft `d`, a clone of the input state)
// ---------------------------------------------------------------------------

type LogInput = LogEntry extends infer E ? (E extends LogEntry ? Omit<E, "n"> : never) : never;

function deckCountFor(settings: Settings, players: number): number {
  if (settings.decks === "1") return 1;
  if (settings.decks === "2") return 2;
  return players >= 7 ? 2 : 1;
}

function addLog(d: State, entry: LogInput) {
  d.log = [...d.log, { ...entry, n: d.logSeq } as LogEntry].slice(-LOG_LIMIT);
  d.logSeq += 1;
}

function nextOf(s: State, p: PlayerId, steps = 1): PlayerId {
  const n = s.order.length;
  const i = s.order.indexOf(p);
  return s.order[(((i + steps * s.direction) % n) + n) % n];
}

const topOf = (s: State): CardId => s.discard[s.discard.length - 1];
const canDraw = (s: State) => s.drawPile.length > 0 || s.discard.length > 1;
const isPlaying = (s: State) => s.phase === "play" || s.phase === "drawn" || s.phase === "respond";

/** Normal matching rule (phases play / drawn). */
function matches(s: State, hand: readonly CardId[], card: CardId): boolean {
  const p = parseCard(card);
  if (p.value === "rainbow") return true;
  if (p.value === "rainbow4") {
    if (s.settings.wild4Rule !== "strict") return true;
    return !hand.some((c) => colorOf(c) === s.color);
  }
  if (p.color === s.color) return true;
  const top = parseCard(topOf(s));
  return top.color !== "wild" && top.value === p.value;
}

/** Stacking rule (phase respond). */
function stackable(s: State, card: CardId): boolean {
  const mode = s.settings.stacking;
  if (mode === "off") return false;
  const v = valueOf(card);
  const top = valueOf(topOf(s));
  if (top === "plus2") return v === "plus2" || (mode === "any" && v === "rainbow4");
  if (top === "rainbow4") return v === "rainbow4";
  return false;
}

/** All concrete play actions for one card. */
function playOptions(s: State, actor: PlayerId, card: CardId): Action[] {
  if (isWild(card)) return COLORS.map((color) => ({ type: "play", card, color }));
  if (valueOf(card) === "7" && s.settings.sevenZero && s.hands[actor].length > 1) {
    return s.order.filter((p) => p !== actor).map((target) => ({ type: "play", card, target }));
  }
  return [{ type: "play", card }];
}

function turnPlays(s: State, me: PlayerId): Action[] {
  const hand = s.hands[me];
  if (s.phase === "play") return hand.filter((c) => matches(s, hand, c)).flatMap((c) => playOptions(s, me, c));
  if (s.phase === "drawn") {
    const c = s.drawnCard;
    return c && hand.includes(c) && matches(s, hand, c) ? playOptions(s, me, c) : [];
  }
  if (s.phase === "respond") return hand.filter((c) => stackable(s, c)).flatMap((c) => playOptions(s, me, c));
  return [];
}

function jumpInPlays(s: State, me: PlayerId): Action[] {
  if (!s.settings.jumpIn || s.phase !== "play" || me === s.turn) return [];
  const top = topOf(s);
  if (isWild(top)) return [];
  const face = faceOf(top);
  return s.hands[me].filter((c) => faceOf(c) === face).flatMap((c) => playOptions(s, me, c));
}

/** Draw up to k cards for `pid`, reshuffling the discard (minus its top) when the pile runs out. */
function drawCards(d: State, pid: PlayerId, k: number, rng: Rng): CardId[] {
  const got: CardId[] = [];
  for (let i = 0; i < k; i++) {
    if (d.drawPile.length === 0) {
      if (d.discard.length <= 1) break;
      const top = topOf(d);
      d.drawPile = rng.shuffle(d.discard.slice(0, -1));
      d.discard = [top];
      addLog(d, { kind: "reshuffle" });
    }
    got.push(d.drawPile[0]);
    d.drawPile = d.drawPile.slice(1);
  }
  d.hands[pid] = [...d.hands[pid], ...got];
  return got;
}

function drawLogged(d: State, pid: PlayerId, k: number, rng: Rng, reason: "turn" | "plus" | "penalty" | "challenge" | "skip") {
  const got = drawCards(d, pid, k, rng);
  addLog(d, { kind: "draw", player: pid, count: got.length, reason });
  if (got.length > 0) d.idle = 0;
  return got;
}

function endTurn(d: State, from: PlayerId) {
  d.turn = nextOf(d, from);
  d.phase = "play";
  d.called = null;
  d.drawnCard = null;
}

function normalizeExposed(d: State) {
  for (const id of Object.keys(d.exposed)) if (d.hands[id]?.length !== 1) delete d.exposed[id];
}

function endRound(d: State, winner: PlayerId, blocked: boolean) {
  const pts = Object.fromEntries(d.order.map((id) => [id, handPoints(d.hands[id])]));
  const gained = d.order.filter((id) => id !== winner).reduce((sum, id) => sum + pts[id], 0);
  if (d.settings.scoring === "points") d.totals = { ...d.totals, [winner]: d.totals[winner] + gained };
  d.lastRound = { round: d.round, winner, gained, blocked, handPoints: pts };
  addLog(d, { kind: "roundEnd", winner, gained, blocked });
  d.exposed = {};
  d.called = null;
  d.drawnCard = null;
  d.pending = 0;
  d.wild4 = null;
  d.idle = 0;
  const over = d.settings.scoring === "single" || d.totals[winner] >= d.settings.targetScore;
  d.phase = over ? "over" : "roundOver";
}

/** Count a pass made in phase play; ends the round as blocked after a full lap of passes. */
function passTurn(d: State, pid: PlayerId) {
  d.idle += 1;
  endTurn(d, pid);
  if (d.idle >= d.order.length) {
    const start = d.order.indexOf(d.turn);
    const seq = d.order.map((_, k) => d.order[(start + k * d.direction + d.order.length * 2) % d.order.length]);
    const winner = seq.reduce((best, id) => {
      const a = d.hands[id].length - d.hands[best].length;
      if (a !== 0) return a < 0 ? id : best;
      return handPoints(d.hands[id]) < handPoints(d.hands[best]) ? id : best;
    });
    endRound(d, winner, true);
  }
}

/** Fresh deal for `round` (keeps totals, lastRound, log). */
function dealRound(d: State, round: number, rng: Rng) {
  const n = d.order.length;
  const h = d.settings.handSize;
  let deck: CardId[] = [];
  let idx = -1;
  for (let tries = 0; idx < 0 && tries < 50; tries++) {
    deck = rng.shuffle(makeDeck(d.deckCount));
    idx = deck.slice(n * h).findIndex(isNumber);
  }
  const rest = deck.slice(n * h);
  const start = idx >= 0 ? rest[idx] : rest[0];
  d.hands = Object.fromEntries(d.order.map((id, i) => [id, deck.slice(i * h, (i + 1) * h)]));
  d.drawPile = rest.filter((c) => c !== start);
  d.discard = [start];
  const startColor = colorOf(start);
  d.color = startColor === "wild" ? "sun" : startColor;
  d.round = round;
  d.turn = d.order[(round - 1) % n];
  d.direction = 1;
  d.phase = "play";
  d.pending = 0;
  d.drawnCard = null;
  d.called = null;
  d.exposed = {};
  d.wild4 = null;
  d.idle = 0;
}

function applyPlay(
  d: State,
  actor: PlayerId,
  card: CardId,
  color: ColorId | null,
  target: PlayerId | null,
  now: number,
  rng: Rng,
  jumpIn: boolean,
) {
  const hand = d.hands[actor];
  check(hand.includes(card), "You don't have that card");
  const p = parseCard(card);
  const stackingPlay = d.phase === "respond";
  const calledBefore = d.called === actor;
  const guilty = p.value === "rainbow4" && !stackingPlay && hand.some((c) => c !== card && colorOf(c) === d.color);

  d.hands[actor] = hand.filter((c) => c !== card);
  d.discard = [...d.discard, card];
  if (p.color === "wild") {
    check(color !== null, "Pick a colour");
    d.color = color;
  } else {
    d.color = p.color;
  }
  d.called = null;
  d.drawnCard = null;
  d.idle = 0;
  d.phase = "play";
  if (p.value !== "rainbow4") d.wild4 = null;
  addLog(d, { kind: "play", player: actor, value: p.value, cardColor: p.color, color: d.color, jumpIn });

  // Going out ends the round at once; only a last +2 / +4 still makes the next player draw.
  if (d.hands[actor].length === 0) {
    if (p.value === "plus2" || p.value === "rainbow4") {
      drawLogged(d, nextOf(d, actor), d.pending + (p.value === "plus2" ? 2 : 4), rng, "plus");
    }
    endRound(d, actor, false);
    return;
  }

  const s = d.settings;
  switch (p.value) {
    case "freeze": {
      const skipped = nextOf(d, actor);
      addLog(d, { kind: "skip", player: skipped });
      d.turn = nextOf(d, skipped);
      break;
    }
    case "flip": {
      if (d.order.length === 2 && s.twoPlayerFlip) {
        const skipped = nextOf(d, actor);
        addLog(d, { kind: "skip", player: skipped });
        d.turn = nextOf(d, skipped);
      } else {
        d.direction = d.direction === 1 ? -1 : 1;
        addLog(d, { kind: "flip", direction: d.direction });
        d.turn = nextOf(d, actor);
      }
      break;
    }
    case "plus2":
    case "rainbow4": {
      const amount = p.value === "plus2" ? 2 : 4;
      if (p.value === "rainbow4") d.wild4 = { player: actor, guilty };
      const victim = nextOf(d, actor);
      if (s.stacking !== "off" || (p.value === "rainbow4" && s.wild4Rule === "challenge")) {
        d.pending += amount;
        d.turn = victim;
        d.phase = "respond";
      } else {
        drawLogged(d, victim, amount, rng, "plus");
        addLog(d, { kind: "skip", player: victim });
        d.turn = nextOf(d, victim);
        d.wild4 = null;
      }
      break;
    }
    case "7": {
      if (s.sevenZero) {
        check(target !== null && target !== actor && d.hands[target] !== undefined, "Pick a player to swap with");
        const mine = d.hands[actor];
        d.hands[actor] = d.hands[target];
        d.hands[target] = mine;
        addLog(d, { kind: "swap", player: actor, target });
      }
      d.turn = nextOf(d, actor);
      break;
    }
    case "0": {
      if (s.sevenZero) {
        const old = d.hands;
        d.hands = Object.fromEntries(d.order.map((id) => [nextOf(d, id), old[id]]));
        addLog(d, { kind: "rotate", direction: d.direction });
      }
      d.turn = nextOf(d, actor);
      break;
    }
    default:
      d.turn = nextOf(d, actor);
  }

  if (s.clashRule === "penalty" && d.hands[actor].length === 1 && !calledBefore) {
    d.exposed = { ...d.exposed, [actor]: now + s.catchSeconds * 1000 };
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const colorclash = defineGame<State, Action, View, Settings>({
  meta: {
    id: "colorclash",
    name: "Color Clash",
    tagline: "Match colours, fire action cards, shout Clash!",
    emoji: "🌈",
    category: "cards",
    minPlayers: 2,
    maxPlayers: 10,
    howToPlay: [
      "Play a card that matches the colour or the number/symbol on top. Rainbow cards go on anything and pick the colour.",
      "Freeze skips the next player, Flip reverses direction, +2 and Rainbow +4 make the next player draw.",
      "Can't play? Draw a card; if it fits you may play it.",
      "About to play your second-to-last card? Tap Clash! Forget, and anyone can tap Catch! to give you penalty cards.",
      "First to empty their hand wins the round and scores the points left in everyone else's hands.",
    ],
  },
  settings: SETTINGS,

  validateSettings(settings, players) {
    const decks = deckCountFor(settings, players.length);
    if (players.length * settings.handSize + 20 > DECK_SIZE * decks) return "Not enough cards: use 2 decks or deal fewer cards";
    return null;
  },

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const d: State = {
      order,
      settings,
      deckCount: deckCountFor(settings, order.length),
      round: 1,
      phase: "play",
      hands: {},
      drawPile: [],
      discard: [],
      color: "sun",
      turn: order[0],
      direction: 1,
      pending: 0,
      drawnCard: null,
      called: null,
      exposed: {},
      wild4: null,
      idle: 0,
      totals: Object.fromEntries(order.map((id) => [id, 0])),
      lastRound: null,
      log: [],
      logSeq: 0,
    };
    dealRound(d, 1, rng);
    return d;
  },

  legalActions(state, actor) {
    const me = actor.id;
    const hand = state.hands[me];
    if (!hand || state.phase === "over") return [];
    if (state.phase === "roundOver") return actor.isHost ? [{ type: "nextRound" }] : [];

    const out: Action[] = [];
    if (me === state.turn) {
      const plays = turnPlays(state, me);
      out.push(...plays);
      const forced = state.settings.mustPlay && plays.length > 0;
      if (state.phase === "play") {
        if (canDraw(state)) {
          if (!forced) out.push({ type: "draw" });
        } else if (!forced) {
          out.push({ type: "pass" });
        }
      } else if (state.phase === "drawn") {
        if (!forced) out.push({ type: "pass" });
      } else if (state.phase === "respond") {
        out.push({ type: "accept" });
        if (valueOf(topOf(state)) === "rainbow4" && state.settings.wild4Rule === "challenge" && state.wild4) {
          out.push({ type: "challenge" });
        }
      }
    } else {
      out.push(...jumpInPlays(state, me));
    }

    if (state.settings.clashRule === "penalty") {
      if (state.exposed[me] !== undefined) {
        out.push({ type: "clash" });
      } else if (me === state.turn && hand.length === 2 && state.called !== me && out.some((a) => a.type === "play")) {
        out.push({ type: "clash" });
      }
      for (const target of state.order) {
        if (target !== me && state.exposed[target] !== undefined) out.push({ type: "catch", target });
      }
    }
    if (actor.isHost && state.turn !== me) out.push({ type: "skipTurn" });
    return out;
  },

  reduce(state, action, { actor, rng, now }) {
    const d = clone(state);
    const me = actor.id;
    switch (action.type) {
      case "@timeout": {
        const due = Object.keys(state.exposed).filter((id) => state.exposed[id] <= now);
        if (due.length === 0) return state;
        for (const id of due) delete d.exposed[id];
        return d;
      }
      case "play": {
        check(isPlaying(d), "Not now");
        const jumpIn = me !== d.turn;
        check(!jumpIn || d.settings.jumpIn, "It's not your turn");
        const color = "color" in action ? action.color : null;
        const target = "target" in action ? action.target : null;
        applyPlay(d, me, action.card, color, target, now, rng, jumpIn);
        break;
      }
      case "draw": {
        check(d.phase === "play" && d.turn === me, "It's not your turn");
        d.called = null;
        const drawn: CardId[] = [];
        if (d.settings.drawRule === "one") {
          drawn.push(...drawCards(d, me, 1, rng));
        } else {
          for (;;) {
            const got = drawCards(d, me, 1, rng);
            if (got.length === 0) break;
            drawn.push(got[0]);
            if (matches(d, d.hands[me], got[0])) break;
          }
        }
        addLog(d, { kind: "draw", player: me, count: drawn.length, reason: "turn" });
        if (drawn.length > 0) d.idle = 0;
        const last = drawn[drawn.length - 1];
        if (last !== undefined && matches(d, d.hands[me], last)) {
          d.phase = "drawn";
          d.drawnCard = last;
        } else {
          endTurn(d, me);
        }
        break;
      }
      case "pass": {
        check(d.turn === me, "It's not your turn");
        addLog(d, { kind: "pass", player: me });
        if (d.phase === "drawn") endTurn(d, me);
        else passTurn(d, me);
        break;
      }
      case "accept": {
        check(d.phase === "respond" && d.turn === me, "Nothing to take");
        drawLogged(d, me, d.pending, rng, "plus");
        d.pending = 0;
        d.wild4 = null;
        endTurn(d, me);
        break;
      }
      case "challenge": {
        check(d.phase === "respond" && d.turn === me && d.wild4 !== null, "Nothing to challenge");
        const { player: offender, guilty } = d.wild4!;
        addLog(d, { kind: "challenge", player: me, target: offender, guilty });
        if (guilty) {
          drawLogged(d, offender, d.pending, rng, "challenge");
          d.pending = 0;
          d.wild4 = null;
          d.phase = "play";
        } else {
          drawLogged(d, me, d.pending + 2, rng, "challenge");
          d.pending = 0;
          d.wild4 = null;
          endTurn(d, me);
        }
        break;
      }
      case "clash": {
        if (d.exposed[me] !== undefined) {
          delete d.exposed[me];
          addLog(d, { kind: "clash", player: me, late: true });
        } else {
          check(d.turn === me && d.hands[me].length === 2, "Not now");
          d.called = me;
          addLog(d, { kind: "clash", player: me, late: false });
        }
        break;
      }
      case "catch": {
        const target = action.target;
        check(target !== me && d.exposed[target] !== undefined, "Too late!");
        delete d.exposed[target];
        const got = drawCards(d, target, d.settings.clashPenalty, rng);
        if (got.length > 0) d.idle = 0;
        addLog(d, { kind: "caught", player: me, target, count: got.length });
        break;
      }
      case "skipTurn": {
        check(actor.isHost && isPlaying(d) && d.turn !== me, "Not now");
        const slow = d.turn;
        addLog(d, { kind: "hostSkip", player: slow });
        if (d.phase === "play") {
          if (canDraw(d)) {
            drawLogged(d, slow, 1, rng, "skip");
            endTurn(d, slow);
          } else {
            passTurn(d, slow);
          }
        } else if (d.phase === "drawn") {
          endTurn(d, slow);
        } else {
          drawLogged(d, slow, d.pending, rng, "plus");
          d.pending = 0;
          d.wild4 = null;
          endTurn(d, slow);
        }
        break;
      }
      case "nextRound": {
        check(actor.isHost && d.phase === "roundOver", "Not now");
        dealRound(d, d.round + 1, rng);
        return d;
      }
      default:
        fail("Unknown action");
    }
    if (isPlaying(d)) normalizeExposed(d);
    return d;
  },

  viewFor(state, playerId) {
    const seated = playerId !== null && state.hands[playerId] !== undefined;
    const playing = isPlaying(state);
    const reveal = state.phase === "roundOver" || state.phase === "over";
    return {
      me: seated ? playerId : null,
      phase: state.phase,
      round: state.round,
      settings: state.settings,
      deckCount: state.deckCount,
      order: state.order,
      turn: playing ? state.turn : null,
      direction: state.direction,
      top: topOf(state),
      discardTop: state.discard.slice(-DISCARD_SHOWN),
      color: state.color,
      drawCount: state.drawPile.length,
      discardCount: state.discard.length,
      handCounts: Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])),
      myHand: seated ? state.hands[playerId] : [],
      drawnCard: seated && state.phase === "drawn" && state.turn === playerId ? state.drawnCard : null,
      pending: state.pending,
      called: state.called,
      exposed: playing ? state.exposed : {},
      totals: state.totals,
      targetScore: state.settings.targetScore,
      lastRound: state.lastRound,
      revealedHands: reveal ? state.hands : null,
      log: state.log,
    };
  },

  activePlayers: (state) => (isPlaying(state) ? [state.turn] : []),
  isOver: (state) => state.phase === "over",

  scores(state) {
    if (state.settings.scoring === "single") {
      return rankScores(Object.fromEntries(state.order.map((id) => [id, state.hands[id].length])), false);
    }
    return rankScores(state.totals);
  },

  deadline(state) {
    if (!isPlaying(state)) return null;
    const times = Object.values(state.exposed);
    return times.length ? Math.min(...times) : null;
  },

  botAction(view, legal, rng) {
    const me = view.me;
    const find = (t: Action["type"]) => legal.find((a) => a.type === t);
    const catches = legal.filter((a) => a.type === "catch");
    const plays = legal.filter((a): a is Extract<Action, { type: "play" }> => a.type === "play");
    const clash = find("clash");

    if (me === null || view.turn !== me) {
      if (clash) return clash;
      if (catches.length) return rng.pick(catches);
      if (plays.length) return choosePlay(view, plays, rng) ?? plays[0];
      return rng.pick(legal);
    }

    if (clash && (view.exposed[me] !== undefined || rng.chance(0.85))) return clash;
    if (catches.length && rng.chance(0.7)) return rng.pick(catches);

    if (view.phase === "respond") {
      if (plays.length) return choosePlay(view, plays, rng) ?? plays[0];
      const challenge = find("challenge");
      if (challenge && rng.chance(0.25)) return challenge;
      return find("accept") ?? rng.pick(legal);
    }
    const best = choosePlay(view, plays, rng);
    if (best) return best;
    const fallback = find("draw") ?? find("pass");
    if (fallback) return fallback;
    if (plays.length) return plays[0];
    return rng.pick(legal);
  },
});

/** Bot card choice. Returns null when the only plays are ones the bot would rather not make (e.g. an unfair +4). */
function choosePlay(view: View, plays: Extract<Action, { type: "play" }>[], rng: Rng): Action | null {
  if (plays.length === 0) return null;
  const me = view.me;
  const hand = view.myHand;
  const n = view.order.length;
  const next = me ? view.order[(((view.order.indexOf(me) + view.direction) % n) + n) % n] : null;
  const nextLow = next !== null && (view.handCounts[next] ?? 99) <= 2;
  const topValue = valueOf(view.top);
  const holdsColor = hand.some((c) => colorOf(c) === view.color);

  const score = (card: CardId): number => {
    const p = parseCard(card);
    let s = rng.next();
    if (p.value === "rainbow4") {
      if (view.phase !== "respond" && view.settings.wild4Rule === "challenge" && holdsColor) return -100;
      return s + (nextLow ? 8 : 1);
    }
    if (p.value === "rainbow") return s + 2;
    if (p.color === view.color) s += 10;
    else if (p.value === topValue) s += 6;
    if (p.value === "freeze" || p.value === "flip" || p.value === "plus2") s += nextLow ? 6 : -1;
    return s + cardPoints(card) / 100;
  };

  const cards = [...new Set(plays.map((a) => a.card))];
  const best = cards.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s)[0];
  if (best.s < 0) return null;
  const options = plays.filter((a) => a.card === best.c);
  if (options.length === 1) return options[0];
  if (options.some((a) => "color" in a)) {
    const counts: Record<string, number> = {};
    for (const c of hand) if (c !== best.c && !isWild(c)) counts[colorOf(c)] = (counts[colorOf(c)] ?? 0) + 1;
    const want = COLORS.slice().sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))[0];
    return options.find((a) => "color" in a && a.color === want) ?? options[0];
  }
  // 7-swap: take the hand of the opponent with the fewest cards.
  return options.slice().sort((a, b) => {
    const ta = "target" in a ? view.handCounts[a.target] ?? 99 : 99;
    const tb = "target" in b ? view.handCounts[b.target] ?? 99 : 99;
    return ta - tb;
  })[0];
}

export default colorclash;
