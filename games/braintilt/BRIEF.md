# Brain Tilt — game brief

`games/braintilt` · id `braintilt` · category `party` · 2–12 players · `meta.orientation: "any"`

An original forehead-guessing party game. One player (the **guesser**) holds their phone sideways on their
forehead, screen facing the room. A word appears on it. Everyone else describes or acts it out (without
saying it). The guesser tilts the phone **down** when they get it ("Got it!", scores) or **up** to **pass**.
A round lasts a fixed time. Then the turn moves to the next guesser.

All names, words and wording are original. Never use another product's name, host, studio or deck names.

---

## 1. Turn flow

Phases: `ready` → `countdown` → `playing` → (`ready` for the next guesser … ) → `over`.

1. **Setup.** `turnOrder` (the list of guessers, one entry per turn) is computed once (see §3). `turn = 0`,
   phase `ready`, all points 0, no words drawn yet.
2. **`ready`.** The game waits for the current guesser (`turnOrder[turn]`).
   - Guesser: `{ type: "start" }` or `{ type: "skipTurn" }` (pass their own turn).
   - Host (if not the guesser): `{ type: "skipTurn" }` (for an absent or slow guesser).
   - Everyone else: nothing.
   - The previous round's summary (`lastRound`) stays visible on this screen.
3. **`start`.** The round's card stack is drawn: `min(cardsPerRound, pool size)` words from the chosen decks
   (§4), stored secretly. `startsAt = now + getReadySeconds*1000`.
   - If `getReadySeconds > 0`: phase `countdown`, deadline `startsAt`, no word shown to anyone, no legal actions.
     The `@timeout` moves to `playing`.
   - If `getReadySeconds = 0`: straight to `playing`.
4. **`playing`** begins: the first card of the stack becomes the current word (`wordNo = 1`),
   `endsAt = max(startsAt, now) + roundSeconds*1000`, deadline `endsAt`.
   - Guesser only: `{ type: "mark", result: "correct", wordNo }` and `{ type: "mark", result: "pass", wordNo }`,
     where `wordNo` is the current word's 1-based number in this round. A mark with a stale `wordNo` (a double
     tilt) is rejected by the engine as illegal.
   - A mark records `{ word, result }` in `roundWords` and reveals the next card (`wordNo + 1`).
   - Nobody else (including the host) has legal actions while playing.
5. **Round end** happens on the first of:
   - **time:** `@timeout` at `endsAt`. The word on screen at that moment is recorded with result `"timeout"`
     (scores nothing, costs nothing).
   - **time, late mark:** a `mark` applied with `ctx.now >= endsAt` (timer already expired, server timeout not yet
     fired) ends the round exactly like the timeout; that mark is ignored and the word is recorded as `"timeout"`.
   - **cards:** the guesser marked the last card of the stack. No `"timeout"` entry.
   - **skip:** `skipTurn` in `ready`. Round recorded with no words and 0 points.
6. On round end: round points are added (§5), a `RoundRecord` becomes `lastRound`, its summary is appended to
   `history`, the unseen rest of the stack is discarded, `turn += 1`. If `turn === turnOrder.length` the phase
   is `over` (no extra host tap), otherwise `ready` for the next guesser.

`activePlayers`: `[guesser]` in `ready`, `countdown` and `playing`; `[]` when `over`.
`deadline`: `startsAt` in `countdown`, `endsAt` in `playing`, otherwise `null`.
`isOver`: phase `over`.

## 2. House rules (settings)

| key | type | default | range / options | effect |
|---|---|---|---|---|
| `roundSeconds` | number | **60** | 30–180, step 15 | length of each guessing round |
| `getReadySeconds` | number | **3** | 0–10 | "get ready" countdown after Start (0 = start instantly, no `countdown` phase) |
| `turnsEach` | number | **1** | 1–3 | how many times each player guesses (teams: see §3) |
| `decks` | multiselect | **all 8** | `animals`, `food`, `home`, `characters`, `sports`, `places`, `actions`, `nature` (min 1) | word pool |
| `cardsPerRound` | number | **30** | 10–50, step 5 | size of a round's card stack; the round ends early if all are marked |
| `othersSeeWord` | boolean | **true** | | non-guessers' phones show the current word (so describers can read it) |
| `guesserScreen` | select | **`forehead`** | `forehead` (guesser's phone shows the word, facing out), `hidden` (guesser's phone never shows the word; others read it on their own phones) |
| `passCostsPoint` | boolean | **false** | | each pass costs the guesser 1 point (round and total scores may go negative) |
| `scoring` | select | **`solo`** | `solo`, `teams` | who collects the points |
| `teamCount` | number | **2** | 2–4 (shown only for teams) | number of teams |

`validateSettings` blocks the start with a message when:
- `scoring = "teams"` and players < `2 × teamCount` ("Teams need at least 2 players each…").
- `guesserScreen = "hidden"` and `othersSeeWord = false` (nobody could see the word).

Deck labels (public, exported from `types.ts` as `DECKS`): Animal Kingdom, Snack Attack, Around the House,
Heroes & Helpers, Game On, Places to Go, Act It Out, Sky & Wild. Each has exactly 40 unique, family-friendly
words. Words are unique across all decks and no word is a (case-insensitive) substring of another word.
The word lists live in `games/braintilt/decks.ts`, imported only by `rules.ts` (never shipped to clients).

## 3. Turn order and teams

- **Solo:** `turnOrder` = seat order, repeated `turnsEach` times. Seat 0 guesses first.
  Total turns = `players × turnsEach`.
- **Teams:** team of a player = `seat % teamCount` (team 0, 1, …), members in seat order. Teams take turns
  alternately (team 0, team 1, …, team 0, …); within a team, members rotate. Each team gets
  `turnsEach × (size of the largest team)` turns, so all teams guess equally often (members of a smaller team guess
  more often). `turnOrder[k*teamCount + t] = teams[t][k % teams[t].length]`.
  Total turns = `teamCount × turnsEach × largestTeam`.

## 4. Drawing words

- Pool = all words of the selected decks (deck order, then word order).
- `used` = words already shown this cycle (a word becomes "used" when it is put on screen, not when drawn).
- On `start`: if at least `cardsPerRound` pool words are unused, the stack is a random (ctx.rng) selection of
  unused words. Otherwise the stack is all unused words (shuffled) followed by already-used words (shuffled),
  preferring words that were not in the previous round (`lastRound`), truncated to `cardsPerRound`, and a new
  cycle starts (`used` reset). So a word repeats only after the whole pool was shown, and never in two
  consecutive rounds unless the pool is too small.
- If the pool is smaller than `cardsPerRound`, the stack is the whole pool.

## 5. Scoring

- Round points = `correct` − (`passCostsPoint` ? `passed` : 0). `"timeout"` words count for nothing.
- **Solo:** round points go to the guesser. `scores()` = `rankScores(points)`.
- **Teams:** round points go to the guesser's team (`teamPoints[team]`) and are also tracked on the guesser
  (`points`, for display). `scores()` gives **every player their team's total**, ranked with `rankScores`, so
  teammates share a rank.
- A skipped turn scores 0.
- Ties share a rank (competition ranking 1, 1, 3).

## 6. Hidden information (`viewFor`)

Secret: the stack (every upcoming word of the round), the deck word lists and the `used` list.
`viewFor` never contains any word of `state.stack`, in any phase, for any viewer (players or spectator).
The legal actions never contain a word.

The **current word** (`view.word`) is visible only during `playing`, and only to:
- the guesser, when `guesserScreen = "forehead"` (it is the forehead display);
- every non-guesser seated player, when `othersSeeWord = true`.
It is `null` for: everyone in `ready`/`countdown`/`over`; the guesser when `guesserScreen = "hidden"`;
non-guessers when `othersSeeWord = false`; **spectators always** (a late-joining device could be the guesser's own).

Public (all viewers incl. spectators): phase, settings, turn/total turns, `turnOrder`, guesser, teams,
`wordNo`, `cardsLeft` (count of upcoming words), the words already resolved this round (`roundWords`),
`startsAt`/`endsAt`, `lastRound` (previous round incl. its words), `history` (summaries without words), points.

Roles in the view (`view.role`): `"guesser"`; `"describer"` (solo: everyone else; teams: the guesser's
teammates); `"watcher"` (teams: the other teams; they may also see the word to referee); `"spectator"`
(viewer `null`); `"none"` when the game is over.

## 7. Bots

`botAction`: in `ready` a bot guesser always `start`s (never skips). In `playing` it marks `correct` with
probability 0.6, else `pass`. Rounds end when its stack runs out or by the timer (the countdown phase is always
ended by `@timeout`). Bots never act as host. `simulateGame` finishes for 2, 6 and 12 players.

## 8. UI plan (for `ui.tsx`)

General: `GameScreen` with `PlayerStrip` (points or team totals as `sub`, a badge on the guesser) on top.
Colour never alone: green + "✓ Got it", orange + "↷ Pass". Tap targets ≥ 44px (the forehead buttons are much
bigger). The shell handles wake lock, "your turn" haptic, results sheet. `me === null` → public view only.

- **ready, guesser:** "Your turn to guess!" + hint "Hold your phone sideways on your forehead, screen facing your
  friends. Tilt down = Got it, tilt up = Pass." Primary `Button size="lg"` **Start**: its `onClick` first calls
  `useDeviceTilt().request()` (iOS needs the tap gesture; ignore the result, buttons stay as fallback), then
  `act({ type: "start" })`. Secondary "Skip my turn". Above: last round summary.
- **ready, others:** "Waiting for {name} to start…", `lastRound` summary (correct words ✓, passed ↷,
  time-up ⏱), team/score table. Host additionally gets "Skip {name}'s turn".
- **countdown, guesser:** full-screen "Get ready…" with `<Countdown deadline={deadline} />`, and if the phone is
  in portrait (`useOrientation`) a "Turn your phone sideways" hint. Others: "{name} is getting ready".
- **playing, guesser, `forehead`:** full-screen landscape forehead card (fixed overlay class `.g-braintilt-…`):
  the word as huge auto-fit text (high contrast, readable from across the room), `Countdown` in a corner, live
  ✓/↷ counts. Tilt: when `permission === "granted"` and readings exist, compute
  `up = cos(beta°) * cos(gamma°)` (vertical component of the screen normal; ≈ 0 on the forehead; independent of
  landscape left/right). `up < -0.5` (screen faces the floor) → **correct**; `up > 0.5` (faces the ceiling) →
  **pass**; re-arm only after `|up| < 0.3`; ignore tilts for ~700 ms after each mark. Send exactly the legal
  `mark` entry for that result (`legalOfType(legal, "mark")`, includes `wordNo`). On success flash the screen
  green "✓ GOT IT!" or orange "↷ PASS" for ~600 ms (`haptic("success")` / `haptic("tap")`). Fallback: two big
  tap zones / buttons always present (left "↷ Pass", right "✓ Got it", each ≥ 44px, disabled while `pending`)
  for desktop, denied permission or no sensor. If held in portrait, show "Turn your phone sideways".
- **playing, guesser, `hidden`:** no word; "Your friends see the word — listen!" + the same two buttons + timer.
- **playing, describer / watcher:** portrait card with the current word (if `view.word`), "Describe it — don't
  say it!" (watcher: "{team} is guessing"), timer, live counts and the words resolved so far. No upcoming words
  exist on the client. No controls.
- **spectator:** timer and counts only.
- **over:** final standings (team totals in team mode) and the last round's summary.

`meta.orientation` is `"any"`: lobby/summary screens are portrait; only the forehead screen asks for landscape
inside the game UI.
