# Spy Words — rules notes

Original team word game (Codenames-style backlog item). Original names only: teams **Sun ☀ / Moon ☾**,
roles **Handler** (clue giver) and **Agent** (guessers), the **Trap** tile. Full spec: `BRIEF.md`.

Files: `types.ts` (public types/constants), `shared.ts` (pure clue validators, safe for the UI to import),
`words.ts` (538 board words + bot clue list; imported by `rules.ts` only, the UI never needs it),
`rules.ts` (plugin).

## Settings (house rules)

| key | type | default | effect |
|---|---|---|---|
| `games` | number 1–9 | 1 | Games per match; Handlers rotate each game; 1 point per game won |
| `shuffleTeams` | boolean | false | Off: even seats Sun, odd seats Moon. On: shuffled seats, then alternate (still balanced) |
| `starter` | select `alternate` / `random` | `alternate` | Starting team (9 words) for games 2+; game 1 is always random |
| `guessMode` | select `first` / `vote` | `first` | First agent tap applies / an option needs votes from > half the team's agents |
| `extraGuess` | boolean | true | Guesses per clue = number + 1 (off: = number) |
| `allowZero` | boolean | false | Clue number 0 allowed = unlimited guesses |
| `strictClues` | boolean | true | Also reject clues that start/end with an unrevealed board word or vice versa |
| `trapCount` | number 1–3 | 1 | Trap tiles; neutrals = 8 − traps |
| `clueTimer` | number 0–300 s, step 15 | 0 (off) | Clue-phase deadline; timeout passes the turn |
| `guessTimer` | number 0–300 s, step 15 | 0 (off) | Guess-phase deadline (whole turn, not per guess); timeout ends the turn |

## Rule decisions

- **Key split:** starting team 9, other team 8, traps `trapCount`, rest neutral (25 tiles).
- **Handler rotation:** random per-team offset at setup, then members in seat order: Handler of game g =
  `members[t][(offset + g − 1) % size]`. Random offset gives variety on the shell's "Play again".
- **Clue validity:** one word = letters only (`\p{L}`, any alphabet; no spaces, digits, hyphens, apostrophes),
  ≤ 24 chars, stored trimmed UPPERCASE. Never equal to an unrevealed board word (case-insensitive). Revealed words
  are fair game. Strict mode uses prefix/suffix matching (blocks compounds and word forms like SNOW/SNOWMAN,
  CAT/CATS) rather than any substring, so `SCARY` stays legal next to `CAR`.
- **Clue number:** integer 1–9 (0–9 with `allowZero`). No cap at the team's remaining words.
- **At least one guess** is required before agents may end the turn (both modes).
- **Revealing the rival's last word** makes the rival win (standard). **Trap** = immediate loss for the guessing
  team (no "penalty" variant).
- **Vote mode:** votes are locked once cast for the current round (an agent who voted has no legal actions).
  Majority = strictly more than half of the team's agents; applies immediately when reached. If every agent voted
  with no majority, votes clear and `noAgreement` is set (vote again). Locking votes keeps server bots from
  re-voting forever (the Convex bot driver acts for any bot that has a legal action). Votes are public.
- **Host skip** (`skipTurn`) in clue and guess phases ends the current team's turn without revealing anything;
  `nextGame` (host) between games. Bots are never host.
- **Timers** are per phase; `@timeout` in the clue phase passes the turn (history entry with `clue: null`,
  end `"timeout"`), in the guess phase ends the turn (pending votes discarded).
- **Key visibility:** both Handlers see the full key during play; agents and spectators only see revealed tiles.
  When a game ends (`gameEnd`/`over`) the whole key becomes public.
- **Scores:** 1 point per game won to every member of the winning team (`rankScores`, teammates tie).
- **Words:** later games of a match avoid words already used (538 words ≥ 9 × 25).
- **Bots:** Handler bot clues the first word from `BOT_CLUES` that is valid (strict check against all 25 board
  words) with number 1; agent bots guess randomly, ending the turn ~25% of the time after ≥ 1 guess; in vote mode
  they copy the leading teammate vote.
- **Privacy UI note:** the Handler's key needs to stay visible while thinking, so the UI plan uses a "Key"
  on/off switch (default on) instead of tap-and-hold for the key overlay.

## Self-check

`npx tsc --noEmit` clean. A temporary smoke test (deleted) ran `simulateGame` at 4, 5, 8 and 12 players × 5 seeds
with defaults and with all non-default settings (3 games, shuffled teams, random starter, vote mode, no bonus
guess, zero allowed, lenient clues, 3 traps, timers), plus a step-by-step bot game checking at every step that
agents/spectators get `key: null`, only revealed tile kinds, no `JSON.stringify(key)` in views or legal lists,
and Handlers get the key; plus clue validation, timeout, host skip, vote no-agreement and trap-loss checks.

## Engine requests

None.
