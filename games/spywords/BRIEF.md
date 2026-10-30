# Spy Words — game brief

Game id `spywords`, category `party`, 4–12 players, portrait. An original team word-association game:
two teams race to find their secret words on a 5×5 board using one-word clues from their **Handler**.
All names here are original (teams **Sun ☀** and **Moon ☾**, roles **Handler** and **Agent**, the
**Trap** tile). Types live in `games/spywords/types.ts`; this brief is the source of truth for tests.

## 1. Setup

- **Teams.** Two teams, `"sun"` and `"moon"`. Default: by seat — even seats (0, 2, 4…) are Sun, odd seats
  are Moon. With `shuffleTeams` on, the seat order is shuffled with the setup RNG and then split the same way
  (alternating), so teams stay balanced. Either way Sun has `ceil(n/2)` players, Moon `floor(n/2)`.
  `state.members[team]` lists each team's players **in seat order**; `state.teams[playerId]` gives a player's team.
  Teams stay fixed for the whole match.
- **Handlers.** One Handler per team. At setup each team gets a random rotation offset
  `handlerOffset[team]` in `0..size-1`; in game `g` (1-based) the Handler is
  `members[team][(handlerOffset[team] + g - 1) % size]`. So the Handler rotates through the team in seat
  order each game. Everyone else on the team is an **Agent** (every team has ≥ 1 agent since n ≥ 4).
  Read who is Handler from `state.handlers` / `view.handlers` (public).
- **Starting team.** Game 1: random. Later games: setting `starter` — `"alternate"` (default, the other
  team from the previous game's starter) or `"random"`.
- **Board.** 25 distinct words drawn from `games/spywords/words.ts` (`WORDS`, ≥ 400 UPPERCASE, letters only,
  family-friendly). Words used in earlier games of the same match are not drawn again (while ≥ 25 unused remain).
  Tiles are indexed 0..24, row-major (row = `i / 5`, col = `i % 5`).
- **Key (secret).** `state.key[i]` is the tile's kind: the starting team owns **9** words, the other team **8**,
  **`trapCount`** tiles (default 1) are `"trap"`, the rest (`8 - trapCount`, default 7) are `"neutral"`.
  Positions are shuffled with the RNG. Nothing is revealed at start.
- **Phase** starts at `"clue"`, `turn = startingTeam`, `game = 1`, all scores 0.

## 2. Turn flow

Phases: `"clue"` → `"guess"` → (`"clue"` for the other team …) → `"gameEnd"` (between games) → … → `"over"`.

### Clue phase (`phase: "clue"`)
- Only the current team's Handler acts: `{ type: "clue", word, count }`
  (legal template `{ type: "clue", word: FREE_TEXT, count: FREE_NUMBER }`).
- `word` validation (in `reduce`, `GameError` on failure): trimmed and upper-cased; 1–24 characters;
  **letters only** (any alphabet, `/^\p{L}+$/u`: no spaces, digits, hyphens or apostrophes → "one word");
  must not equal (case-insensitive) any **unrevealed** board word. With `strictClues` (default **on**) it is also
  rejected if it contains, or is contained in, any unrevealed board word (e.g. board `SNOWMAN` blocks `SNOW`
  and `SNOWMANS`; board `CAR` blocks `CARPET`). Revealed words may be used freely. The stored clue word is the
  trimmed UPPERCASE form.
- `count` must be an integer from **1 to 9**; with `allowZero` on, **0** is also allowed and means
  *unlimited guesses*.
- After a valid clue: `phase = "guess"`, `guessesMade = 0`, `maxGuesses = count + 1` (with `extraGuess`, default
  on) or `count` (extraGuess off); count 0 ⇒ unlimited (`maxGuesses = 25`). A new `history` entry
  `{ team, clue: { word, count }, guesses: [], end: null }` is pushed.

### Guess phase (`phase: "guess"`)
- The current team's **Agents** (not the Handler, not the other team) guess.
  - `{ type: "guess", tile }` for any **unrevealed** tile index.
  - `{ type: "endTurn" }` only after the team has made at least one guess this turn (`guessesMade ≥ 1`).
- **`guessMode: "first"`** (default): any agent's action applies immediately (first tap counts).
- **`guessMode: "vote"`**: each action is a vote (`votes[agent] = tile` or `"end"`). Each agent may vote once per
  vote round (after voting their legal list is empty until the round resolves). As soon as one option has votes
  from **more than half** of the team's agents it is applied (as a guess or end turn) and votes clear. If every
  agent has voted and no option has a majority, votes clear and `noAgreement = true` (vote again). With one
  agent, the vote applies at once. `noAgreement` resets to false when an option is applied or the turn ends.
- **Resolving a guess** at tile `i`: `revealed[i] = true`, `guessesMade += 1`, `i` is appended to the current
  history entry's `guesses`. Then, by `key[i]`:
  - **trap** → the guessing team **loses** the game at once (other team wins, reason `"trap"`). Turn end `"trap"`.
  - **other team's word** → turn ends (`"opponent"`); if that was the other team's last word, the other team
    wins (reason `"words"`).
  - **neutral** → turn ends (`"neutral"`).
  - **own word** → if it was the team's last word, the team wins (reason `"words"`, turn end `"complete"`).
    Otherwise, if `guessesMade === maxGuesses` the turn ends (`"limit"`), else the team keeps guessing.
- `endTurn` (or a winning `"end"` vote) ends the turn with `"stop"`.
- **Turn end:** the history entry's `end` is set, `turn` flips, `phase = "clue"`, `clue = null`,
  `guessesMade = 0`, `maxGuesses = 0`, votes cleared.

### Host controls
- `{ type: "skipTurn" }` — host only, in `"clue"` and `"guess"` phases: ends the current team's turn (end `"skip"`).
  In the clue phase it pushes a history entry `{ team, clue: null, guesses: [], end: "skip" }`. It never reveals
  or picks a tile.
- `{ type: "nextGame" }` — host only, in `"gameEnd"`: starts the next game (new board and key, next Handlers,
  starter per `starter`, clue phase, `history` cleared).

### Timers (optional)
- `clueTimer` / `guessTimer` (seconds, 0 = off, default 0). When a clue phase starts the deadline is
  `now + clueTimer·1000`; when a guess phase starts, `now + guessTimer·1000` (a single deadline per phase, not
  per guess). `deadline(state)` returns it (null when off or not in a clue/guess phase).
- `@timeout` in the clue phase: turn passes with entry `{ team, clue: null, guesses: [], end: "timeout" }`.
  In the guess phase: turn ends with `"timeout"` (votes are discarded).

### Game end and match
- When a game ends: `results` gets `{ game, winner, reason }`, `wins[winner] += 1`, the current history entry
  gets its `end`, `deadlineAt = null`. Phase becomes `"gameEnd"` if `game < games`, else `"over"`.
- **Scores:** each player scores **1 point per game their team won**. `scores()` = `rankScores(points)` (higher
  is better; teammates always tie). `isOver` ⇔ `phase === "over"`.

## 3. House rules (settings)

| key | type | default | meaning |
|---|---|---|---|
| `games` | number 1–9 | 1 | Games in the match (Handlers rotate each game) |
| `shuffleTeams` | boolean | false | Random balanced teams instead of alternating seats |
| `starter` | select `alternate`/`random` | `alternate` | Who starts games 2+ (game 1 always random) |
| `guessMode` | select `first`/`vote` | `first` | First agent tap counts / team majority vote |
| `extraGuess` | boolean | true | Agents get clue number + 1 guesses (off: exactly the number) |
| `allowZero` | boolean | false | Allow clue number 0 = unlimited guesses |
| `strictClues` | boolean | true | Also block clues that contain / are part of a board word |
| `trapCount` | number 1–3 | 1 | Trap tiles on the board (neutral = 8 − traps) |
| `clueTimer` | number 0–300 step 15 | 0 | Seconds for the Handler's clue (0 = off) |
| `guessTimer` | number 0–300 step 15 | 0 | Seconds for the agents' guesses (0 = off) |

## 4. Hidden information (`viewFor`)

- **Secret:** `state.key` (the kind of every **unrevealed** tile) until the game ends.
- **Handlers** (both teams' Handlers) see `view.key` (all 25 kinds) during play.
- **Agents and spectators (`null`)** get `view.key === null` during `"clue"`/`"guess"`; `view.tiles[i].kind` is the
  kind only for revealed tiles, `null` otherwise. No count, list, history entry or legal action may reveal the
  kind of an unrevealed tile.
- In `"gameEnd"` and `"over"` the whole key is public: `view.key` is the full array for everyone (spectators too).
- Public: teams, members, handlers, turn, starting team, words, revealed tiles and their kinds, remaining counts
  per team, current clue, guesses made/left, the current vote tallies (who voted what), history, results, wins,
  settings.
- Leak check suggestion: `findLeaks(agentView, [JSON.stringify(state.key)])` must be empty, and
  `agentView.tiles.every(t => t.revealed || t.kind === null)`; same for `viewFor(state, null)`.

## 5. Legal actions summary

| phase | current Handler | current Agents | other team | host (extra) | spectator |
|---|---|---|---|---|---|
| clue | `clue` | — | — | `skipTurn` | — |
| guess | — | `guess` × unrevealed (+`endTurn` if ≥ 1 guess); vote mode: `[]` once voted this round | — | `skipTurn` | — |
| gameEnd | — | — | — | `nextGame` | — |
| over | — | — | — | — | — |

`activePlayers`: clue → `[current Handler]`; guess → current team's agents (vote mode: only those who have not
voted this round); gameEnd/over → `[]`.

## 6. Bots

- **Handler bot:** gives a simple clue word from a built-in list of everyday words that is valid against every
  board word under the strict check, with **count 1**.
- **Agent bot:** guesses a random unrevealed tile; after at least one guess this turn it ends the turn ~25% of
  the time. In vote mode it copies the leading teammate vote when there is one, otherwise votes as above.
- Bots never need the key; every game ends because each turn reveals ≥ 1 tile.

## 7. UI plan (360–430px portrait)

- `top`: compact **team strip** — two rows/pills: "☀ Sun 6 left" and "☾ Moon 5 left", the team whose turn it is
  highlighted (border + "▶ turn" text, not colour alone), Handler marked with a 🎙 badge; `PlayerStrip` with each
  player's team icon as `sub`, ✓ badge for voted (vote mode).
- `board`: 5×5 grid of word tiles: CSS grid `repeat(5, 1fr)`, gap 4px, fits a 328px content width
  (360 − 2×16px); each tile ≥ 44px tall (min-height 48px), `font-size` ~11–13px, uppercase, `word-break`/wrap,
  `hyphens: auto`, no horizontal scroll. Revealed tiles are filled with the kind's colour **plus an icon and
  pattern**: Sun ☀ + solid, Moon ☾ + diagonal stripes, neutral `·` + muted plain, trap ✖ + dark cross-hatch;
  the word stays readable (strikethrough-free, smaller). Handler view: unrevealed tiles show the key as a coloured
  border + corner icon (☀/☾/·/✖) and pattern; a "Key" switch (default on) hides it for privacy. Agents tap an
  unrevealed tile to select (lifts/outlined), tap again or "Guess" to confirm (vote mode: "Vote"). Tiles with
  teammates' votes show small vote count chips.
- Current clue banner above the grid: "CLUE · 2" with guesses left ("1 left" / "∞").
- `bottom`: `TurnIndicator` ("Your clue", "Your team is guessing", "Moon team's turn"), `Countdown` if a deadline;
  Handler in clue phase: `TextEntry` (16px font, one word, live hint from `clueProblem` in `shared.ts`) +
  `NumberPicker` 1–9 (0–9 with allowZero) + "Give clue" primary button; Agents in guess phase: "Guess" and
  "End turn" buttons; host: "Skip turn" (secondary) and "Next game" in gameEnd. Game end: `BigStatus` "☀ Sun wins!"
  (or "☾ Moon hit the trap") and the full key shown on the board for everyone.
- Turn log (history) in a collapsible list under the board.
