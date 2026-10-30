# Imposter: game brief

Game id `imposter`, category `party`, 4–12 players, portrait. A social deduction word game for people in
the same room. Everyone gets the same secret word except the Imposter(s), who must bluff their way through
the clue rounds. Then the table votes.

This brief is the spec the rules and the tests are written against. Types and constants are in
`games/imposter/types.ts`. Words are in `games/imposter/words.ts` (server-only, imported by `rules.ts` only).

---

## 1. Round flow

A game is `rounds` rounds (default 5). Each round:

1. **Deal** (no action needed, happens in `setup` / `nextRound`):
   - Pick the round's imposters (`imposterCount`, see 3.1) using `imposterPick`.
   - Pick a category and a word (see 3.3). Crew members see the word and its category. Imposters see only
     the category (`imposterHint: "category"`, default) or nothing (`"nothing"`).
   - Build the clue order: seat order rotated so it starts at the round's first clue-giver (`firstClue`).
2. **Clue phase** (`phase: "clue"`): `clueRounds` passes (default 2) through the clue order. On each turn
   exactly one player (the current clue-giver) may send `{ type: "clue", text }`. Every clue is public and
   shown in order. Imposters give clues too. The host may skip the current giver (`skipClue`); a timer can
   skip them automatically (`clueSeconds`). A skipped turn is recorded as a clue with `text: null`.
3. **Discussion** (`phase: "discuss"`, only if `discussion` is on, default on): talk it over in the room.
   Nobody is active; the host sends `startVote` (or the `discussSeconds` timer fires).
   If `discussion` is off, the game goes straight from the last clue to voting.
4. **Vote** (`phase: "vote"`): every player (imposters included) votes for one **other** player among the
   ballot's candidates (`{ type: "vote", target }`). Votes are secret until the reveal; only "has voted"
   is public. A vote is final (cannot be changed). When everyone has voted the ballot closes. The host may
   close it early (`closeVote`) and the `voteSeconds` timer closes it too; missing votes are abstentions.
5. **Resolve the ballot**: count votes per candidate.
   - Highest count is 0 (nobody voted): nobody is accused.
   - One player has the highest count: they are **accused**.
   - Several share the highest count: apply `tieRule` (see 3.4).
   - If the accused is an imposter, the imposters are **caught**. Otherwise (wrong player, or nobody
     accused) the imposters **escape**.
6. **Last-chance guess** (`phase: "guess"`, only if caught and `lastChanceGuess` is on, default on): the
   caught imposter (the accused) gets exactly one guess at the word (`{ type: "guess", text }`). Correct =
   the imposters **steal** the round. Wrong, skipped by the host (`skipGuess`) or timed out
   (`guessSeconds`) = the crew wins. The host's skip counts as "no guess" (wrong): in the round result
   that is `guess: null, guessCorrect: false`; when there was no guess phase at all it is
   `guess: null, guessCorrect: null`.
7. **Reveal** (`phase: "reveal"`): the word, category, every imposter, every ballot's vote counts (and
   who voted for whom if `revealVotes`), the guess and the points are public. Points are added (section 4).
   The host sends `nextRound`. After the last round, `nextRound` ends the game (`phase: "over"`).

Outcome per round is a team result: `winner: "crew"` (caught, and no correct steal) or
`winner: "imposters"` with `how: "escaped"` or `how: "stole"`.

## 2. Actions

| action | who | when |
|---|---|---|
| `{ type: "clue", text: string }` | the current clue-giver | `clue` phase |
| `{ type: "vote", target: PlayerId }` | any player who has not voted in this ballot | `vote` phase; `target` is a candidate and not the voter |
| `{ type: "guess", text: string }` | the accused imposter only | `guess` phase |
| `{ type: "skipClue" }` | host only | `clue` phase (skips the current giver, even if the host is the giver) |
| `{ type: "startVote" }` | host only | `discuss` phase |
| `{ type: "closeVote" }` | host only | `vote` phase |
| `{ type: "skipGuess" }` | host only | `guess` phase |
| `{ type: "nextRound" }` | host only | `reveal` phase |
| `{ type: "@timeout" }` | engine | when `deadline` passes (only set when the matching timer setting is > 0) |

`legalActions` templates: clue is `{ type: "clue", text: FREE_TEXT }`; votes are one concrete entry per
allowed target; guess is `{ type: "guess", text: FREE_TEXT }` in `guessMode: "text"` and one concrete
entry per option (`text` = the option string, exact) in `guessMode: "choice"`. Host actions appear only
when `actor.isHost`. Unknown ids get `[]`. Nobody has actions in `over`.

### 2.1 Clue validation (in `reduce`, error messages are shown to the player)

The clue text is trimmed and inner whitespace collapsed to single spaces, and stored like that.
"Normalized" below means: Unicode NFD, accents removed, lowercase, every character outside `a–z0–9`
removed.

- Empty, or normalized to an empty string: rejected ("Type a clue").
- Longer than `CLUE_MAX_LENGTH` (30) characters after trimming: rejected.
- `oneWordClues` on (default): containing a space after trimming: rejected ("One word only"). Hyphens and
  apostrophes are fine.
- `uniqueClues` on (default): normalized equal to an earlier clue of the same round: rejected.
- `blockSecretWord` on (default), **crew only**: normalized clue contains the normalized word (e.g. word
  `Pizza`, clue `pizzas` or `PIZZA!`): rejected ("Don't say the secret word!"). If the normalized word
  is shorter than 3 characters (possible with custom words), only an exact normalized match is rejected.
  Imposters are never
  rejected by this check (a rejection would tell them the word); an imposter whose clue happens to
  contain the word is accepted.

### 2.2 Guess check

`guessMode: "choice"` (default): the options are `GUESS_CHOICES` (8) distinct words of the round's
category, always including the word, shuffled with the rng and stored in state when the guess phase
starts (fewer if the category has fewer words, e.g. a small custom list: then all of them). Options are
public during the guess phase.

`guessMode: "text"`: free text, trimmed, 1–`GUESS_MAX_LENGTH` (40) characters. Correct when the
normalized guess equals the normalized word, or they differ only by a trailing `s` or `es` on one side
(`Tiger` = `tigers` = ` TIGER `).

## 3. House rules (settings) and their defaults

| key | type | default | effect |
|---|---|---|---|
| `rounds` | number 1–20 | 5 | rounds per game |
| `imposterCount` | select `auto`/`1`/`2`/`3` | `auto` | `auto` = 1 imposter for 4–7 players, 2 for 8–12 |
| `impostersKnow` | boolean | false | with 2+ imposters, imposters see each other (`fellowImposters`) |
| `imposterHint` | select `category`/`nothing` | `category` | what an imposter sees instead of the word |
| `imposterPick` | select `random`/`fair` | `random` | `fair` = players who have been imposter least often are picked first (ties random) |
| `categories` | multiselect (min 1) | all 10 built-in | word pool; option `custom` adds the `customWords` list as a category |
| `customWords` | text (max 1000) | `""` | comma- or newline-separated custom words (used only if `custom` is selected) |
| `clueRounds` | number 1–3 | 2 | passes through the clue order per round |
| `firstClue` | select `rotate`/`random` | `rotate` | `rotate`: round r starts at seat `(r-1) mod n`; `random`: random seat each round |
| `oneWordClues` | boolean | true | clues must be one word |
| `uniqueClues` | boolean | true | no repeating a clue already given this round |
| `blockSecretWord` | boolean | true | crew can't type the secret word as (part of) a clue |
| `discussion` | boolean | true | a host-ended discussion phase between clues and voting |
| `tieRule` | select `revote`/`escape`/`random` | `revote` | see 3.4 |
| `revealVotes` | boolean | true | reveal shows who voted for whom (otherwise counts only) |
| `lastChanceGuess` | boolean | true | a caught imposter gets one guess to steal the round |
| `guessMode` | select `choice`/`text` | `choice` | pick from 8 options or type the word |
| `crewWinPoints` | number 0–10 | 1 | each crew member when the crew wins |
| `correctVoteBonus` | number 0–5 | 0 | each crew member whose final-ballot vote was for an imposter (any outcome) |
| `imposterEscapePoints` | number 0–10 | 2 | each imposter when the imposters escape |
| `imposterStealPoints` | number 0–10 | 2 | each imposter when the caught imposter guesses the word |
| `clueSeconds` | number 0–120 step 5 | 0 (off) | per clue turn; on timeout the giver is skipped |
| `discussSeconds` | number 0–300 step 15 | 0 (off) | discussion length; on timeout voting starts |
| `voteSeconds` | number 0–180 step 5 | 0 (off) | voting length; on timeout the ballot closes (missing = abstain) |
| `guessSeconds` | number 0–120 step 5 | 0 (off) | guess time; on timeout the guess is wrong |

`validateSettings` blocks the start when:
- the resolved imposter count `k` gives `2k >= players` ("Too many imposters for N players"); so 2 needs
  5+ players and 3 needs 7+.
- `categories` includes `custom` but `customWords` has fewer than `CUSTOM_MIN_WORDS` (3) valid words.

### 3.1 Imposters
`k` imposters per round (see `imposterCount`). `random`: `k` distinct players chosen uniformly by the rng.
`fair`: players shuffled by the rng, then stably sorted by how many times they have been imposter so far,
take the first `k`. Imposters do not know each other unless `impostersKnow`.

### 3.2 Clue order
Seat order starting at the round's first clue-giver. Every clue pass uses the same order. Turn index
`turn` runs 0 .. `n*clueRounds - 1`; giver = `clueOrder[turn % n]`, clue round = `floor(turn / n) + 1`.

### 3.3 Words
Pool = all words of the selected categories (custom words parsed: split on commas/newlines, trimmed,
inner whitespace collapsed, empty and >30-char entries dropped, deduplicated by normalized form, max 100).
A category is picked uniformly among selected categories that still have unused words, then a word of it
uniformly. A word is not repeated within a game; if every word has been used the used-list resets, and
the previous round's word is still excluded for that pick when any other word exists (only a tiny custom
pool can run out: built-in categories have 240 words and at most 20 rounds).

### 3.4 Ties (`tieRule`)
- `revote` (default): if the first ballot ties, a second ballot is held among the tied players only
  (everyone votes, nobody for themselves; same timer, same host close). If the second ballot ties too, or
  nobody votes in it, nobody is accused (imposters escape).
- `escape`: a tie means nobody is accused.
- `random`: one of the tied players is accused at random (rng).

A ballot where nobody voted (all abstained) never triggers a revote: nobody is accused.

## 4. Scoring

At the end of each round (when entering `reveal`):
- crew wins: every non-imposter +`crewWinPoints`.
- imposters escape: every imposter +`imposterEscapePoints`.
- imposters steal: every imposter +`imposterStealPoints`.
- plus, any outcome: every non-imposter whose vote in the **last** ballot of the round was for an
  imposter +`correctVoteBonus`.

Scores start at 0. `scores()` = `rankScores(totals)` (higher is better, ties share a rank). The game is
over (`isOver`) only after the host's `nextRound` in the last round's reveal. Highest total wins.

Example (defaults, 4 players, p2 imposter): p0→p2, p1→p2, p2→p0, p3→p1. p2 accused, caught, guesses
wrong: p0, p1, p3 +1 each, p2 +0. If p2 guessed right: p2 +2, others +0. If p0 had been accused: p2 +2.

## 5. Hidden information (viewFor / legalActions)

`View` fields are in `types.ts`. Rules:
- **The word**: in `view.word` only for crew members, and for everyone (inside `view.result`) once the
  round is in `reveal`/`over`. An imposter's view and the spectator view never contain the word before
  the reveal, except as one of the public `guessOptions` during the guess phase in `choice` mode.
- **The category**: crew always; imposters only if `imposterHint: "category"`; spectators only if
  `imposterHint: "category"` (it is then known to every player anyway).
- **Roles**: `view.role` is the viewer's own role (`"crew"`/`"imposter"`, `null` for spectators). Nothing
  in a crew or spectator view tells who the imposters are until the reveal, except that during `guess`
  the accused is public and known to be an imposter (`view.accused`, `view.accusedIsImposter`). Other
  imposters of the round stay hidden until the reveal. `fellowImposters` is non-empty only for an imposter
  with `impostersKnow` on and 2+ imposters.
- **Votes**: during voting only `view.voted[id]` (boolean) and the viewer's own `myVote`. After a ballot
  closes, its counts become public (`view.closedBallots` during a revote). Who voted for whom appears only
  in `view.result.ballots[i].votes` at the reveal, and only if `revealVotes`; otherwise `votes: null`
  (state history stores `null` too).
- `legalActions` has the same shape for crew and imposters (both get the clue template, both get votes).
- The settings in the view (`view.rules`) omit `customWords`. Note: custom words are visible in the
  lobby's house rules to everyone, so with `custom` the imposter knows the candidate list (like a
  category). That's by design.
- `history` (past rounds' `RoundResult`s) is public.
- Scores only change when a round resolves, so they don't reveal roles early.

`activePlayers`: `clue` → `[current giver]`; `discuss` → `[]`; `vote` → players who haven't voted in the
current ballot; `guess` → `[accused]`; `reveal`/`over` → `[]`.

`deadline(state)` = `state.deadline` (epoch ms, computed from `ctx.now` on entering a timed phase or
clue turn; `null` when the timer setting is 0 or the phase has no timer). `@timeout` in a phase without
a matching timer is a no-op.

## 6. Bots

`botAction` sees only the bot's view:
- clue: a generic one-word clue from a built-in list (e.g. `tasty`, `outdoors`), never one already said
  this round, and (for crew bots) never one containing the word. Fallback `hintN`.
- vote: a random legal vote.
- guess: `choice` → a random option; `text` → one of the round's clues (or `pass`).
Bots finish every game at 4–12 players under every setting combination (verified with `simulateGame`).

## 7. UI plan (360–430px portrait, `GameScreen`)

- **top**: `PlayerStrip` with score as `sub`; badge `💬` for the current clue-giver, `✓`/`…` for voted
  during votes, `🕵️` on imposters at the reveal.
- **board** (`TableArea`, label "Round r of R · Clues c/C"):
  - Role: `<HoldToReveal label="Hold to see your word">` with `<RoleCard>`: crew → emoji 🧑‍🚀 title = word,
    subtitle = category; imposter → 🕵️ "You're the Imposter", subtitle = "Category: X" or "No hint. Blend
    in!" (plus fellow imposters if any). Never rendered un-held. Always available during a round.
  - Clue log grouped by clue pass: `Name: clue` (skipped = "skipped"), newest last, auto-scroll.
  - Vote phase: tied-ballot banner with first-ballot counts during a revote.
  - Guess phase: `BigStatus` "Name was the Imposter! Last chance…".
  - Reveal: `BigStatus` "Crew wins" / "Imposter escaped" / "Imposter stole it", the word and category,
    imposters, vote counts (who voted whom if public), points this round.
- **bottom**: `TurnIndicator` (+ `Countdown` when `deadline`), then by phase:
  - clue + my turn: `<TextEntry maxLength={30} submitLabel="Give clue">`.
  - vote: `<ChoiceList>` of candidates (Avatar icons) + primary `Vote` button; after voting "Waiting…".
  - guess (accused): `ChoiceList` of `guessOptions` + `Guess` button, or `TextEntry` in text mode.
  - host `ActionBar`: Skip (clue), Start vote (discuss), Close vote (vote), Skip guess (guess),
    Next round / Finish (reveal). Primary buttons disabled while `pending`.
- Spectators (`me === null`): public board only, no HoldToReveal role, no controls.

## 8. Notes for the test agent

- State fields you will need (see `State` in `types.ts`): `word`, `category`, `imposters`, `clueOrder`,
  `turn`, `clues`, `ballots` (open one last, `votes[id] = target | null`), `closedBallots`, `accused`,
  `guessOptions`, `deadline`, `scores`, `history`. Use `h.setState` to craft positions.
- Default seed behaviour: with `firstClue: "rotate"`, round 1's clue order starts at `p0`, round 2 at `p1`.
- Leak checks: `findLeaks(view, [state.word])` must be empty for imposters and spectators in every phase
  before `reveal`, except the guess phase in `choice` mode (options include the word by design). In
  `imposterHint: "nothing"`, the same holds for `state.category`, but check it on the view **without
  `history`**: categories repeat across rounds, so a past round's (public) category can equal the
  current one. Likewise with a tiny custom pool words can repeat across rounds (exclude `history`).
  Word lists are built so that no word is a substring of another word, a category label, a view key or a
  bot clue, so substring false positives can't happen with built-in words.
- Player ids appear everywhere (order, clues), so role leaks are checked structurally: before the reveal,
  a crew/spectator view has `result: null`, `fellowImposters: []`, `accused: null` (except in `guess`),
  `role` = own role, and no `votes` object outside `history` (`closedBallots[i].votes` is always `null`).
- Exported pure helpers in `rules.ts` you may use: `normalize`, `guessMatches`, `parseCustomWords`,
  `resolveImposterCount`, `BOT_CLUES`.
