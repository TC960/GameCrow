/**
 * Mafia: social deduction with the app as narrator. Secret roles (Mafia, Doctor, Detective, Villager),
 * simultaneous night actions (everyone acts, so phones look alike), day discussion and a vote.
 * Spec: games/mafia/BRIEF.md. Settings and decisions: games/mafia/NOTES.md.
 */
import { check, defineGame, fail, rankScores, type PlayerId, type Rng } from "../../engine";
import {
  NIGHT_TASK,
  roleCountsFor,
  type Action,
  type Investigation,
  type Reveal,
  type Role,
  type Settings,
  type State,
  type Team,
  type View,
  type VoteReason,
  type VoteReport,
} from "./types";

export type { Action, State, View, Settings };

type Ctx = { rng: Rng; now: number };

const living = (s: State) => s.order.filter((id) => s.alive[id]);
const livingMafia = (s: State) => s.order.filter((id) => s.alive[id] && s.roles[id] === "mafia");
const teamOf = (r: Role): Team => (r === "mafia" ? "mafia" : "village");

function revealFor(s: State, id: PlayerId, mode: "role" | "team" | "none"): Reveal | null {
  if (mode === "none") return null;
  return mode === "role" ? s.roles[id] : teamOf(s.roles[id]);
}

/** Valid night targets for a living player, before killRule "first" narrowing. */
function nightTargets(s: State, id: PlayerId): PlayerId[] {
  const alive = living(s);
  switch (s.roles[id]) {
    case "mafia":
      return alive.filter((p) => s.roles[p] !== "mafia");
    case "doctor": {
      const sp = s.settings.selfProtect;
      const noSelf = sp === "never" || (sp === "once" && s.selfProtectUsed[id]);
      const last = s.settings.repeatProtect ? null : s.lastProtected[id] ?? null;
      return alive.filter((p) => !(noSelf && p === id) && p !== last);
    }
    default:
      return alive.filter((p) => p !== id);
  }
}

function mafiaPicks(s: State): PlayerId[] {
  return livingMafia(s)
    .filter((m) => m in s.nightPicks)
    .map((m) => s.nightPicks[m]);
}

function allMafiaPicked(s: State): boolean {
  return livingMafia(s).every((m) => m in s.nightPicks);
}

function mafiaAgreed(s: State): boolean {
  const picks = mafiaPicks(s);
  return allMafiaPicked(s) && picks.length > 0 && picks.every((p) => p === picks[0]);
}

function nightComplete(s: State): boolean {
  if (!living(s).every((id) => id in s.nightPicks)) return false;
  return s.settings.killRule !== "unanimous" || mafiaAgreed(s);
}

function timer(seconds: number, now: number): number | null {
  return seconds > 0 ? now + seconds * 1000 : null;
}

function enterNight(s: State, now: number): State {
  return {
    ...s,
    phase: "night",
    nightNo: s.nightNo + 1,
    nightPicks: {},
    firstMafiaPick: null,
    phaseEndsAt: timer(s.settings.nightTimer, now),
  };
}

function enterDay(s: State, now: number): State {
  return { ...s, phase: "day", dayNo: s.dayNo + 1, votes: {}, phaseEndsAt: timer(s.settings.discussionTimer, now) };
}

function enterVote(s: State, now: number): State {
  return { ...s, phase: "vote", votes: {}, phaseEndsAt: timer(s.settings.voteTimer, now) };
}

function winnerOf(s: State): Team | null {
  const m = livingMafia(s).length;
  const v = living(s).length - m;
  if (m === 0) return "village";
  if (m >= v) return "mafia";
  return null;
}

/** Kill a player (if any), apply the public reveal, then end the game or continue with `next`. */
function kill(s: State, id: PlayerId): State {
  const reveal = revealFor(s, id, s.settings.revealOnDeath);
  return {
    ...s,
    alive: { ...s.alive, [id]: false },
    revealed: reveal === null ? s.revealed : { ...s.revealed, [id]: reveal },
  };
}

function finishOr(s: State, next: (s: State) => State): State {
  const winner = winnerOf(s);
  if (winner) return { ...s, phase: "over", winner, phaseEndsAt: null };
  return next(s);
}

function mostPicked(s: State, picks: PlayerId[], rng: Rng): PlayerId | null {
  if (picks.length === 0) return null;
  const tally: Record<PlayerId, number> = {};
  for (const p of picks) tally[p] = (tally[p] ?? 0) + 1;
  const top = Math.max(...Object.values(tally));
  const tied = s.order.filter((id) => tally[id] === top);
  return tied.length === 1 ? tied[0] : rng.pick(tied);
}

function resolveNight(s: State, { rng, now }: Ctx): State {
  const picks = mafiaPicks(s);
  let target: PlayerId | null = null;
  switch (s.settings.killRule) {
    case "unanimous":
      target = picks.length > 0 && picks.every((p) => p === picks[0]) ? picks[0] : null;
      break;
    case "majority":
      target = mostPicked(s, picks, rng);
      break;
    case "first":
      target = s.firstMafiaPick;
      break;
  }
  const doctors = s.order.filter((id) => s.alive[id] && s.roles[id] === "doctor");
  const lastProtected = { ...s.lastProtected };
  const selfProtectUsed = { ...s.selfProtectUsed };
  const saved = new Set<PlayerId>();
  for (const d of doctors) {
    const p = d in s.nightPicks ? s.nightPicks[d] : null;
    lastProtected[d] = p;
    if (p !== null) saved.add(p);
    if (p === d) selfProtectUsed[d] = true;
  }
  const deaths = target !== null && s.alive[target] && !saved.has(target) ? [target] : [];
  let next: State = {
    ...s,
    lastProtected,
    selfProtectUsed,
    nightPicks: {},
    firstMafiaPick: null,
    lastNight: { night: s.nightNo, deaths },
    log: [...s.log, { kind: "night", night: s.nightNo, deaths }],
  };
  for (const d of deaths) next = kill(next, d);
  return finishOr(next, (x) => enterDay(x, now));
}

function resolveVote(s: State, { rng }: Ctx): State {
  const alive = living(s);
  const tally: Record<PlayerId, number> = {};
  let abstains = 0;
  for (const voter of alive) {
    if (!(voter in s.votes)) continue;
    const t = s.votes[voter];
    if (t === null) abstains++;
    else tally[t] = (tally[t] ?? 0) + 1;
  }
  const counts = Object.values(tally);
  const top = counts.length ? Math.max(...counts) : 0;
  const leaders = s.order.filter((id) => tally[id] === top && top > 0);
  let eliminated: PlayerId | null = null;
  let reason: VoteReason;
  if (s.settings.voteRule === "majority") {
    const need = Math.floor(alive.length / 2) + 1;
    if (top >= need) {
      eliminated = leaders[0];
      reason = "eliminated";
    } else reason = top === 0 ? "noVotes" : "noMajority";
  } else if (top === 0) reason = "noVotes";
  else if (abstains > top) reason = "abstain";
  else if (abstains === top) reason = "tie";
  else if (leaders.length > 1) {
    if (s.settings.tieRule === "random") {
      eliminated = rng.pick(leaders);
      reason = "eliminated";
    } else reason = "tie";
  } else {
    eliminated = leaders[0];
    reason = "eliminated";
  }
  const ballots: Record<PlayerId, PlayerId | null> = {};
  for (const voter of alive) if (voter in s.votes) ballots[voter] = s.votes[voter];
  const report: VoteReport = {
    day: s.dayNo,
    eliminated,
    reason,
    tally,
    abstains,
    ballots: s.settings.voteVisibility === "open" ? ballots : null,
  };
  let next: State = {
    ...s,
    lastVote: report,
    log: [...s.log, { kind: "vote", day: s.dayNo, eliminated, reason }],
    phaseEndsAt: null,
  };
  if (eliminated !== null) next = kill(next, eliminated);
  return finishOr(next, (x) => ({ ...x, phase: "verdict", phaseEndsAt: null }));
}

function startFirstPhase(s: State, now: number): State {
  return s.settings.startWith === "day" ? enterDay(s, now) : enterNight(s, now);
}

/** Move the current phase forward exactly as its timer would (host "advance" / "@timeout"). */
function advance(s: State, ctx: Ctx): State {
  switch (s.phase) {
    case "roles":
      return startFirstPhase(s, ctx.now);
    case "night":
      return resolveNight(s, ctx);
    case "day":
      return enterVote(s, ctx.now);
    case "vote":
      return resolveVote(s, ctx);
    case "verdict":
      return enterNight(s, ctx.now);
    case "over":
      return fail("The game is over");
  }
}

function nightLegal(s: State, id: PlayerId): Action[] {
  const role = s.roles[id];
  if (!(id in s.nightPicks)) {
    let targets = nightTargets(s, id);
    if (role === "mafia" && s.settings.killRule === "first" && s.firstMafiaPick !== null) {
      targets = targets.filter((t) => t === s.firstMafiaPick);
    }
    return targets.map((target) => ({ type: "night", target }));
  }
  if (role === "mafia" && s.settings.killRule === "unanimous" && allMafiaPicked(s) && !mafiaAgreed(s)) {
    const current = s.nightPicks[id];
    return nightTargets(s, id)
      .filter((t) => t !== current)
      .map((target) => ({ type: "night", target }));
  }
  return [];
}

const mafia = defineGame<State, Action, View, Settings>({
  meta: {
    id: "mafia",
    name: "Mafia",
    tagline: "Secret roles. Night kills. Find the Mafia before they find you.",
    emoji: "🔪",
    category: "party",
    minPlayers: 5,
    maxPlayers: 16,
    howToPlay: [
      "Hold to see your secret role. Mafia know each other; nobody else knows anyone.",
      "At night everyone taps a player in secret: the Mafia pick a victim, the Doctor protects someone, the Detective investigates, Villagers pick a suspect (it does nothing).",
      "By day the app announces who died. Talk it over in person, then vote someone out.",
      "Dead players stay quiet. The village wins when all Mafia are gone; the Mafia win when they equal the rest.",
    ],
  },
  settings: [
    { type: "number", key: "mafiaCount", label: "Mafia", default: 0, min: 0, max: 5, group: "Roles", help: "0 = Auto: 1 for 5–6 players, 2 for 7–9, 3 for 10–12, 4 for 13–16." },
    { type: "number", key: "doctors", label: "Doctors", default: 1, min: 0, max: 2, group: "Roles" },
    { type: "number", key: "detectives", label: "Detectives", default: 1, min: 0, max: 2, group: "Roles" },
    {
      type: "select",
      key: "killRule",
      label: "Mafia must agree",
      default: "unanimous",
      group: "Night",
      options: [
        { value: "unanimous", label: "All Mafia pick the same victim" },
        { value: "majority", label: "Most picks wins (ties random)" },
        { value: "first", label: "First Mafia pick decides" },
      ],
    },
    {
      type: "select",
      key: "selfProtect",
      label: "Doctor can protect themself",
      default: "always",
      group: "Night",
      options: [
        { value: "always", label: "Yes" },
        { value: "once", label: "Once per game" },
        { value: "never", label: "No" },
      ],
    },
    { type: "boolean", key: "repeatProtect", label: "Doctor can protect the same player two nights in a row", default: false, group: "Night" },
    {
      type: "select",
      key: "detectiveResult",
      label: "Detective learns",
      default: "team",
      group: "Night",
      options: [
        { value: "team", label: "Mafia or not" },
        { value: "role", label: "The exact role" },
      ],
    },
    {
      type: "select",
      key: "startWith",
      label: "Game starts with",
      default: "night",
      group: "Flow",
      options: [
        { value: "night", label: "Night (Mafia strike first)" },
        { value: "day", label: "Day (talk and vote first)" },
      ],
    },
    {
      type: "select",
      key: "revealOnDeath",
      label: "When someone dies, reveal",
      default: "role",
      group: "Flow",
      options: [
        { value: "role", label: "Their role" },
        { value: "team", label: "Only Mafia or not" },
        { value: "none", label: "Nothing" },
      ],
    },
    { type: "boolean", key: "deadSeeRoles", label: "Dead players see everyone's role", default: false, group: "Flow" },
    {
      type: "select",
      key: "voteRule",
      label: "Vote someone out with",
      default: "plurality",
      group: "Voting",
      options: [
        { value: "plurality", label: "Most votes" },
        { value: "majority", label: "More than half of the living" },
      ],
    },
    {
      type: "select",
      key: "tieRule",
      label: "Tied vote",
      default: "none",
      group: "Voting",
      visibleIf: { key: "voteRule", in: ["plurality"] },
      options: [
        { value: "none", label: "Nobody is voted out" },
        { value: "random", label: "Random among the tied" },
      ],
    },
    { type: "boolean", key: "allowAbstain", label: "Allow a \"No elimination\" vote", default: true, group: "Voting" },
    {
      type: "select",
      key: "voteVisibility",
      label: "After the vote show",
      default: "open",
      group: "Voting",
      options: [
        { value: "open", label: "Who voted for whom" },
        { value: "tally", label: "Only the totals" },
      ],
    },
    { type: "number", key: "nightTimer", label: "Night timer (seconds, 0 = off)", default: 0, min: 0, max: 300, step: 15, group: "Timers" },
    { type: "number", key: "discussionTimer", label: "Discussion timer (seconds, 0 = off)", default: 0, min: 0, max: 900, step: 30, group: "Timers" },
    { type: "number", key: "voteTimer", label: "Vote timer (seconds, 0 = off)", default: 0, min: 0, max: 300, step: 15, group: "Timers" },
  ],

  validateSettings(settings, players) {
    const n = players.length;
    const c = roleCountsFor(n, settings);
    if (c.mafia * 2 >= n) return `Too many Mafia for ${n} players`;
    if (c.mafia + c.doctor + c.detective > n) return "Not enough players for these roles";
    return null;
  },

  setup(players, settings, { rng }) {
    const order = players.map((p) => p.id);
    const counts = roleCountsFor(order.length, settings);
    const deck: Role[] = [
      ...Array<Role>(counts.mafia).fill("mafia"),
      ...Array<Role>(counts.doctor).fill("doctor"),
      ...Array<Role>(counts.detective).fill("detective"),
    ];
    while (deck.length < order.length) deck.push("villager");
    const dealt = rng.shuffle(deck);
    const roles = Object.fromEntries(order.map((id, i) => [id, dealt[i]])) as Record<PlayerId, Role>;
    const doctors = order.filter((id) => roles[id] === "doctor");
    const detectives = order.filter((id) => roles[id] === "detective");
    return {
      order,
      roles,
      alive: Object.fromEntries(order.map((id) => [id, true])),
      phase: "roles",
      nightNo: 0,
      dayNo: 0,
      ready: Object.fromEntries(order.map((id) => [id, false])),
      nightPicks: {},
      firstMafiaPick: null,
      investigations: Object.fromEntries(detectives.map((id) => [id, []])),
      lastProtected: Object.fromEntries(doctors.map((id) => [id, null])),
      selfProtectUsed: Object.fromEntries(doctors.map((id) => [id, false])),
      votes: {},
      revealed: {},
      lastNight: null,
      lastVote: null,
      log: [],
      winner: null,
      phaseEndsAt: null,
      roleCounts: counts,
      settings,
    };
  },

  legalActions(state, actor) {
    const id = actor.id;
    const seated = state.order.includes(id);
    const host: Action[] = actor.isHost && seated && state.phase !== "over" ? [{ type: "advance" }] : [];
    if (!seated) return [];
    let own: Action[] = [];
    switch (state.phase) {
      case "roles":
        own = state.ready[id] ? [] : [{ type: "ready" }];
        break;
      case "night":
        own = state.alive[id] ? nightLegal(state, id) : [];
        break;
      case "vote":
        if (state.alive[id] && !(id in state.votes)) {
          own = living(state)
            .filter((p) => p !== id)
            .map((target) => ({ type: "vote", target }) as Action);
          if (state.settings.allowAbstain) own.push({ type: "abstain" });
        }
        break;
    }
    return [...own, ...host];
  },

  reduce(state, action, { actor, rng, now }) {
    const ctx = { rng, now };
    const id = actor.id;
    switch (action.type) {
      case "ready": {
        check(state.phase === "roles", "Not now");
        const ready = { ...state.ready, [id]: true };
        const next = { ...state, ready };
        return state.order.every((p) => ready[p]) ? startFirstPhase(next, now) : next;
      }
      case "night": {
        check(state.phase === "night" && state.alive[id], "Not now");
        check(state.alive[action.target], "Pick a living player");
        const first = id in state.nightPicks;
        let next: State = { ...state, nightPicks: { ...state.nightPicks, [id]: action.target } };
        const role = state.roles[id];
        if (role === "mafia" && state.settings.killRule === "first" && state.firstMafiaPick === null) {
          next = { ...next, firstMafiaPick: action.target };
        }
        if (role === "detective" && !first) {
          const r = state.roles[action.target];
          const result: Reveal = state.settings.detectiveResult === "role" ? r : teamOf(r);
          const entry: Investigation = { night: state.nightNo, target: action.target, result };
          next = { ...next, investigations: { ...state.investigations, [id]: [...(state.investigations[id] ?? []), entry] } };
        }
        return nightComplete(next) ? resolveNight(next, ctx) : next;
      }
      case "vote":
      case "abstain": {
        check(state.phase === "vote" && state.alive[id] && !(id in state.votes), "Not now");
        const target = action.type === "vote" ? action.target : null;
        if (target !== null) check(target !== id && state.alive[target], "Vote for a living player");
        const next = { ...state, votes: { ...state.votes, [id]: target } };
        return living(next).every((p) => p in next.votes) ? resolveVote(next, ctx) : next;
      }
      case "advance":
        check(actor.isHost, "Only the host can do that");
        return advance(state, ctx);
      case "@timeout":
        check(state.phaseEndsAt !== null, "No timer running");
        return advance(state, ctx);
    }
  },

  viewFor(state, playerId) {
    const me = playerId !== null && state.order.includes(playerId) ? playerId : null;
    const myRole = me ? state.roles[me] : null;
    const amAlive = me ? state.alive[me] : false;
    const over = state.phase === "over";
    const isMafia = myRole === "mafia";
    const alive = living(state);
    let teamPicks: Record<PlayerId, PlayerId> | null = null;
    if (isMafia && amAlive && state.phase === "night") {
      teamPicks = {};
      for (const m of livingMafia(state)) if (m in state.nightPicks) teamPicks[m] = state.nightPicks[m];
    }
    const showAll = over || (me !== null && !amAlive && state.settings.deadSeeRoles);
    return {
      phase: state.phase,
      nightNo: state.nightNo,
      dayNo: state.dayNo,
      order: state.order,
      alive: state.alive,
      revealed: state.revealed,
      allRoles: showAll ? state.roles : null,
      roleCounts: state.roleCounts,
      myRole,
      amAlive,
      nightTask: myRole ? NIGHT_TASK[myRole] : null,
      team: isMafia ? state.order.filter((id) => state.roles[id] === "mafia") : [],
      teamPicks,
      myNightPick: me && state.phase === "night" && me in state.nightPicks ? state.nightPicks[me] : null,
      investigations: me && myRole === "detective" ? state.investigations[me] ?? [] : [],
      myLastProtected: me && myRole === "doctor" ? state.lastProtected[me] ?? null : null,
      selfProtectUsed: me && myRole === "doctor" ? state.selfProtectUsed[me] ?? false : false,
      ready: state.ready,
      nightDone: state.phase === "night" ? Object.fromEntries(alive.map((id) => [id, id in state.nightPicks])) : {},
      voted: state.phase === "vote" ? Object.fromEntries(alive.map((id) => [id, id in state.votes])) : {},
      iVoted: me !== null && state.phase === "vote" && me in state.votes,
      myVote: me && state.phase === "vote" && me in state.votes ? state.votes[me] : null,
      lastNight: state.lastNight,
      lastVote: state.lastVote,
      log: state.log,
      winner: state.winner,
      phaseEndsAt: state.phaseEndsAt,
      settings: state.settings,
    };
  },

  activePlayers(state) {
    switch (state.phase) {
      case "roles":
        return state.order.filter((id) => !state.ready[id]);
      case "night":
        return living(state).filter((id) => !(id in state.nightPicks));
      case "vote":
        return living(state).filter((id) => !(id in state.votes));
      default:
        return [];
    }
  },

  isOver: (state) => state.phase === "over",

  scores(state) {
    const totals = Object.fromEntries(
      state.order.map((id) => [id, state.winner !== null && teamOf(state.roles[id]) === state.winner ? 1 : 0]),
    );
    return rankScores(totals);
  },

  deadline: (state) => state.phaseEndsAt,

  botAction(view, legal, rng) {
    const own = legal.filter((a) => a.type !== "advance");
    if (own.length === 0) return rng.pick(legal);
    const ready = own.find((a) => a.type === "ready");
    if (ready) return ready;
    const night = own.filter((a): a is Extract<Action, { type: "night" }> => a.type === "night");
    if (night.length) {
      if (view.teamPicks) {
        // Copy a teammate (a re-pick's legal list already excludes my own current pick).
        const picks = Object.values(view.teamPicks);
        const copy = night.find((a) => picks.includes(a.target));
        if (copy) return copy;
      }
      if (view.nightTask === "investigate") {
        const seen = new Set(view.investigations.map((i) => i.target));
        const fresh = night.filter((a) => !seen.has(a.target));
        if (fresh.length) return rng.pick(fresh);
      }
      return rng.pick(night);
    }
    const votes = own.filter((a): a is Extract<Action, { type: "vote" }> => a.type === "vote");
    if (votes.length) {
      const known = view.investigations.filter((i) => i.result === "mafia").map((i) => i.target);
      const hit = votes.find((a) => known.includes(a.target));
      if (hit) return hit;
      const nonTeam = votes.filter((a) => !view.team.includes(a.target));
      return rng.pick(nonTeam.length ? nonTeam : votes);
    }
    return rng.pick(own);
  },
});

export default mafia;
