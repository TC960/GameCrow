/**
 * Psych: the bluffing party game. Each round shows a prompt (a trivia fact with a surprising real answer,
 * or a question about one of the players). Everyone writes a fake answer; the fakes and the real answer are
 * shown shuffled and anonymous; everyone votes for what they think is true. You score for every player
 * your fake fools and for finding the real answer. See NOTES.md for the house rules and rule decisions.
 *
 * prompts.ts (the real answers) is imported only here, so it never ships to clients.
 */
import { check, defineGame, fail, FREE_TEXT, rankScores, type PlayerId, type Rng } from "../../engine";
import { FRIENDS, TRIVIA } from "./prompts";
import {
  MAX_ANSWER_LENGTH,
  MAX_CUSTOM_PROMPTS_LENGTH,
  MAX_CUSTOM_QUESTION_LENGTH,
  MODES,
  PACKS,
  PACK_IDS,
  PLAYER_PLACEHOLDER,
  type Action,
  type OptionRecord,
  type RevealInfo,
  type RoundPrompt,
  type Settings,
  type State,
  type View,
} from "./types";

export type { Action, State, View, Settings };

const REAL_ANSWER_MESSAGE = "That's the real answer! Write a fake one";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Trim, drop control characters and collapse runs of whitespace. */
export function cleanText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Comparison key for answers: case, accents, spaces, punctuation and a leading "a"/"an"/"the" are ignored.
 * Used both to reject the real answer and to merge identical fakes.
 */
export function normalizeAnswer(raw: string): string {
  const base = raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = base.replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^(a|an|the) (?=\S)/, "");
  const key = words.replace(/ /g, "");
  // An answer made only of punctuation/emoji still needs a stable key.
  return key || cleanText(raw).toLowerCase();
}

const PLAYER_RE = /\{\s*player\s*\}/gi;

/** Parse the customPrompts setting: one prompt per line, "Question | Answer | other accepted spellings". */
export function parseCustomPrompts(text: string): RoundPrompt[] {
  const seen = new Set<string>();
  const out: RoundPrompt[] = [];
  for (const line of text.slice(0, MAX_CUSTOM_PROMPTS_LENGTH).split(/\r?\n/)) {
    const parts = line.split("|").map(cleanText);
    const q = parts[0].replace(PLAYER_RE, PLAYER_PLACEHOLDER).slice(0, MAX_CUSTOM_QUESTION_LENGTH).trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const answers = parts.slice(1).map((a) => a.slice(0, MAX_ANSWER_LENGTH).trim()).filter(Boolean);
    out.push({
      text: q,
      answer: answers[0] ?? null,
      alts: answers.slice(1),
      subject: null,
      truth: answers.length ? "fact" : "none",
      source: "custom",
    });
  }
  return out;
}

function hasPlaceholder(text: string): boolean {
  return text.includes(PLAYER_PLACEHOLDER);
}

function isRealAnswer(prompt: RoundPrompt, text: string): boolean {
  if (prompt.truth !== "fact" || prompt.answer === null) return false;
  const key = normalizeAnswer(text);
  return [prompt.answer, ...prompt.alts].some((a) => normalizeAnswer(a) === key);
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function triviaPool(settings: Settings): RoundPrompt[] {
  return PACK_IDS.filter((id) => settings.packs.includes(id)).flatMap((id) =>
    TRIVIA[id].map((p): RoundPrompt => ({
      text: p.q,
      answer: p.a,
      alts: p.alts ?? [],
      subject: null,
      truth: "fact",
      source: id,
    })),
  );
}

function friendsPool(): RoundPrompt[] {
  return FRIENDS.map((t): RoundPrompt => ({ text: t, answer: null, alts: [], subject: null, truth: "none", source: "friends" }));
}

/** Choose this match's prompts (no repeats), custom ones always included, and rotate the subjects. */
function choosePrompts(order: PlayerId[], settings: Settings, rng: Rng): RoundPrompt[] {
  const customs = rng.shuffle(parseCustomPrompts(settings.customPrompts)).slice(0, settings.rounds);
  const trivia = rng.shuffle(triviaPool(settings));
  const friends = rng.shuffle(friendsPool());

  const base: RoundPrompt[] = [];
  for (let i = 0; i < settings.rounds - customs.length; i++) {
    const wantTrivia = settings.mode === "trivia" || (settings.mode === "mixed" && i % 2 === 0);
    const first = wantTrivia ? trivia : friends;
    const fallback = settings.mode === "mixed" ? (wantTrivia ? friends : trivia) : [];
    const next = first.shift() ?? fallback.shift();
    if (!next) break; // ran out of prompts: play fewer rounds rather than repeat
    base.push(next);
  }

  const all = base;
  for (const c of customs) all.splice(rng.int(0, all.length), 0, c);

  // Subjects rotate through the seats, starting from a random player.
  const start = rng.int(0, order.length - 1);
  let k = 0;
  return all.map((p) => {
    if (!hasPlaceholder(p.text)) return p;
    const subject = order[(start + k++) % order.length];
    const truth = p.truth === "fact" ? "fact" : settings.friendsRealAnswer === "subject" ? "subject" : "none";
    return { ...p, subject, truth };
  });
}

function zeroes(order: PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(order.map((id) => [id, 0]));
}

function nulls(order: PlayerId[]): Record<PlayerId, null> {
  return Object.fromEntries(order.map((id) => [id, null]));
}

function startRound(state: State, round: number, now: number): State {
  return {
    ...state,
    round,
    phase: "answer",
    answers: nulls(state.order),
    options: [],
    voters: [],
    votes: {},
    roundPoints: zeroes(state.order),
    deadline: state.settings.answerSeconds > 0 ? now + state.settings.answerSeconds * 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function currentPrompt(state: State): RoundPrompt {
  return state.prompts[state.round - 1];
}

/** The subject of a "subject" round (who wrote the truth and doesn't vote), if they answered. */
function truthWriter(state: State): PlayerId | null {
  const p = currentPrompt(state);
  return p.truth === "subject" && p.subject && state.answers[p.subject] !== null ? p.subject : null;
}

/** Answering is over: build the shuffled options, then vote (if there is anything to vote on) or reveal. */
function endAnswers(state: State, rng: Rng, now: number): State {
  const prompt = currentPrompt(state);
  const answered = state.order.filter((id) => state.answers[id] !== null);
  const writer = truthWriter(state);

  type Draft = Omit<OptionRecord, "id"> & { texts: string[] };
  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  let real: Draft | null = null;
  if (prompt.truth === "fact" && prompt.answer !== null) {
    real = { text: prompt.answer, authors: [], isReal: true, texts: [] };
    drafts.push(real);
  } else if (writer) {
    real = { text: state.answers[writer]!, authors: [writer], isReal: true, texts: [] };
    drafts.push(real);
    byKey.set(normalizeAnswer(real.text), real);
  }
  for (const id of answered) {
    if (id === writer) continue;
    const text = state.answers[id]!;
    const key = normalizeAnswer(text);
    const existing = byKey.get(key);
    if (existing) {
      existing.authors.push(id);
      existing.texts.push(text);
      continue;
    }
    const d: Draft = { text, authors: [id], isReal: false, texts: [text] };
    byKey.set(key, d);
    drafts.push(d);
  }

  const options: OptionRecord[] = rng.shuffle(drafts).map((d, i) => ({
    id: `o${i + 1}`,
    // Merged fakes show one spelling, chosen independently of who wrote it.
    text: d.isReal ? d.text : d.texts.slice().sort()[0],
    authors: d.authors,
    isReal: d.isReal,
  }));

  const canVote = (id: PlayerId) => id !== writer && options.some((o) => !o.authors.includes(id));
  const voters = answered.length >= 2 && options.length >= 2 ? state.order.filter(canVote) : [];
  const next: State = { ...state, options, voters, votes: nulls(voters), deadline: null };
  if (voters.length === 0) return finishRound(next);
  return {
    ...next,
    phase: "vote",
    deadline: state.settings.voteSeconds > 0 ? now + state.settings.voteSeconds * 1000 : null,
  };
}

function roundScores(state: State): Record<PlayerId, number> {
  const { fooledPoints, truthPoints } = state.settings;
  const pts = zeroes(state.order);
  for (const v of state.voters) {
    const o = state.options.find((x) => x.id === state.votes[v]);
    if (!o) continue;
    if (o.isReal) pts[v] += truthPoints;
    else for (const a of o.authors) pts[a] += fooledPoints;
  }
  // "Subject" rounds: anyone whose answer matched the subject's truth read their mind.
  const writer = truthWriter(state);
  const real = state.options.find((o) => o.isReal);
  if (writer && real) for (const a of real.authors) if (a !== writer) pts[a] += truthPoints;
  return pts;
}

function finishRound(state: State): State {
  const roundPoints = roundScores(state);
  const scores = Object.fromEntries(state.order.map((id) => [id, state.scores[id] + roundPoints[id]]));
  return { ...state, phase: "reveal", deadline: null, roundPoints, scores };
}

/** Host skip or timer: move on with whoever has answered / voted. */
function moveOn(state: State, rng: Rng, now: number): State {
  if (state.phase === "answer") return endAnswers(state, rng, now);
  if (state.phase === "vote") return finishRound(state);
  return state;
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

function sourceLabel(p: RoundPrompt): string {
  if (p.source === "custom") return "Custom";
  if (p.source === "friends") return "About the players";
  return PACKS.find((x) => x.value === p.source)?.label ?? "Trivia";
}

function revealInfo(state: State, me: PlayerId | null): RevealInfo {
  const prompt = currentPrompt(state);
  const real = state.options.find((o) => o.isReal) ?? null;
  const writer = truthWriter(state);
  const votersOf = (id: string) => state.voters.filter((v) => state.votes[v] === id);
  return {
    realAnswer: real ? real.text : prompt.truth === "fact" ? prompt.answer : null,
    options: state.options.map((o) => ({
      id: o.id,
      text: o.text,
      isReal: o.isReal,
      authors: o.authors,
      voters: votersOf(o.id),
      pointsPerAuthor: o.isReal ? 0 : votersOf(o.id).length * state.settings.fooledPoints,
      isMine: me !== null && o.authors.includes(me),
    })),
    truthGuessers: writer && real ? real.authors.filter((a) => a !== writer) : [],
    roundPoints: state.roundPoints,
    noAnswer: state.order.filter((id) => state.answers[id] === null),
    noVote: state.voters.filter((id) => state.votes[id] == null),
    voteSkipped: state.voters.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

const BOT_ADJECTIVES = ["sleepy", "sparkly", "grumpy", "tiny", "dancing", "invisible", "soggy", "fancy", "angry", "wobbly"];
const BOT_NOUNS = ["walrus", "teapot", "noodle", "pancake", "llama", "sock", "cactus", "trombone", "pickle jar", "hamster"];

export function botAnswer(rng: Rng): string {
  return `A ${rng.pick(BOT_ADJECTIVES)} ${rng.pick(BOT_NOUNS)}`;
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const psych = defineGame<State, Action, View, Settings>({
  meta: {
    id: "psych",
    name: "Psych",
    tagline: "Fake the answer. Fool your friends. Find the truth.",
    emoji: "🤥",
    category: "party",
    minPlayers: 3,
    maxPlayers: 12,
    howToPlay: [
      "Each round shows a prompt: a trivia fact with a surprising real answer, or a question about one of you.",
      "Everyone secretly writes a believable fake answer.",
      "All answers, plus the real one, are shown shuffled and anonymous. Vote for the one you think is true (not your own).",
      "Score for every player who falls for your fake, and for picking the real answer.",
      "The host moves on after each reveal. Most points after the last round wins.",
    ],
  },

  settings: [
    {
      type: "select",
      key: "mode",
      label: "Prompts",
      group: "Prompts",
      default: "trivia",
      options: MODES,
    },
    {
      type: "multiselect",
      key: "packs",
      label: "Trivia packs",
      group: "Prompts",
      default: [...PACK_IDS],
      options: PACKS,
      minSelected: 0,
      visibleIf: { key: "mode", in: ["trivia", "mixed"] },
    },
    {
      type: "select",
      key: "friendsRealAnswer",
      label: "Real answer for player prompts",
      help: "With 'The subject', the player the prompt is about writes the true answer and doesn't vote; finding it scores like a real answer.",
      group: "Prompts",
      default: "none",
      options: [
        { value: "none", label: "None (vote for the best fake)" },
        { value: "subject", label: "The subject writes the truth" },
      ],
      visibleIf: { key: "mode", in: ["friends", "mixed"] },
    },
    {
      type: "text",
      key: "customPrompts",
      label: "Custom prompts",
      help: "One per line: Question | Answer. Use ___ for the blank and {player} for a player. The answer is optional. Custom prompts are always played. Everyone in the room can read house rules, so the answers aren't secret.",
      group: "Prompts",
      default: "",
      maxLength: MAX_CUSTOM_PROMPTS_LENGTH,
      multiline: true,
      placeholder: "The tallest animal is the ___ | Giraffe",
    },
    { type: "number", key: "rounds", label: "Rounds", group: "Game", default: 7, min: 3, max: 20 },
    {
      type: "number",
      key: "answerSeconds",
      label: "Answer timer (seconds)",
      help: "0 = no timer. When time runs out the game moves on with whoever has answered.",
      group: "Timers",
      default: 0,
      min: 0,
      max: 180,
      step: 15,
    },
    {
      type: "number",
      key: "voteSeconds",
      label: "Vote timer (seconds)",
      help: "0 = no timer. When time runs out, missing votes are skipped.",
      group: "Timers",
      default: 0,
      min: 0,
      max: 120,
      step: 15,
    },
    {
      type: "number",
      key: "fooledPoints",
      label: "Points per player you fool",
      group: "Scoring",
      default: 1,
      min: 1,
      max: 5,
    },
    {
      type: "number",
      key: "truthPoints",
      label: "Points for picking the real answer",
      group: "Scoring",
      default: 2,
      min: 0,
      max: 5,
    },
  ],

  validateSettings(settings) {
    if (settings.mode !== "friends" && settings.packs.length === 0 && parseCustomPrompts(settings.customPrompts).length === 0) {
      return "Pick at least one trivia pack or add custom prompts";
    }
    return null;
  },

  setup(players, settings, { rng, now }) {
    const order = players.map((p) => p.id);
    const state: State = {
      order,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      settings,
      prompts: choosePrompts(order, settings, rng),
      round: 1,
      phase: "answer",
      answers: nulls(order),
      options: [],
      voters: [],
      votes: {},
      deadline: null,
      scores: zeroes(order),
      roundPoints: zeroes(order),
    };
    return startRound(state, 1, now);
  },

  legalActions(state, actor) {
    const out: Action[] = [];
    const seated = state.order.includes(actor.id);
    switch (state.phase) {
      case "answer":
        if (seated && state.answers[actor.id] === null) out.push({ type: "answer", text: FREE_TEXT });
        if (actor.isHost) out.push({ type: "skip" });
        break;
      case "vote":
        if (state.voters.includes(actor.id) && state.votes[actor.id] === null) {
          for (const o of state.options) if (!o.authors.includes(actor.id)) out.push({ type: "vote", option: o.id });
        }
        if (actor.isHost) out.push({ type: "skip" });
        break;
      case "reveal":
        if (actor.isHost) out.push({ type: "nextRound" });
        break;
      case "over":
        break;
    }
    return out;
  },

  reduce(state, action, { actor, rng, now }) {
    switch (action.type) {
      case "answer": {
        check(state.phase === "answer", "Answering is over");
        check(state.answers[actor.id] === null, "You already answered");
        const text = cleanText(typeof action.text === "string" ? action.text : "");
        check(text.length > 0, "Write an answer first");
        check(text.length <= MAX_ANSWER_LENGTH, `Keep it to ${MAX_ANSWER_LENGTH} characters`);
        if (isRealAnswer(currentPrompt(state), text)) fail(REAL_ANSWER_MESSAGE);
        const next = { ...state, answers: { ...state.answers, [actor.id]: text } };
        return state.order.every((id) => next.answers[id] !== null) ? endAnswers(next, rng, now) : next;
      }
      case "vote": {
        check(state.phase === "vote", "Voting is over");
        check(state.voters.includes(actor.id), "You don't vote this round");
        check(state.votes[actor.id] === null, "You already voted");
        const option = state.options.find((o) => o.id === action.option);
        check(option, "Pick one of the answers");
        check(!option.authors.includes(actor.id), "You can't vote for your own answer");
        const next = { ...state, votes: { ...state.votes, [actor.id]: option.id } };
        return next.voters.every((id) => next.votes[id] !== null) ? finishRound(next) : next;
      }
      case "skip": {
        check(state.phase === "answer" || state.phase === "vote", "Nothing to skip");
        return moveOn(state, rng, now);
      }
      case "@timeout":
        return moveOn(state, rng, now);
      case "nextRound": {
        check(state.phase === "reveal", "Finish this round first");
        if (state.round >= state.prompts.length) return { ...state, phase: "over", deadline: null };
        return startRound(state, state.round + 1, now);
      }
    }
  },

  viewFor(state, playerId) {
    const me = playerId !== null && state.order.includes(playerId) ? playerId : null;
    const prompt = currentPrompt(state);
    const subjectName = prompt.subject ? state.names[prompt.subject] ?? null : null;
    const promptText = subjectName ? prompt.text.split(PLAYER_PLACEHOLDER).join(subjectName) : prompt.text;
    const showOptions = state.phase !== "answer";
    const revealed = state.phase === "reveal" || state.phase === "over";
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.prompts.length,
      kind: prompt.subject ? "friends" : "trivia",
      promptText,
      sourceLabel: sourceLabel(prompt),
      subject: prompt.subject,
      subjectName,
      iAmSubject: me !== null && me === prompt.subject,
      truth: prompt.truth,
      writeTruth: me !== null && prompt.truth === "subject" && me === prompt.subject,
      answered: Object.fromEntries(state.order.map((id) => [id, state.answers[id] !== null])),
      answeredCount: state.order.filter((id) => state.answers[id] !== null).length,
      answerTarget: state.order.length,
      myAnswer: me ? state.answers[me] ?? null : null,
      options: showOptions
        ? state.options.map((o) => ({ id: o.id, text: o.text, isMine: me !== null && o.authors.includes(me) }))
        : null,
      voters: showOptions ? state.voters : [],
      voted: Object.fromEntries(state.order.map((id) => [id, showOptions && state.votes[id] != null])),
      myVote: me && showOptions ? state.votes[me] ?? null : null,
      reveal: revealed ? revealInfo(state, me) : null,
      scores: state.scores,
      rules: {
        mode: state.settings.mode,
        answerSeconds: state.settings.answerSeconds,
        voteSeconds: state.settings.voteSeconds,
        fooledPoints: state.settings.fooledPoints,
        truthPoints: state.settings.truthPoints,
        maxAnswerLength: MAX_ANSWER_LENGTH,
      },
      isLastRound: state.round >= state.prompts.length,
    };
  },

  activePlayers(state) {
    if (state.phase === "answer") return state.order.filter((id) => state.answers[id] === null);
    if (state.phase === "vote") return state.voters.filter((id) => state.votes[id] === null);
    return [];
  },

  isOver: (state) => state.phase === "over",
  scores: (state) => rankScores(state.scores),
  deadline: (state) => (state.phase === "answer" || state.phase === "vote" ? state.deadline : null),

  botAction(_view, legal, rng) {
    if (legal.some((a) => a.type === "answer")) return { type: "answer", text: botAnswer(rng) };
    const votes = legal.filter((a) => a.type === "vote");
    if (votes.length) return rng.pick(votes);
    return rng.pick(legal);
  },
});

export default psych;
