# Color Clash — game brief (`colorclash`)

An original colour-matching shedding game for 2–10 players. Category `cards`. Original names only:
the special cards are **Freeze**, **Flip**, **+2**, **Rainbow** and **Rainbow +4**, and the last-card call is **"Clash!"**.

This brief is the spec the rules, tests and UI are built against. Types live in `types.ts`; pure card
helpers (ids, parsing, points, sorting) live in `cards.ts` (safe for UI and tests to import). Never import `rules.ts` from the UI.

---

## 1. Cards

### Colours (ids, not hex)
| id | name | symbol | suggested colour (UI decides, colour-blind safe, Okabe–Ito) |
|---|---|---|---|
| `sun` | Sun | ● (circle) | orange `#E69F00` |
| `sky` | Sky | ■ (square) | blue `#0072B2` |
| `leaf` | Leaf | ▲ (triangle) | bluish green `#009E73` |
| `berry` | Berry | ◆ (diamond) | reddish purple `#CC79A7` |

Colour is never the only cue: every coloured card shows its colour's symbol. Order for sorting: sun, sky, leaf, berry, then wilds.

### Values
`"0"`…`"9"`, `"freeze"`, `"flip"`, `"plus2"` (coloured) and `"rainbow"`, `"rainbow4"` (wild, colour part `wild`).

### Card ids
Every physical card has a unique string id `"<colour>:<value>:<copy>"`, e.g. `"sun:5:1"`, `"sun:5:2"`, `"berry:plus2:1"`,
`"wild:rainbow:3"`, `"wild:rainbow4:1"`. `copy` is 1-based, a single digit, numbered across all decks in use. No id is a
substring of another id. The "face" of a card is `"<colour>:<value>"` (e.g. `"sun:5"`); logs only use colour/value, never ids.

### One deck (108 cards)
Per colour (25 × 4 = 100): one `0`; two each of `1`–`9`; two `freeze`, two `flip`, two `plus2`.
Plus 4 `rainbow` and 4 `rainbow4`. Two decks = 216 cards (copies 1..2 for `0`, 1..4 for others, 1..8 for wilds).

### Points (for the points scoring mode)
Number cards = face value (0–9); `freeze`, `flip`, `plus2` = 20; `rainbow`, `rainbow4` = 50.

---

## 2. Settings (house rules) — keys and defaults

| key | type | default | meaning |
|---|---|---|---|
| `scoring` | select `points` \| `single` | `points` | `points`: rounds until someone reaches `targetScore`. `single`: one round, first out wins. |
| `targetScore` | number 100–1000 step 50 | 500 | points mode only (visibleIf scoring=points) |
| `handSize` | number 5–10 | 7 | cards dealt to each player |
| `decks` | select `auto` \| `1` \| `2` | `auto` | `auto` = 1 deck for 2–6 players, 2 decks for 7–10 |
| `drawRule` | select `one` \| `untilPlayable` | `one` | `one`: draw 1, may play it if playable. `untilPlayable`: keep drawing until a playable card (or the piles run out), may play that one |
| `mustPlay` | boolean | false | if true you may not draw while you hold a playable card, and must play a playable drawn card |
| `stacking` | select `off` \| `same` \| `any` | `off` | `same`: +2 on +2, Rainbow +4 on Rainbow +4. `any`: also Rainbow +4 on +2. A +2 can never go on a Rainbow +4 |
| `wild4Rule` | select `challenge` \| `strict` \| `free` | `challenge` | `challenge`: Rainbow +4 may always be played, but is only *fair* when you hold no card of the colour in play; the victim may challenge. `strict`: only playable when you hold no card of the colour in play (no challenge). `free`: always playable, no challenge |
| `sevenZero` | boolean | false | 7 = swap hands with a player you choose; 0 = everyone passes their hand to the next player in the direction of play |
| `jumpIn` | boolean | false | anyone may play an *identical* card (same colour and value, not wild) out of turn |
| `twoPlayerFlip` | boolean | true | with exactly 2 players a Flip acts as a Freeze (you play again) |
| `clashRule` | select `penalty` \| `off` | `penalty` | `penalty`: forget to call Clash! and get caught = draw `clashPenalty`. `off`: no calling, no catching |
| `clashPenalty` | number 1–4 | 2 | visibleIf clashRule=penalty |
| `catchSeconds` | number 2–15 | 5 | how long an un-called player stays catchable (visibleIf clashRule=penalty) |

`validateSettings` blocks the start when `players × handSize + 20 > 108 × decks` (decks resolved from `auto`), with the
message `"Not enough cards: use 2 decks or deal fewer cards"`. (Only possible with `decks: "1"`.)

---

## 3. Setup (each round)

- `order` = players in seat order. Direction starts clockwise (`direction: 1`, i.e. order index +1).
- Build the deck(s), shuffle with the rng, deal `handSize` cards to each player (player i gets shuffled[i·h … (i+1)·h−1]);
  the rest is `drawPile` (**index 0 is the top**).
- Starting card: the first **number** card (0–9) from the top of the draw pile is removed and put on the discard pile;
  action and wild cards are never the starting card (they stay in the pile in place). `color` = that card's colour.
- First player of round r (1-based) is `order[(r − 1) mod n]`. So round 1 starts with seat 0 (p0).
- Totals start at 0. `phase` = `"play"`.

---

## 4. Turn structure

State `phase` is one of: `"play"`, `"drawn"`, `"respond"`, `"roundOver"`, `"over"`. `turn` is the player whose turn it is.

### Matching (phases play / drawn)
A card is playable when:
- coloured card: its colour equals the colour in play (`color`), **or** its value equals the top discard card's value
  (e.g. any `freeze` on a `freeze`, `sky:7` on `sun:7`). A coloured card never matches a wild on top by value.
- `rainbow`: always.
- `rainbow4`: always, except with `wild4Rule: "strict"` where you must hold no card of colour `color`.

### Phase `play` (turn player)
- `play` any playable card (see action shapes in §7).
- `draw`: legal if the piles can give a card (draw pile non-empty, or discard has more than its top card), and not
  (`mustPlay` and you hold a playable card).
  - `drawRule: "one"`: draw 1 card. If it is playable, go to phase `drawn` with `drawnCard` = it. Otherwise the turn ends.
  - `drawRule: "untilPlayable"`: draw one at a time until a playable card is drawn or nothing is left. If the last drawn card
    is playable → phase `drawn`; otherwise the turn ends.
- `pass`: legal only when you cannot draw (piles exhausted), and not (`mustPlay` and you hold a playable card).

### Phase `drawn` (turn player)
- `play` the drawn card only (other cards cannot be played).
- `pass` = keep it; the turn ends. Not legal if `mustPlay` and the drawn card is playable.

### Phase `respond` (turn player faces `pending` cards)
Entered when a draw penalty is waiting for the turn player: with `stacking` on after any +2 / Rainbow +4, or with
`wild4Rule: "challenge"` after a Rainbow +4 (even with stacking off).
- `play` a stacking card if `stacking` allows: on a `plus2` top: any `plus2` (`same`/`any`) or `rainbow4` (`any` only);
  on a `rainbow4` top: `rainbow4` (`same`/`any`). The new card adds its 2/4 to `pending` and passes it to the next player.
  Normal colour matching does not apply in this phase. The strict-mode restriction does not apply to stacking.
- `accept`: draw `pending` cards (as many as the piles allow); the turn passes to the next player; `pending` = 0.
- `challenge`: only when the top card is `rainbow4` and `wild4Rule` is `challenge`. See §5.

### Effects after a play (when the player still has cards)
- number / `rainbow`: next player's turn.
- `freeze`: the next player is skipped (logged as `skip`).
- `flip`: direction reverses, then the next player in the new direction plays. With 2 players and `twoPlayerFlip`, it acts as a
  Freeze instead (the same player plays again); with 2 players and `twoPlayerFlip: false` it only reverses direction.
- `plus2`: stacking off → the next player immediately draws 2 and is skipped. Stacking on → `pending += 2`, next player enters `respond`.
- `rainbow4`: stacking on, or `wild4Rule: "challenge"` → `pending += 4`, next player enters `respond`. Otherwise the next player
  immediately draws 4 and is skipped.
- `7` with `sevenZero`: after removing the 7, swap your whole hand with the chosen `target`'s hand.
- `0` with `sevenZero`: after removing the 0, every hand moves to the next player in the current direction.
- Wilds set `color` to the chosen colour; coloured cards set `color` to their own colour.

### Going out
Playing your last card ends the round **immediately**; no swap/rotate/skip/flip effect happens. Exception: if the last card is a
`plus2` / `rainbow4`, the next player (current direction) draws `pending + 2` / `pending + 4` before scoring (no stacking, no challenge).

### Empty piles
When a draw needs a card and the draw pile is empty, all discard cards except the top are shuffled (rng) into a new draw pile
(logged `reshuffle`). If both are exhausted, the draw just gives fewer cards (possibly none).

### Blocked round (stall breaker)
`idle` counts consecutive `pass`es made in phase `play` (i.e. when nobody could draw). Any play or any card drawn resets it.
When `idle` reaches the number of players, the round ends as **blocked**: the winner is the player with the fewest cards; ties
broken by lowest hand points, then by turn order starting from the player whose turn it would be.

### Host skip
Host-only `skipTurn`, legal in phases play/drawn/respond when the turn player is not the host (for AFK players). It does the
non-play outcome for them: in `play` → draw 1 card if possible (never played) and the turn passes (or a plain pass if the piles
are empty, counting toward `idle`); in `drawn` → pass; in `respond` → accept.

---

## 5. Rainbow +4 challenge (`wild4Rule: "challenge"`)

When a Rainbow +4 is played from phase `play` or `drawn`, the rules record (secretly) whether it was **unfair**: the player held,
apart from that card, at least one card whose colour equals the colour in play just before it. A Rainbow +4 stacked in
phase `respond` is always fair.

The victim (next player, phase `respond`) may `challenge`:
- **unfair (guilty)**: the Rainbow +4 player draws `pending` cards instead; `pending` = 0; the challenger then takes a normal turn
  (phase `play`, the chosen colour stays).
- **fair (innocent)**: the challenger draws `pending + 2` cards and loses the turn (next player plays).

The challenger does **not** get to see the other player's hand; only the verdict is public (log `challenge` with `guilty`).
The guilty flag is never in any view or legal list before the verdict.

---

## 6. Clash! (`clashRule: "penalty"`)

Phone-friendly design: a **Clash!** button for the player about to go down to one card, and a **Catch!** button for everyone else
for a short window.

- **Early call**: `clash` is legal for the turn player (phases play/drawn/respond) when they hold exactly **2** cards, haven't called
  yet this turn, and have at least one legal `play`. Sets `called = them` (public, logged `clash`). The call is cleared when the
  turn passes or any card is played.
- When a play leaves the player with exactly **1** card (checked after all effects; for a 7/0 swap it is the actor's final hand):
  - if they had called → safe;
  - otherwise they become **exposed**: `exposed[player] = now + catchSeconds·1000`.
- While exposed:
  - the exposed player may still `clash` (late call) at any time → no longer exposed, safe;
  - **any other seated player** (turn or not) may `{ type: "catch", target }` → target draws `clashPenalty` cards, no longer exposed.
    Turn order is unaffected.
  - exposure ends when the timer passes (`@timeout` via `deadline`), or the player's hand size stops being 1 (went out, drew, swapped).
- `deadline(state)` = earliest exposure time, or `null`. Several players may be exposed at once.
- Jump-in plays (§8) can expose a player too (there is no early call for out-of-turn plays; late call works).
- `clashRule: "off"`: no `clash`/`catch` actions ever, nobody is exposed, `deadline` is always null.

---

## 7. Actions (exact shapes)

```ts
{ type: "play", card }                  // number / action cards; 7 when it is your last card or sevenZero is off
{ type: "play", card, color }           // rainbow / rainbow4: one legal entry per colour (always, even as last card)
{ type: "play", card, target }          // 7 with sevenZero (not your last card): one entry per other player
{ type: "draw" } | { type: "pass" } | { type: "accept" } | { type: "challenge" }
{ type: "clash" } | { type: "catch", target }
{ type: "skipTurn" }                    // host only
{ type: "nextRound" }                   // host only, phase roundOver
{ type: "@timeout" }                    // engine only
```
Legal lists contain concrete entries only (no FREE_* placeholders). Non-turn players normally have `[]` except `catch`,
a late `clash`, jump-in plays, and the host's `skipTurn` / `nextRound`. Spectators / unknown ids always get `[]`.

---

## 8. Jump-in (`jumpIn: true`)

In phase `play` only (not `drawn`, not `respond`), any player who is **not** the turn player may `play` a card identical to the top
card (same colour **and** value; never wilds). It is resolved exactly like a normal play by that player (effects, swap targets, going
out, exposure), and play continues from them. The log entry has `jumpIn: true`.

---

## 9. Round end and scoring

- **points** mode: the round winner scores the sum of the card points left in every other hand (after any last-card +2/+4 draw).
  If their total ≥ `targetScore` the game is over (`phase: "over"`), else `phase: "roundOver"` and the host sends `nextRound`
  (new deal per §3, round + 1, direction reset, totals kept).
- **single** mode: the game is over when the first player goes out.
- `lastRound` = `{ winner, gained, blocked, handPoints }` (public, no card ids). During `roundOver`/`over` every hand is public in
  `revealedHands`.
- `scores(state)`: points mode → `rankScores(totals)` (higher better). single mode → `rankScores(cards in hand, false)` (fewest cards
  is rank 1; ties share a rank) — also used live mid-game.
- `isOver` ⇔ `phase === "over"`. `activePlayers` = `[turn]` in play/drawn/respond, `[]` in roundOver (waiting on host) and over.

---

## 10. Hidden information (viewFor)

Visible to everyone: top discard and the last ≤ 4 discard cards (`discardTop`, ids — they are face up on the table), `color`,
`direction`, `turn`, `phase`, `pending`, counts (`drawCount`, `discardCount`, `handCounts`), `called`, `exposed`, totals, settings,
`lastRound`, the public `log` (colour/value only, never ids), and `revealedHands` only in roundOver/over.

Only for me: `myHand`, and `drawnCard` (my drawn card while I am in phase `drawn`).

Never in any view: other hands (until roundOver/over), draw pile contents/order, the Rainbow +4 guilty flag, discard cards below
the shown 4. A spectator (`null`) sees the public part with `myHand: []`, `drawnCard: null`.

---

## 11. Bots (botAction, sees only its own view)

- Late `clash` if exposed. Pre-call `clash` with 2 cards about 85% of the time (so bots sometimes forget).
- Catch an exposed player (on its own turn ~70%, always when it is its only option).
- `respond`: stack if possible, else challenge ~25% (if legal), else accept.
- Turn: prefer a coloured card of the colour in play, then value matches, action cards when the next player is low, wilds last;
  wild colour = its most common colour in hand; 7-swap target = the opponent with the fewest cards. Avoids unfair Rainbow +4.
- `drawn` → play the drawn card if legal, else pass. Otherwise draw / pass.
- Out of turn the engine makes bots take an action if they have one (they can't decline), so bots always jump in / catch when able.

---

## 12. UI plan (360–430 px portrait, `<GameScreen>`)

- **top**: `PlayerStrip` with sub = card count (and total in points mode); badge `Clash!` for a safe 1-card player, `1!` for exposed;
  direction arrow (↻/↺).
- **board** (`TableArea`, label "Round r · colour in play"): draw pile (`CardBack` with `drawCount`, tap = draw when legal), discard
  pile (top card large, the previous ≤ 3 peeking behind), colour-in-play chip (symbol + name), pending badge ("+6 coming!"),
  a one-line event ticker from `log` ("Maya froze Ravi", "Ana caught Bo: +2").
  Round over: each player's revealed hand (small cards) + points, `lastRound` summary; host button "Next round".
- **custom card** (`ClashCard` in `ui.tsx`, CSS in `ui.css`, classes `.g-colorclash-*`, kit CSS variables for borders/shadows):
  colour fill from a colour id → CSS var map, big centre glyph (number, ⏸/❄ Freeze, ⇄ Flip, +2, rainbow ring, +4) and the colour
  symbol in the corners; wild cards use a four-segment ring showing all four symbols. Sizes match kit card sizes (xs/sm/md/lg).
  Text label via `aria-label` ("Sky 7", "Rainbow +4").
- **hand fan** (game-local `ClashHand`, mirrors kit `Hand` behaviour/CSS conventions since kit `Hand` only renders standard cards):
  overlapping, horizontally scrollable, every card ≥ 44 px visible, auto-sorted by colour then value with a sort toggle (reuse kit
  `usePrefs().handSort`: `suit` ↔ colour, `rank` ↔ value), playable cards highlighted, others dimmed, tap selects (lifts), tap again
  or **Play** confirms. In phase `drawn` only the drawn card is playable (highlight it).
- **colour picker**: after confirming a Rainbow / Rainbow +4, a `Sheet` with four ≥ 56 px buttons (colour + symbol + name);
  sends `{ play, card, color }`. **Target picker** for a 7-swap: `Sheet` + `ChoiceList` of players with card counts.
- **thumb zone `ActionBar`**: Play (primary), Draw / Keep (pass in `drawn`) / Pass, in `respond`: "Take +N" (accept), Challenge, and a
  stack hint. **Clash!** button (big, accent, pulses) whenever `clash` is legal — shown when you're about to play your second-to-last
  card. **Catch!** buttons (one per exposed target, name + `<Countdown deadline={exposed[id]}>`) for the short window.
  Host-only "Skip" (small, secondary) when the turn player is someone else.
- Spectators: public board, no hand, no controls. Haptics/turn glow are provided by the shell.
