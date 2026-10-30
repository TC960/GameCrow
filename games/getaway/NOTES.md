# Get Away (Bhabhi): rules agent notes

Binding rules: `BRIEF.md`. Types: `types.ts`. Plugin: `rules.ts`.

## Settings (house rules)

| key | type | default | options / range | effect |
|---|---|---|---|---|
| `rounds` | number | 1 | 1..10 | Rounds in the match; host sends `nextRound` between rounds. |
| `scoring` | select | `placement` | `placement`, `losses` | Rank by summed placement points (higher better) or by times Bhabhi (fewer better). |
| `openingLead` | select | `aceSpades` | `aceSpades`, `anyCard` | A♠ holder must lead A♠ on trick 1, or may lead any card. |
| `firstTrickCut` | boolean | false | | Off: an off-suit card on trick 1 is not a cut; trick 1 is always discarded. |
| `lastCardSafe` | boolean | false | | On: a player with no cards left after playing can't be made to pick up; next-highest led-suit card held by someone with cards picks up, else the trick is discarded. |
| `allOutRule` | select | `trickWinner` | `trickWinner`, `draw` | If everyone left runs out on one trick: highest led-suit card of it is Bhabhi, or nobody is. |

No `validateSettings`: 52 cards work for 3..8 players with every combination.

## Rule decisions

- Trick players are fixed at trick start (everyone holding cards, clockwise from the leader).
- A cut ends the trick immediately; later trick players don't play to it.
- Escapes are applied when a trick ends (after any pick-up). Same-trick escapes form one tied finishing group.
- Leader after a discarded trick = highest led-suit card; if that player is out, the next clockwise player with cards.
- `lastCardSafe` with no eligible picker: the trick is discarded and the lead goes clockwise from the
  highest led-suit card's player to the next holder.
- `allOutRule = trickWinner` can only trigger on a trick that was discarded (a pick-up always leaves the picker
  with cards). The Bhabhi is removed from that trick's finishing group.
- Deal: `dealAll(shuffled, n, round % n)` so the extra cards rotate between rounds. Each round re-deals the
  whole deck; the A♠ holder always opens.
- Placement points per round: `n - (players finished in this group and all earlier groups)`; Bhabhi 0. Live
  scores include points already earned this round by safe players (final the moment they escape).
- `lastTrick` (the most recently ended trick, with all cards) is public, including a picked-up trick, because
  those cards were played face up. Leak tests must exclude `lastTrick.plays` from the picker's secrets
  (BRIEF section 7). Discarded cards are only counted. Hands are never revealed.
- Bot: lead the lowest card of the longest suit; when following, duck under the current highest if possible
  (dump the highest such card), play highest if last to play, else the lowest; when void, dump the highest card.
  Bot games take ~65-130 actions; random play also always finishes.

## Self-check

`npx tsc --noEmit` clean. A temporary smoke test (deleted) ran `simulateGame` at 3, 5, 8 players x 5 seeds x 7
setting combinations (defaults, each non-default flag, all flags, multi-round with `losses`), checked
`findLeaks` for every other player's view, the spectator view and `legal` at every step, card conservation
(hands + trick + discards = 52), determinism, and crafted positions for cut/pick-up, no-cut first trick,
`lastCardSafe` on/off and both `allOutRule` values.

## ENGINE REQUESTS

None.
