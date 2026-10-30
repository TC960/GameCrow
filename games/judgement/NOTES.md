# Judgement: rules notes

Game id `judgement`, 3 to 8 players, one 52-card deck. Rules: `rules.ts`. Public types and helpers: `types.ts`.

## House-rule settings

| key | label | default | options / range | effect |
|---|---|---|---|---|
| `startCards` | Starting cards | 7 | 1 to 13 | Cards each in the biggest round. `validateSettings` blocks the start when startCards × players > 52 (the message gives the maximum that fits). |
| `sequence` | Hand sizes | `down` | `down` (7,6…1), `downUp` (7…1…7, the 1-card round is played once), `up` (1,2…7) | The hand size of each round, and so the number of rounds (`down`/`up`: startCards rounds; `downUp`: 2 × startCards − 1). |
| `noTrump` | No-trump round | off | boolean | The trump rotation becomes ♠ ♦ ♣ ♥ then a no-trump round, then repeats. |
| `lastBidderRule` | Dealer can't make bids add up | on | boolean | The last bidder (the dealer) may not bid the number that makes the total of bids equal the hand size. |
| `mustTrumpWhenVoid` | Must trump when void | off | boolean | If you can't follow the led suit but hold a trump, you must play a trump (you don't have to beat a trump already played). No effect in no-trump rounds. |
| `exactBonus` | Bonus for an exact bid | 10 | 0 to 50 | An exact bid scores `exactBonus + perTrick × bid`. |
| `perTrick` | Points per bid trick | 1 | 0 to 10 | See above. |
| `missPenalty` | Missed bid | `zero` | `zero` (0), `minusBid` (−bid), `minusDiff` (−\|bid − won\|) | Points for missing your bid. |
| `turnTimer` | Turn timer (seconds, 0 = off) | 0 | 0 to 120, step 15 | When it is on, each bid or play has that long; when time runs out the game bids or plays for that player with the bot policy. |

## Rule decisions

- **First dealer**: seat 0 (the first seat in the lobby order). The dealer moves one seat clockwise every round. Bidding starts at the seat left of the dealer and the dealer bids last. The seat left of the dealer leads the first trick, and each trick's winner leads the next.
- **Trump** depends only on the round number: round r uses rotation[(r − 1) mod length], with rotation ♠ ♦ ♣ ♥ (+ no trump). In `downUp` it keeps rotating on the way back up.
- **Forbidden bid**: computed as `handSize − (sum of the other bids)`. It applies only to the last bidder, and only when that number is between 0 and the hand size. Otherwise no bid is forbidden. At least one bid is always legal. The view shows it as `forbiddenBid`, and it is left out of `legal`.
- **Follow suit**: you must follow the led suit if you can; if you can't, you may play any card (or must play a trump with `mustTrumpWhenVoid`). The highest trump wins; otherwise the highest card of the led suit wins (ace high).
- **Trick resolution** is immediate: when the last card of a trick is played, the trick is cleared and stored as `lastTrick` (with winner and winning card) for the UI to show. `lastTrick` is reset when the next round is dealt, so the cards it holds are never mistaken for cards in a new hand.
- **Round end**: after the last trick the round is scored and the phase becomes `summary`. Only the host has `nextRound`. After the final round the phase becomes `over` immediately, with no host tap, and `lastRound` still holds the final round for the board.
- **Scoring** (scoring settings are literal, with no scaling): exact = `exactBonus + perTrick × bid` (a bid of 0 made scores just the bonus). Miss: `zero` = 0, `minusBid` = −bid (so a missed bid of 0 scores 0), `minusDiff` = −\|bid − won\|. The penalties are not multiplied by `perTrick`. Totals can go negative. Highest total wins, and ties share a rank (`rankScores`).
- **Absent players**: the host gets `{ type: "hurry" }` while the game waits on someone else and no timer is running. It starts a 30 s countdown (`HURRY_MS`, shown through `deadline`). When it runs out, `@timeout` makes that player's move with the bot policy. The host doesn't choose the move, so this follows the contract's "advance/skip only" rule. The optional `turnTimer` uses the same mechanism on every turn.
- **Hands** are kept sorted (`sortCards`, suit mode). Bids, tricks won, the current trick, the last trick and the round history are public. Other players' hands appear only as counts.
- **Bots**: bids estimate tricks from trumps (A/K/Q ≈ 1, J/10 ≈ 0.6, low ≈ 0.35), off-suit aces (≈ 0.9) and kings (≈ 0.55 when guarded), slightly lower at 6+ players, and take the nearest legal bid. Plays: a bot that still needs tricks leads an off-suit ace or its strongest card, wins as cheaply as it can when it plays last, and otherwise plays its highest winning off-suit card. A bot that has its tricks leads low and dumps the highest card that still loses. In simulations about 55-60% of bot bids are made exactly.

## Engine requests

1. **The contract test can't simulate 8 players with the default settings.** `tests/contract.test.ts` runs `simulateGame` at `maxPlayers` (8) with default settings. The default of 7 starting cards × 8 players = 56 > 52, so `validateSettings` (required by the brief) blocks `startMatch` and the test throws once the game is registered. Smallest fix: let a plugin declare the settings to simulate with, e.g. an optional `meta.testSettings?: (players: number) => Partial<Settings>` (or a test-only export), or have the contract test skip/adjust counts where `startProblem(plugin, players, {})` returns a problem. Alternative without an engine change (lead's call): turn the rule into "auto-cap", where the start is clamped to `floor(52 / players)` instead of blocked. That is a one-line change in `setup`/`handSizeSequence` plus dropping the block in `validateSettings`.
2. (Nice to have, not blocking.) A generic "hand this seat to a bot" for players who left mid-match. Judgement works around it with the host's `hurry` + `@timeout` auto-move.
