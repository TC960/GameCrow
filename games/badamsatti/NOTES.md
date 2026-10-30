# Badam Satti / Sevens: rules notes

## House-rule settings

| key | label | default | options / range | effect |
|---|---|---|---|---|
| `firstCard7H` | First card must be the 7♥ | `true` | on / off | On: the 7♥ holder must open the round with the 7♥. Off: the 7♥ holder still starts but may open with any 7 they hold. |
| `aceHigh` | Ace above King | `false` | on / off | Off: suits run A 2 … 7 … K (Ace is played below the 2). On: suits run 2 … 7 … K A (Ace is played above the King; it can never go below the 2). |
| `allowPassWhenAble` | Allow passing with a playable card | `false` | on / off | Off: you must play if you can, and may pass only with no playable card. On: you may always pass, except on the opening card of a round. |
| `playToEnd` | Play on to rank everyone | `false` | on / off | Off: the round ends as soon as one player empties their hand. On: play continues (finished players are skipped) until only one player still holds cards. |
| `rounds` | Rounds | `1` | 1–10, step 1 | Number of rounds. Penalties add up over rounds; lowest total wins. The host starts each next round. |

## Rule decisions

- **Deal**: the whole 52-card deck is dealt round-robin with `dealAll`; the seat that receives the first card rotates one seat each round, so who gets the extra cards rotates. Hands are stored sorted (suit, then rank).
- **Who starts**: the 7♥ holder, every round (so the start rotates naturally with the deal).
- **Ace high**: the "cleanest rule" chosen is Ace-high-only. With `aceHigh` on, the Ace is simply the top rank (2 … K A); there is no "either end" Ace. Each suit then has 5 cards below the 7 and 7 above it.
- **Opening card is always forced**: even with `allowPassWhenAble`, the starter cannot pass the opening move (otherwise nobody could ever play while `firstCard7H` is on).
- **Must play if able**: pass is legal only when you hold no playable card (unless `allowPassWhenAble`). Passing reveals only "passed".
- **No dead ends**: since all 52 cards are in hands, a playable card always exists while anyone holds cards, so the game can't stall.
- **Scoring (penalty points, lower is better)**, per round:
  - `playToEnd` off: penalty = cards left in hand when the round ends (winner 0). Places are by cards left (ties share).
  - `playToEnd` on: penalty = finishing place − 1 (1st 0, 2nd 1, …, last n − 1). Cards left would give everyone except the last player 0, so finishing order is used instead.
  - Single round uses the same rule, so `scores()` always is `rankScores(totals, false)`: rank 1 = lowest total. Ties share a rank.
- **Live scoreboard**: shows totals of finished rounds only (all 0 during round 1).
- **Rounds**: after a non-final round the phase is `roundOver` and only the host has `{ type: "nextRound" }`. After the final round the game is over immediately (no host action).
- **Remaining hands at round end** stay hidden; only counts (`cardsLeft`) are published.
- **View naming**: the view exposes rules as `view.rules` (`openWithSevenOfHearts`, …) rather than the raw settings, because the setting key `firstCard7H` contains the card code `7H` and would be flagged by `findLeaks`. The board's next playable ends are `Rank`s (not card codes) for the same reason.
- **Log**: the last 12 plays/passes of the current round (`LOG_LIMIT`), reset each round; a play that empties a hand carries `wentOut` = finishing place.
- **Bots**: always play when able; prefer cards that unlock their own next card, avoid opening a 7 in a suit they hold little of, with a little randomness.

## Engine requests

None.
