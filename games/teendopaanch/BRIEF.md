# Teen Do Paanch (3-2-5): game brief

Game id `teendopaanch`, category `cards`, **exactly 3 players** (min 3, max 3).
This brief is the spec the rules, tests and UI are built against. Types are in `types.ts`.

## 1. Cards

- 30-card deck: ranks A K Q J 10 9 8 7 in all four suits (32 cards) minus two sevens.
- Setting `removedSevens` picks which two sevens leave the deck (default `clubsDiamonds`):
  - `clubsDiamonds`: remove 7♣ 7♦ (keep 7♠ 7♥), the common rule.
  - `heartsDiamonds`: remove 7♥ 7♦ (keep the black sevens).
  - `spadesClubs`: remove 7♠ 7♣ (keep the red sevens).
- Rank order inside a suit, high to low: A K Q J 10 9 8 7 (the normal A-high order, so the engine's
  `trickWinner(cards, trump)` and `rankValue` apply unchanged).

## 2. Seats, targets and the dealer

Seats are clockwise `order[0..2]` (`p0, p1, p2` in tests). Hands are numbered from 1.
In hand `h` the targets are:

| seat | target |
|---|---|
| `(h-1) % 3` | **5** tricks: the *trump maker*; calls trump and leads the first trick |
| `h % 3` | **3** tricks |
| `(h+1) % 3` | **2** tricks: the *dealer* |

So hand 1: p0 = 5, p1 = 3, p2 = 2 (dealer p2). Hand 2: p1 = 5, p2 = 3, p0 = 2 (dealer p0). Hand 3:
p2 = 5, p0 = 3, p1 = 2. Then it repeats. (Dealer = 2 is the common rule; the 5 player sits to the
dealer's left, i.e. next clockwise.) Targets always sum to 10 = tricks per hand.

## 3. One hand, phase by phase

`phase` is one of `"trump" | "exchange" | "play" | "handEnd" | "over"`.

1. **Deal.** Shuffle (seeded rng) and deal 10 cards to each player in two batches of 5.
   - Setting `trumpCallAfter` = `five` (default): each player first receives only the first batch of 5.
     The second batch is held face down in state (`secondBatch`) and is **not visible to anyone, not even
     its owner**, until trump is called.
   - `trumpCallAfter` = `all` (simplification): all 10 cards are in hand immediately.
2. **`trump` phase.** Only the trump maker acts: `{ type: "trump", suit }` for any of `S H D C`
   (all four are legal; no "no trump"). Then the second batch joins every hand (10 cards each).
3. **`exchange` phase** (only from hand 2 on, only if setting `pullRule` = `highest` (default) and somebody
   is owed pulls; otherwise it is skipped and play starts). See section 4.
4. **`play` phase.** 10 tricks. The trump maker leads trick 1. Each trick: leader plays any card, then the
   next two players clockwise. **Must follow the led suit if able**, otherwise any card (trumping is never
   forced). Highest trump wins, else highest card of the led suit. The trick winner leads the next trick.
   Completed tricks do not pause: the finished trick is stored as `lastTrick` (plays + winner) and the
   next trick starts at once with the winner to act.
5. **End of hand.** After the 10th trick each player's `diff = tricksWon - target`, added to `totals`, and
   a `HandResult` is appended to `history`. The diffs become next hand's `owed` (pulls). Then either the
   game ends (`phase: "over"`, section 6) or `phase: "handEnd"`, where only the **host** may send
   `{ type: "nextHand" }` to deal the next hand (dealer/targets rotate one seat clockwise).

## 4. Pulling (card exchange), setting `pullRule`

- `highest` (default, the common rule). At the start of every hand after the first, after trump is called
  and all 10 cards are in hand: a player whose `diff` in the previous hand was **positive** (made more than
  their target) is a *puller* and may pull one card per overtrick; a player whose previous `diff` was
  **negative** is a *victim* and owes one card per missing trick. (Total surplus always equals total
  shortfall.)
  - **Order** (`pullQueue`, public, one entry per single pull): pullers in clockwise order starting from
    this hand's trump maker; for each puller, victims in clockwise order starting after the puller; surplus is
    matched greedily against remaining shortfall (each puller pulls exactly their surplus, each victim gives
    exactly their shortfall).
  - **One pull:** the puller (the only active player) sends `{ type: "pull", card }` with **any card from
    their hand**. That card goes to the victim, who must **immediately and automatically** return the
    **highest card of that same suit now in their hand, counting the card just received** (so if the
    victim holds nothing higher, the received card itself comes back and nothing changes). The victim
    takes no action.
  - Each completed pull is recorded in `exchanges` as `{ puller, victim, given, returned }`. In views,
    `given` and `returned` are shown **only to that puller and that victim**; everyone else (third player,
    spectators) sees `given: null, returned: null` (they know a pull happened, not which cards).
    Exchanges remain in the view for the rest of that hand and are cleared at the next deal.
  - When `pullQueue` is empty, `phase` becomes `play` with the trump maker leading.
- `off` (simplification): no exchanges ever; `owed` is still reported but `pullQueue` is always empty.

Hand 1 never has an exchange (`owed` all 0).

## 5. Scoring

- Per hand: `diff = tricksWon - target` (e.g. target 5 and 6 tricks = +1; target 3 and 1 trick = -2).
  Diffs of a hand sum to 0.
- `totals` = sum of diffs over all completed hands. `scores(state) = rankScores(totals)` (higher is better,
  ties share rank). Mid-game scores reflect completed hands only (current-hand tricks are not counted).

## 6. End of game, settings `endRule`, `hands`, `targetPoints`

- `endRule` = `hands` (default): the game ends after hand number `hands` (default **6**, range 1-30) is
  complete.
- `endRule` = `points`: the game ends at the end of the first hand after which any player's total is
  **>= `targetPoints`** (default 5, range 1-20; field visible only for this rule), or after `hands` hands,
  whichever comes first (`hands` is then a cap).
- On end: `phase: "over"`, `isOver` true, no further legal actions; the final hand's result is in
  `history` and `lastTrick` still shows its last trick.

## 7. Settings (house rules)

| key | type | default | options / range | effect |
|---|---|---|---|---|
| `hands` | number | 6 | 1-30 step 1 | hands to play (cap in points mode) |
| `endRule` | select | `hands` | `hands`, `points` | fixed hand count, or first to `targetPoints` |
| `targetPoints` | number | 5 | 1-20 | points mode only (visibleIf endRule=points) |
| `removedSevens` | select | `clubsDiamonds` | `clubsDiamonds`, `heartsDiamonds`, `spadesClubs` | which two 7s leave the deck |
| `trumpCallAfter` | select | `five` | `five`, `all` | trump called after first 5 cards (two-batch deal) or after all 10 |
| `pullRule` | select | `highest` | `highest`, `off` | card exchange from overtricks, or none |

## 8. Actions and legality

| phase | who | legal actions |
|---|---|---|
| `trump` | trump maker | `{type:"trump", suit}` for each of `S`,`H`,`D`,`C` (4 actions) |
| `exchange` | `pullQueue[0].puller` | `{type:"pull", card}` for every card in their hand (10 actions) |
| `play` | `turn` | `{type:"play", card}` for each card allowed by follow-suit |
| `handEnd` | host only | `{type:"nextHand"}` |
| `over` | nobody | none |

Everyone else (including the host when it is not their move, unknown ids and spectators) gets `[]`.
`activePlayers`: trump maker in `trump`; current puller in `exchange`; `turn` in `play`; `[]` in
`handEnd` (waiting for host) and `over`.

## 9. Hidden information (`viewFor`)

A player's view contains only: their own current hand (`myHand`), counts of every hand (`handCounts`),
public table state (trump, current trick, last trick, tricks won, targets, totals, history, pull queue),
and exchange cards for pulls they took part in. It must never contain:
- another player's hand cards;
- any `secondBatch` card before trump is called, **including the viewer's own** second batch;
- the deck order;
- `given`/`returned` of an exchange the viewer was not part of.
Spectator (`null`) view: as a third party, with `myHand: []`.
Note: an involved player legitimately sees the exchanged cards (the victim knows the card it received
and the one it returned, which is now in the puller's hand), and played cards are public once played.

## 10. Bots (`botAction`, sees only its own view)

- Trump: the suit with the most cards in hand; ties broken by higher total rank, then S,H,D,C order.
- Pull: give the lowest non-trump card (lowest rank; if only trumps, the lowest trump).
- Play: every trick is worth +1, so always try to win. Leading: highest card if it is an Ace, else lowest
  card of the longest non-trump suit (any lowest card if only trumps). Following: the lowest legal card that
  currently beats the trick, else the lowest legal card (preferring non-trump).
- Bots are never host; the simulation's host bot sends `nextHand`.

## 11. UI plan (kit only)

- `top`: `PlayerStrip` via `stripPlayers`; per seat `badge` = target (`5`/`3`/`2`) and `sub` =
  `"won/target · total ±n"` during play (e.g. `2/5 · +1`), dealer marked with "D" in the sub text.
- `board`: `TableArea label="Hand h of N · Trump ♠"` (`SuitBadge` for trump).
  - `trump` phase: trump maker sees four large `SuitBadge` buttons (Button containing SuitBadge, >= 44px)
    and "Pick trump from your first 5 cards"; others see `BigStatus` "P0 is choosing trump" and a face-down
    `CardBack count={5}` for their second batch.
  - `exchange` phase: list of `pullQueue` ("P1 pulls from P2 ×2"), and own exchange results ("You gave 7♥,
    got A♥"). The puller selects a card in `Hand` and taps primary "Pass card".
  - `play`: `<Trick>` with current plays, or `lastTrick` with its winner highlighted when the current trick
    is empty.
  - `handEnd`/`over`: hand summary table from the last `history` entry (target, won, diff) + totals.
- `bottom`: `TurnIndicator`, `Hand` (playable = legal play cards / all cards when pulling), `ActionBar` with
  primary "Play card" / "Pass card" and host "Next hand".
