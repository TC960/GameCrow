# Hearts: game brief (spec for rules, tests and UI)

Game id `hearts`, category `cards`, 3–6 players (default table: 4). Lowest total wins.
Cards use engine notation: `"2C"` (2♣), `"QS"` (Q♠), `"JD"` (J♦), `"TH"` (10♥). Aces are high, no trumps.
All types and constants named here live in `games/hearts/types.ts`.

## 1. Deck and deal

Every hand uses one 52-card deck minus the cards in `REMOVED_CARDS[n]`, so it divides evenly.
Hearts and Q♠ (and J♦) are never removed, so a hand always holds 26 penalty points.

| players | removed cards | cards each | opening card (`OPENING_CARD[n]`) |
|---|---|---|---|
| 3 | 2♦ | 17 | 2♣ |
| 4 | none | 13 | 2♣ |
| 5 | 2♦, 2♣ | 10 | 3♣ |
| 6 | 2♦, 2♣, 3♦, 3♣ | 8 | 4♣ |

- The whole remaining deck is shuffled (seeded rng) and dealt out; every player gets exactly 52−removed / n cards.
- Hands are numbered from 1. The dealer of hand `h` is `order[(h-1) % n]` (seat 0 deals hand 1). The dealer only
  matters for `firstLead = "leftOfDealer"`.
- Hands are stored sorted (`sortCards`), but tests must not rely on hand order.

## 2. Passing (simultaneous and secret)

Pass direction of hand `h` = `passDirectionFor(settings.passPattern, n, h)`:

| `passPattern` | sequence (repeats) |
|---|---|
| `"standard"` (default) | even n: left, right, across, hold · odd n (3, 5): left, right, hold |
| `"left"` | always left |
| `"leftRight"` | left, right (never hold) |
| `"none"` | always hold (no passing ever) |

- Left = next seat clockwise (`order[i+1]`), right = previous seat (`order[i-1]`), across = `order[i + n/2]` (even n only).
  `passTarget(order, id, dir)` gives the receiver.
- On a `"hold"` hand there is no pass phase: the hand starts directly in phase `"play"`.
- Every player passes exactly `PASS_COUNT` = 3 cards, all at the same time.

**Action design (finite legalActions).** Selecting 3 of up to 17 cards is done with per-card toggles plus a confirm:
- `{ type: "togglePass", card }` adds `card` to the player's (secret) selection, or removes it if already selected.
  Legal for every selected card, and for every unselected card in hand while fewer than 3 are selected.
- `{ type: "confirmPass" }` is legal only when exactly 3 cards are selected. It commits the pass: those 3 cards leave
  the player's hand at once (hand size drops by 3) and the player is done (no more pass actions; there is no "undo").
- When the **last** player confirms, all passes are exchanged simultaneously: each player receives the 3 cards from
  the player who passes to them. Phase becomes `"play"`.
- Pass-phase `legalActions` for a player who already confirmed (or anyone in another phase) contains no pass actions.

## 3. Play

- **Opening lead** (`firstLead`):
  - `"twoClubs"` (default): after passing, the holder of the opening card (table above) leads trick 1 and **must**
    lead exactly that card (it is their only legal action).
  - `"leftOfDealer"`: the player left of the dealer (`order[dealer+1]`) leads trick 1 with any card allowed by the
    leading rules below.
- **Follow suit**: a player who holds the led suit must play it; otherwise any card (subject to the first-trick rule).
- **Leading hearts** (`heartsMustBreak`, default on): hearts may not be led until hearts are broken, unless the
  leader holds only hearts. Hearts become broken when any heart is played (led or discarded). With
  `queenBreaksHearts` (default off) playing Q♠ also breaks hearts. Leading Q♠ is always allowed.
  With `heartsMustBreak` off, hearts may be led at any time (first-trick rule still applies).
- **No points on the first trick** (`noPointsFirstTrick`, default on): on trick 1, a player may not play a heart or Q♠
  (whether leading, following or discarding) if they have any other legal card. Concretely: take the cards allowed by
  the rules above; if at least one of them is not a heart and not Q♠, remove the hearts and Q♠ from the options.
  (A player with only hearts / Q♠ among their options may play any of them.) J♦ is not affected.
- The trick is won by the highest card of the led suit (`trickWinner(cards, null)`). The winner takes the cards and
  leads the next trick. After the last trick the hand is scored.
- Hand size n: 3p 17 tricks, 4p 13, 5p 10, 6p 8.

## 4. Scoring

Per hand, from the cards each player won:
- each heart = 1, Q♠ = 13 (penalty points; 26 total per hand);
- `jackOfDiamonds` (default off): whoever wins J♦ scores −10 that hand.

**Shooting the moon** (`moon`): a player who won all hearts **and** Q♠ (26 penalty points):
- `"others"` (default): the shooter scores 0 penalty points and every other player +26;
- `"self"`: the shooter scores −26 and every other player 0 penalty points;
- `"off"`: no special rule (the shooter simply takes 26).
J♦ (if on) is scored on top, independently of the moon (e.g. moon "others" + shooter also won J♦ → shooter −10).

Hand score is added to each player's total. Totals may go negative. `HandResult` is appended to `history`:
`{ hand, points, scores, moon, totals }` where `points` = raw points taken (hearts + 13·Q♠ − 10·J♦ if on),
`scores` = what was added to totals after the moon rule, `moon` = shooter id or null, `totals` = totals after this hand.

## 5. Hands, end of game, scores

- After a hand is scored: if any total ≥ `targetScore` (default 100), phase `"over"` (game ends immediately, no host
  action). Otherwise phase `"handEnd"`, which waits **only for the host**: `{ type: "nextHand" }` (host-only) deals hand h+1.
  `activePlayers` is `[]` in `"handEnd"` and `"over"`.
- `scores(state)` = `rankScores(totals, false)`: lower total = better rank; equal totals share a rank (so a tie for the
  lowest total is a shared win). Live mid-game. Initial totals are all 0 (everyone rank 1).
- `activePlayers`: pass phase → players who have not confirmed; play phase → `[turn]`.

## 6. Optional turn timer

`turnTimer` (seconds, 0 = off, default 0; 15–180 in steps of 15). Exists so a vanished player cannot block the table.
When on, `deadline(state)` is: pass phase → pass-phase start + timer (one deadline for everyone); play phase → time of
the previous play (or hand start) + timer. On `@timeout`:
- pass phase: every player who hasn't confirmed has their selection completed to 3 cards automatically (keeping cards
  they already selected) and committed; then the exchange happens;
- play phase: the current player automatically plays a legal card (same heuristic as the bot).
No deadline in `"handEnd"` / `"over"` or when the timer is off (`deadline` → null).

## 7. Hidden information (viewFor)

Secret, never in another player's or the spectator's view (or in `legal`):
- other players' hands; the deck order;
- another player's pass selection, and the cards another player committed to pass. The cards I receive become visible
  to me only after the exchange (they are then in `myHand` and `received`).

Visible to me only: `myHand`, `passSelected` (my current selection), `myPassed` (the 3 cards I passed, from my confirm
to the end of the hand; these are cards I legitimately know about — leak tests must exclude them when checking the
receiver's hand), `received` (the 3 cards I received, after the exchange until the end of the hand), `passTo`/`passFrom`.

Public: phase, hand number, dealer, pass direction, who has confirmed their pass (`passConfirmed`), hand card counts,
whose turn, the current trick, the last completed trick and its winner, trick number, hearts broken, cards won that
score (`pointCards`: hearts, Q♠, and J♦ when that rule is on), points taken this hand, tricks won, totals, hand history,
removed cards, opening card, settings.

Spectator (`viewFor(state, null)`): public fields only; `myHand` = `[]`, `passSelected` = `[]`, `myPassed`/`received`/
`passTo`/`passFrom` = null.

## 8. Bots

`botAction` (sees only its own view):
- Pass: toggles its 3 most dangerous cards one by one, then confirms. Danger: Q♠ > A♠/K♠ > high hearts > other high
  cards, with a bonus for cards in short suits (to void a suit); J♦ is kept when the J♦ rule is on.
- Play: when leading, lowest safe card (avoids leading its own high spades / hearts); when following, ducks with the
  highest card below the current winner, otherwise sheds high cards when the trick is point-free and it plays last;
  when void, dumps Q♠, then A♠/K♠ (while Q♠ is out), then its highest heart, then its highest card.
Bots must finish full games for 3–6 players with every setting.

## 9. UI plan (kit only)

- `top`: `PlayerStrip` via `stripPlayers`: `sub` = `"{total} pts"`; `badge` = pass status in pass phase (`✓` / `…`),
  else points taken this hand (e.g. `"♥5"`, or `"🌙"` style text only if helpful; never colour alone).
- `board`: `TableArea` labelled `"Hand 3 · Trick 5/13"` (+ "Hearts broken" chip as text).
  - pass phase: `BigStatus` "Pass 3 cards to {name} ({direction})", after confirming "Waiting for others…" plus the 3
    passed cards (`PlayingCard`) small.
  - play phase: `Trick` with the current plays; when the trick is empty show the last trick with its `winner` for context.
    A `Banner` "You received …" lists `received` during trick 1.
  - handEnd/over: per-player table of this hand's points → scores (moon banner when `lastHand.moon`), plus totals.
- `bottom`: `TurnIndicator` (text override "Pick 3 cards to pass" / "Waiting for the host"); `Hand`:
  - pass phase: `multi`, `selected = view.passSelected`, `onSelect` → send `togglePass` for the one card that changed;
    `playable` = cards that have a legal `togglePass`. `ActionBar`: primary **"Pass 3 cards"** enabled only when
    `confirmPass` is legal.
  - play phase: `playable` from legal `play` actions, controlled single selection, tap-again or **Play** button.
  - `ActionBar` host-only **Next hand** in `"handEnd"`. Disable primaries while `pending`.
