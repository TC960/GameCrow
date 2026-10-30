# Joker — rules agent notes

Full rules: `BRIEF.md`. Types: `types.ts`. Plugin: `rules.ts`.

## House rules (README entries)

| key | default | options | notes |
|---|---|---|---|
| `deck` | `joker` | `joker` (52 + 1 Joker `XR`), `queen` (52 minus `QC`, classic Old Maid) | |
| `matchColour` | `false` | boolean | pairs must be same rank and colour; with `queen` deck the loser card is always Q♠ |
| `drawFrom` | `next` | `next`, `previous` | `previous` = classic Old Maid (you draw from the player who just drew) |
| `handOrder` | `shuffle` | `shuffle` (server reshuffles after each draw), `arrange` (target may move/shuffle, then Offer, before each draw) | |
| `rounds` | `1` | 1–10 | host taps Next round between rounds |
| `scoring` | `places` | `places` (sum of n − place, higher better), `losses` (rounds lost, lower better) | shown when rounds ≥ 2 |

## Rule decisions

- **Pairs are discarded automatically** (initial deal and after every draw). No manual discard: keeping pairs would only
  let a Joker holder dilute their hand, which is cheating in the real game. Not a setting.
- **Starter** of round r is seat (r−1) mod n (skipping players already out); dealing starts with the starter, so the
  starter (and the next ones) get the extra cards.
- **Turn always passes clockwise**; `drawFrom` only changes whose hand you draw from.
- **Draw position** `index` is a position in the target's real hand order (`state.hands[target]`), not mirrored.
- **Position privacy**: in `shuffle` mode both hands touched by a draw are reshuffled with `rng`, so positions carry no
  information. In `arrange` mode the drawn card goes to a random position and the holder controls order (`move`
  with `to: FREE_NUMBER`, validated as an integer in range; `shuffle`). Arranging happens only in a dedicated
  `"offer"` step where the target is the active player, so (a) no race with the draw and (b) bots never fiddle with
  their hand while another player is on turn (the Convex bot loop runs any bot with legal actions).
- **Simultaneous outs** (the drawer pairs their last card with the target's last card) share a place.
- **Loser card** is moved out of `hands` into top-level `loserCards` at round end, cleared on the next deal, so a past
  card string never shows in a view while that card is back in some hand (keeps `findLeaks` checks clean).
- **The target never sees which card was taken** in the view (they could work it out from their own hand). Only the
  drawer gets `myDrawnCard`, and only while that draw is the latest. Keeps leak tests simple.
- **Host `skipTurn`** (only when the active player is someone else): offer step → offer as-is; draw step → turn passes
  without a draw. It never changes a hand. Termination still holds: a skipped absent player's hand only shrinks.
- **Scores**: `places` mode counts live place points for players already out during play; players still holding add 0.
- Deal with 0 or 1 holders after initial discards ends the round immediately (can make `isOver` true at setup with
  `rounds: 1`; astronomically rare).

## Self-check done

- `npx tsc --noEmit` clean.
- Temporary smoke test (deleted): `simulateGame` at 2, 5, 8 players × 3 seeds × 6 setting combos (default; queen;
  queen+colour; colour+previous; arrange+3 rounds+losses; arrange+previous+queen+2 rounds); exactly one loser
  per round with the expected loser card; card conservation every step; `findLeaks` for every viewer + spectator
  at every step (view and legal) found nothing beyond own hand / own drawn card / pairs / loserCards; crafted
  simultaneous-out scoring; offer/move/skip flow. Typical bot game: 7–240 steps (arrange mode up to ~800 at 8 players).

## Engine requests

None.
