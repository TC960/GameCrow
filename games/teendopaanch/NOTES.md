# Teen Do Paanch: rules-agent notes

Full spec: `BRIEF.md`. Public types: `types.ts`. Plugin: `rules.ts`.

## Settings (house rules)

| key | default | options | notes |
|---|---|---|---|
| `hands` | 6 | 1-30 | hands to play; the cap in points mode. Multiples of 3 give every seat each target equally |
| `endRule` | `hands` | `hands`, `points` | fixed length, or first to `targetPoints` (checked after each hand) |
| `targetPoints` | 5 | 1-20 | visibleIf endRule = points |
| `removedSevens` | `clubsDiamonds` | `clubsDiamonds`, `heartsDiamonds`, `spadesClubs` | which two 7s are removed from the 32-card A-7 deck |
| `trumpCallAfter` | `five` | `five`, `all` | `all` = simplification: all 10 cards dealt before trump is called |
| `pullRule` | `highest` | `highest`, `off` | `off` = simplification: no card exchange |

## Rule decisions

- **Seats/targets** are fixed by hand number so tests can predict them: hand h gives seat (h-1)%3 the 5,
  h%3 the 3, (h+1)%3 the 2 (dealer). Hand 1: p0 = 5, p1 = 3, p2 = 2 (dealer). No random first dealer.
  Dealer = 2 tricks and the 5-player sits to the dealer's left (next clockwise) and leads. A "dealer gets 5"
  setting was dropped: with a fixed starting seat it only changes the "dealer" label, not the play.
- **Two-batch deal**: the second batch of 5 lives in `state.secondBatch` and is hidden from everyone
  (owner included) until trump is called. `handCounts` count only cards in hand (5 during trump phase).
- **Trump**: any of 4 suits; no no-trump option. The 5-player leads trick 1.
- **Follow suit** required; trumping when void is optional. Standard A-high order, so the engine's
  `trickWinner(cards, trump)` is used unchanged.
- **Tricks don't pause**: the finished trick goes to `lastTrick` and the winner is immediately to act.
  Only the hand boundary waits for the host (`nextHand`, host-only, per "host controls rounds").
- **Pulling (common rule)**: from hand 2, after trump is called and all 10 cards are in hand. One
  pull per overtrick/shortfall of the previous hand. Order: pullers clockwise from this hand's trump maker,
  victims clockwise after each puller, greedy matching (`computePulls`, exported). The puller passes any card;
  the victim automatically returns the highest card of that suit in their hand **including the one just
  received** (so passing a card the victim can't beat changes nothing). No victim action, so a pull never
  waits on the victim. Exchange cards are visible only to the two players involved for the rest of the hand.
- **Scoring**: per hand tricks - target; cumulative `totals`; `rankScores(totals)` (higher better, ties share
  rank). Diffs sum to 0 every hand.
- **Points mode** ends at the end of the first hand where any total >= `targetPoints` (or at the `hands` cap).
- **No skip for a slow player**: like other trick games, play waits on the player to move; the shell's
  "End game" is the escape hatch (a host "auto-play" would pick an outcome for someone else, which the
  contract forbids).
- **Bots**: trump = longest suit (tie: higher rank sum); pull = lowest non-trump card; play = always try to
  win (lowest winning card when following; lead an Ace if holding one, else low from the longest plain suit).

## Self-check done

`npx tsc --noEmit` clean. A temporary smoke test (deleted) ran 8 seeds x 6 setting combos (default,
`trumpCallAfter: all`, `pullRule: off`, points mode, other sevens, 1 hand): every game finished, totals sum
to 0, card counts are invariant, exchanges happen only when enabled, and `findLeaks` found nothing in any
view/legal list for p0-p2 and the spectator in every phase (other hands, every second batch incl. the
viewer's own, exchange cards for third parties). `simulateGame` also finished for each.

## Engine requests

None.
