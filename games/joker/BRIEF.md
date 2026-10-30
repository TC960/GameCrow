# Joker — game brief (spec for rules, tests and UI)

Game id `joker`, category `cards`, 2–8 players, portrait. Old-Maid style: pairs are thrown out, you draw
blind from a neighbour, and whoever is left holding the Joker (the one card that can never pair) loses.

Source line (SPEC.md backlog): "Joker (draw blind from neighbour's hand, discard pairs, last holding the joker loses)".

Types live in `games/joker/types.ts` (`Settings`, `State`, `Action`, `View`, constants). Rules in `rules.ts`.

---

## 1. House rules (settings) and defaults

| key | type | default | options / range | effect |
|---|---|---|---|---|
| `deck` | select | `"joker"` | `"joker"` = 52 cards + 1 Joker (`"XR"`); `"queen"` = 52 cards minus the Queen of Clubs (`"QC"`), no Joker (classic Old Maid) | which card is the "loser" card |
| `matchColour` | boolean | `false` | | `true`: a pair must be same rank **and** same colour (♠♣ black, ♥♦ red). `false`: any two cards of the same rank pair |
| `drawFrom` | select | `"next"` | `"next"` = the next player clockwise who still holds cards; `"previous"` = the previous one (classic Old Maid: you draw from the player who just drew) | whose hand you draw from |
| `handOrder` | select | `"shuffle"` | `"shuffle"` = the server reshuffles hands after every draw (positions carry no information); `"arrange"` = before each draw the target holder may rearrange/shuffle their hand, then offers it | see §4 |
| `rounds` | number | `1` | 1–10, step 1 | number of deals |
| `scoring` | select | `"places"` | `"places"` = place points summed over rounds (higher better); `"losses"` = number of rounds you lost (lower better) | final ranking. Shown in the lobby only when `rounds` ≥ 2 (`visibleIf`), but it applies whatever `rounds` is |

There is no `validateSettings` problem for any combination (53 or 51 cards always deal to 2–8 players).

Constants exported from `types.ts`: `JOKER = "XR"`, `REMOVED_QUEEN = "QC"`.

With `deck: "queen"` and `matchColour: true` the loser card is always Q♠ (its colour partner is removed).
With `deck: "queen"` and `matchColour: false` three queens remain; one is left at the end, whichever it is.
The total card count is odd (53 or 51) in every mode, so exactly one card can never pair: exactly one loser each round.

## 2. Setup and each new round

- Seats `order` = players in seat order (seat 0 first). Round `r` (1-based) has a **starter** at seat `(r - 1) mod n`.
- Deck shuffled with `rng`, then dealt in full round-robin **starting with the starter** (`dealAll(deck, n, starterSeat)`):
  the first `total mod n` players from the starter onward get one extra card. Joker deck: 53 cards; queen deck: 51.
- **Initial discards (automatic):** every player throws out all pairs they hold (see §3 for what pairs). With 3 or 4 of a
  rank (rank mode) a player throws out 1 or 2 pairs and keeps the odd one. Each thrown pair is recorded publicly in `pairs`
  with `by` = that player. Then each remaining hand is shuffled with `rng` (`state.hands[id]` order is random).
- Anyone left with 0 cards after initial discards is **out (safe)** immediately; all of them share place 1.
- If, after initial discards, only one player still holds cards, the round ends at once (§6).
- First drawer `turn` = the starter, or if the starter has no cards, the next player clockwise who has cards.
  `target` = the drawer's neighbour per `drawFrom` among players who still hold cards (never the drawer).
- `step` = `"offer"` when `handOrder: "arrange"`, else `"draw"`.
- Phase `"play"`. `places` all `null` except players already out. `lastDraw` `null`.

## 3. Pairs

- Rank mode (`matchColour: false`): two cards pair iff same rank. Colour mode: same rank and same colour.
- The Joker never pairs. In the queen deck, queens are ordinary cards.
- Pairs are always discarded automatically (no manual discard action). After any action a hand never contains a pair.

## 4. A turn

Phase `"play"`. The drawer is `turn`; the hand being drawn from belongs to `target`.

1. **Offer step** (`handOrder: "arrange"` only; `step: "offer"`). The **target** is active and may:
   - `{ type: "move", card, to }`: move one of their own cards to position `to` (integer 0..handSize-1; other cards keep their
     relative order; non-integer or out-of-range `to` is rejected). Legal entries are one per card in their hand with
     `to: FREE_NUMBER`. Only when they hold ≥ 2 cards.
   - `{ type: "shuffle" }`: server reshuffles their hand with `rng`. Only when they hold ≥ 2 cards.
   - `{ type: "offer" }`: done arranging; `step` becomes `"draw"`. Always legal for the target in this step.
   Nobody else has a move in this step (except the host's skip, §7).
2. **Draw step** (`step: "draw"`). The **drawer** is active. Legal: `{ type: "draw", index }` for every
   `index` in `0..handCounts[target]-1`. `index` is a position in `state.hands[target]` (the target's own `myHand` order,
   left to right, not mirrored). The drawer never sees the cards, only the count.
   - The card at that position moves from the target to the drawer.
   - If it pairs with a card the drawer holds, both are discarded to `pairs` (`by` = drawer, `cards` = [the drawer's
     held card, the drawn card]). Otherwise it joins the drawer's hand.
   - `shuffle` mode: after the draw, the drawer's and the target's hands are each reshuffled with `rng`.
     `arrange` mode: the drawn card (if kept) is inserted at a random position (`rng`) of the drawer's hand; other order kept;
     the target's remaining cards keep their order.
   - Anyone (target and/or drawer) whose hand is now empty is out. Players going out on the same draw share a place:
     place = 1 + number of players already out before this draw.
   - `lastDraw` = `{ drawer, from, index, card, paired, out }` (in state; `card` is secret, see §8).
   - If at most one player still holds cards, the round ends (§6). Otherwise the turn passes **clockwise** to the next
     player after the drawer who holds cards (the drawer's turn always passes, even if they paired). New `target` per
     `drawFrom`. `step` = `"offer"` (arrange) or `"draw"` (shuffle).
   - `drawFrom: "next"`: turn order and target both go clockwise, so the target you drew from usually draws next.
     `drawFrom: "previous"`: you draw from the player before you, then the player after you draws from you.

There is no passing: a drawer must draw (or be skipped by the host).

## 5. Places

`places[id]`: `null` while holding cards; once out, the finishing place (1 = first out). The loser gets place `n`
(number of seated players). Ties share a place (competition: two players out together after one other are both 2nd,
next is 4th).

## 6. End of round, rounds and scores

When only one player still holds cards, that player is the **loser** of the round:
- `places[loser] = n`. Their remaining cards (always exactly 1 card: the Joker, or the odd queen) are moved out of
  `hands` into the top-level `loserCards` (so all `hands` are empty after a round ends; the card is public now).
  `loserCards` is non-empty only in phases `"roundOver"`/`"over"` and resets to `[]` on `nextRound` (so a past round's
  card string never appears in a view while that card sits in someone's hand). `RoundResult` has no card field.
- Round points: `n - place` for each player (loser 0; with 4 players and no ties: 3, 2, 1, 0).
- `points[id] += roundPoints[id]`; `losses[loser] += 1`; a `RoundResult` is appended to `results`.
- `turn`, `target` become `null`. Phase becomes `"over"` if `round === settings.rounds`, else `"roundOver"`.
- `"roundOver"`: only the host has a move, `{ type: "nextRound" }` (round + 1, fresh deal per §2; `pairs`, `places`,
  `lastDraw`, `loserCards` reset; `points`, `losses`, `results` kept).

`scores(state)` (public, live):
- `scoring: "places"`: totals = `points` (completed rounds) plus, during `"play"`, `n - place` for players already out in the
  current round (players still holding cards add 0). `rankScores(totals, true)`.
- `scoring: "losses"`: totals = `losses`; `rankScores(totals, false)` (fewest losses best; ties share rank).
`isOver` iff phase `"over"`. With `rounds: 1` the single-round loser is ranked last under both scorings.

## 7. Host

- `{ type: "nextRound" }`: host only, phase `"roundOver"` only.
- `{ type: "skipTurn" }`: host only, phase `"play"`, only when the active player is not the host (for a player who has
  gone away). Offer step: the hand is offered as it is (`step` → `"draw"`). Draw step: the drawer's turn passes without
  drawing (turn → next clockwise holder; target recomputed; step reset). Never changes any hand. Bots are never host.
- Nothing else is host-only. The host plays as a normal player otherwise.

## 8. Hidden information (viewFor)

A player may see: their own hand (`myHand`, in the real position order), every player's card **count**, the public
`pairs` pile, `turn`/`target`/`step`, places, points, losses, results, settings, and the public part of `lastDraw`.

**Never** in another player's (or a spectator's) view, nor in their `legal`:
- any card in another player's hand, including where the Joker is or who holds it;
- the order/positions of another player's hand;
- the card in `lastDraw` — only the drawer gets it (`myDrawnCard`), and only while that draw is the latest one.
  (If it paired, the card is public anyway through `pairs`.) The target does **not** get it in the view.
- the deck order.

After a round ends, `loserCards` is public (hands are empty by then). The spectator (`null`) view has
`myHand: []`, `myDrawnCard: null`. Legal actions of the drawer contain only indices `0..count-1`.

Leak-safe naming: view keys contain no substrings that look like card codes.

## 9. Bots

- Draw step: a uniformly random legal `draw` index.
- Offer step: shuffle with probability 0.3 (when legal), otherwise `offer` (never loops forever).
- Bots never get `move` from their policy; random play otherwise finishes quickly.

## 10. View shape (summary; see `types.ts`)

`phase, step, round, totalRounds, settings, order, myHand, handCounts, turn, target, places, pairs, lastDraw
(public: drawer, from, index, paired, out), myDrawnCard, points, losses, results, loserCards`.
`RoundResult = { round, loser, places, points }`.

## 11. UI plan (360–430px portrait, kit only)

- **top**: `PlayerStrip` via `stripPlayers(players, active, id => ({ sub: "<n> cards" | "Safe · 2nd" | "Joker!",
  badge: id === view.target ? "🎯" : places[id] ? "✓" : undefined, dim: places[id] !== null }))`.
- **board** (`TableArea label="Round r of R"`):
  - Neighbour's hand as a fan of `CardBack`s (one per `handCounts[target]`), overlapping and horizontally scrollable,
    each ≥ 44px wide tap target. When `draw` is legal: tap a back to select it (it lifts), tap again or press
    **Draw** to send `{ type: "draw", index }`. Label: "Pick a card from <target>".
  - Otherwise show whose turn it is and from whom: "<drawer> is drawing from <target>" (fan shown, not tappable).
  - Last event line from `lastDraw`: "You drew 7♥ from Ana" (`myDrawnCard`) / "Ben drew from you" / "Ben drew from Ana and
    paired 9♣ 9♠" / "Ana is out!".
  - Pairs pile: a compact stack (`CardBack` / last pair face up with `PlayingCard`) + "n pairs" count; tap opens a `Sheet`
    listing all thrown pairs.
  - Round/game over: `BigStatus` "<loser> is left with the Joker!" with `PlayingCard` of `loserCards`, place list.
- **bottom**: `TurnIndicator` ("Your turn: draw a card" / "Arrange your hand, then Offer"), your `Hand`
  (auto-sorted in shuffle mode; `unsorted` in arrange mode so positions are real), `ActionBar` with the primary
  `Button size="lg"`: **Draw** (draw step), **Offer hand** (offer step) + secondary **Shuffle** and ◀ ▶ buttons to move
  the selected card one position (`move` with `to = i ± 1`); host-only small **Skip <name>** and **Next round**.
- Spectator: everything public, no controls. The Joker in your own hand is visible to you only (it's in `myHand`).
