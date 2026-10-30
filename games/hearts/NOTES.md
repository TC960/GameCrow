# Hearts: rules-agent notes

Spec: `BRIEF.md`. Types/constants: `types.ts`. Plugin: `rules.ts`.

## Settings (house rules)

| key | type | default | options / range | effect |
|---|---|---|---|---|
| `passPattern` | select | `standard` | `standard` (left, right, across, keep; 3/5 players: left, right, keep), `left`, `leftRight`, `none` | pass direction per hand (`passDirectionFor`) |
| `firstLead` | select | `twoClubs` | `twoClubs` (holder of 2♣, or 3♣/4♣ for 5/6 players, must lead it), `leftOfDealer` | opening lead of each hand |
| `noPointsFirstTrick` | boolean | true | | no hearts / Q♠ on trick 1 unless nothing else is allowed |
| `heartsMustBreak` | boolean | true | | hearts can't be led until a heart was played (unless only hearts) |
| `queenBreaksHearts` | boolean | false | shown when `heartsMustBreak` | playing Q♠ also breaks hearts |
| `moon` | select | `others` | `others` (others +26), `self` (shooter −26), `off` | shooting the moon (all 13 hearts + Q♠) |
| `jackOfDiamonds` | boolean | false | | winning J♦ scores −10 (applied on top of the moon rule) |
| `targetScore` | number | 100 | 10–500, step 5 | game ends after the hand in which someone reaches it |
| `turnTimer` | number | 0 | 0–180 s, step 15 (0 = off) | auto pass / auto play on timeout so a vanished player can't block |

## Rule decisions

- **Deck per player count** (hearts, Q♠ and J♦ never removed, so 26 penalty points per hand):
  3p remove 2♦ (17 each); 4p none (13); 5p remove 2♦ 2♣ (10, 3♣ opens); 6p remove 2♦ 2♣ 3♦ 3♣ (8, 4♣ opens).
- **Passing as a finite action set:** per-card `togglePass` (any selected card; any unselected card while < 3 selected)
  plus `confirmPass` when exactly 3 are selected. Confirming moves the 3 cards out of the hand at once and is final
  (no undo). The exchange happens when the last player confirms. Selections and committed passes are in state and shown
  only to their owner. Enumerating all 3-card subsets was rejected (680 actions per envelope with 17 cards, and the
  order of cards inside the array would matter for the structural match).
- **Hold hands** (and `passPattern: "none"`) skip the pass phase completely.
- **No-points-first-trick** is applied generically: of the cards otherwise allowed (lead or follow), drop hearts and
  Q♠ if anything else remains. This covers discarding, following spades with Q♠, and leading with `leftOfDealer`.
- **Leading Q♠** is always allowed (only hearts are restricted).
- **Moon + J♦:** the moon checks penalty cards only (all hearts + Q♠); J♦'s −10 is added independently.
  `HandResult.points` = raw (incl. J♦), `scores` = what was added after the moon rule.
- **End:** checked only after a full hand; ties for the lowest total share rank 1 (`rankScores(totals, false)`).
  No tiebreak hand (could be a future setting). Totals may go negative (moon `self`, J♦).
- **Between hands** the game waits for the host (`nextHand`, host-only, `activePlayers` = []). Game over is immediate.
- **Trick display:** completed tricks resolve at once. The view carries `lastTrick` (plays + winner) so the UI can show it.
- **Public info:** won scoring cards (`pointCards`), points this hand, tricks won. Tricks are played face up, so this
  is public history.
- **View has no "opening card" field:** `findLeaks` is string-based, so a constant `"2C"` in every view would look like
  a leak of the holder's hand. The UI uses `OPENING_CARD[n]` from types.ts. `myPassed` stays in the passer's own view
  for the whole hand (they know what they gave). Leak tests should exclude it, and should treat another player's
  committed pass as secret only during the pass phase.
- **Bots:** pass Q♠ > A♠/K♠ > high hearts > high cards in short suits (keep J♦ when that rule is on). Play: lead low
  safe cards, duck under the current winner, win cheaply only when playing last on a point-free trick, and when void
  dump Q♠ > A♠/K♠ (Q♠ still out) > highest heart > highest card. The timer timeout uses the same heuristics.
  A sample 4-player default game took 13 hands and about 850 steps.

## Self-check done

`npx tsc --noEmit` is clean. A temporary smoke test (now deleted) covered simulateGame for 3/4/5/6 players × 6
setting combos × 4 seeds, a string-level leak scan of every view and `legal` in every phase for 3/4/6 players, the
timer, deal sizes, the first-trick and hearts-broken rules, leftOfDealer, moon `others` and `self` + J♦, pass flow, and
determinism.

## ENGINE REQUESTS

None blocking. Optional: a way for the host to hand a gone player's seat to a bot mid-match. In turn-based games a
vanished player blocks the table forever. Hearts works around it with the `turnTimer` setting, which is off by default.
