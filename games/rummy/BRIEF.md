# Rummy (13-card & 10-card) — game brief

Game id `rummy`, category `cards`, 2–6 players, portrait. Indian Rummy rules.
This brief is the spec the test agent and UI agent build against. Types are in `types.ts`;
the meld validator is the pure module `melds.ts` (shippable to the client, no secrets).

---

## 1. Cards, deck and deal

- **Variant** (`variant`): `"13"` (default) deals 13 cards each; `"10"` deals 10 cards each.
- **Decks** (`decks`): `"auto"` (default) = 13-card: 2 decks; 10-card: 1 deck for 2–4 players, 2 decks for 5–6.
  `"1"` / `"2"` force a count. Copies of the second deck carry `#2` (`"7H#2"`).
- **Printed jokers** (`printedJokers`, 0–4, default 2) are added once to the whole shoe (`"XR"`, `"XB"`, `"XR#2"`, `"XB#2"`),
  i.e. the shoe is `makeDeck({ decks, jokers: printedJokers })`: 13-card default = 106 cards, 10-card default (≤4 players) = 54.
- `validateSettings` blocks the start when `players × handSize + 2 + 10 > shoe size`
  ("Not enough cards …"): at least 10 cards must remain in the stock after the deal.
- **Deal**: the shoe is shuffled with the seeded rng; each player who is still in the game (`status !== "out"`) gets `handSize` cards.
  Then, if `wildJoker` (default true), the next card is **cut as the wild joker indicator** (`wildCard`, face up, public, out of play
  for the rest of the deal). Then the next card starts the **open (discard) pile** face up. The rest is the **closed stock** (order secret).
  Stock count after setup = shoe − players × handSize − 1 − (wildJoker ? 1 : 0).
- **Wild rank** (`wildRank`): the rank of the cut card; every card of that rank (any suit, any deck copy) is a joker for this deal.
  If the cut card is a printed joker, **Aces are wild** (`wildRank = "A"`). With `wildJoker` off, `wildCard`/`wildRank` are `null`
  and only printed jokers are jokers.
- "Joker" below always means *printed joker or wild-rank card*. Jokers are worth 0 points.
- Each player's hand is stored only as their own **arrangement** (`groups[playerId]`: an ordered list of non-empty groups;
  the hand is the concatenation). After the deal every hand is arranged **by suit** (see `sortGroups`).

## 2. Turn order and actions

- Seat order is `order` (players in seat order). Deal 1 is started by seat 0. Each later deal is started by the next seat clockwise
  after the previous deal's starter that is not eliminated (`status !== "out"`).
- The turn passes clockwise to the next player whose status is `"in"` (dropped, wrong-show and eliminated players are skipped).
- A turn has two steps: **draw** (`step: "draw"`), then **discard** (`step: "discard"`).

### Actions (all only for the player whose turn it is, unless noted)

| action | when | effect |
|---|---|---|
| `{type:"draw", from:"stock"}` | draw step | take the top stock card; it is added to the hand as a **new group at the end** |
| `{type:"draw", from:"discard"}` | draw step, pile not empty, and the top is not a joker unless `jokerFromDiscard` | take the open-pile top, same placement; that card becomes `pickedFromDiscard` |
| `{type:"discard", card}` | discard step; any held card **except `pickedFromDiscard`** | card goes on top of the open pile; turn ends |
| `{type:"declare", card}` | discard step; any held card except `pickedFromDiscard` | `card` is the finishing card (removed from the hand, placed face down); the remaining hand is judged **as currently arranged** (see §4) |
| `{type:"drop"}` | draw step only (before drawing this turn) | fold this deal: **first drop** (`firstDrop`, default 20) if the player has not drawn yet this deal, else **middle drop** (`middleDrop`, default 40). Hand leaves play unrevealed |
| `{type:"move", card, group}` | own turn, either step | move a held card to group index `group` of the current arrangement; `group === groups.length` means "a new group at the end". Card is appended to the end of the target group, then empty groups are removed |
| `{type:"arrange", groups: string}` | own turn, either step | replace the whole arrangement in one action. `groups` is the text encoding `"7H,8H,9H|KS,KD#2,KC|…"` (groups separated by `|`, cards by `,`; `encodeGroups`/`decodeGroups` in `melds.ts`). It must use every held card exactly once and have no empty group, else rejected ("That arrangement doesn't match your hand"). In `legalActions` it appears as `{type:"arrange", groups: FREE_TEXT}` |
| `{type:"sortGroups"}` | own turn, either step | rearrange by suit: one group per suit in the order ♠ ♥ ♣ ♦ (ranks ascending, ace high), then one group of printed jokers; empty suits omitted. Wild-rank cards stay in their suit |
| `{type:"autoGroup"}` | own turn, either step, only if setting `autoGroup` (default true) | arrange optimally with the meld solver: the melds of `bestGrouping` first, then a group of unmatched cards. In the discard step (handSize + 1 cards) it also picks the best card to throw and puts it **alone in the last group** (so `declare` of that card declares the optimal grouping) |
| `{type:"skipTurn"}` | **host only**, phase play, when the turn player is not the host | auto-plays the slow player's turn: draw step → draws the stock top and discards it; discard step → discards `lastDrawn` (or, if that was picked from the open pile, the last card of the last group that is not the picked card). Never drops or declares for them |
| `{type:"nextDeal"}` | **host only**, phase `dealOver` | starts the next deal |

`legalActions` enumerates everything concretely except `arrange` (one FREE_TEXT template):
- `move` entries: for each held card and each target `0..groups.length`, excluding the card's own group, and excluding
  "new group" for a card that is already alone in the last group (a no-op). At most 14 × 15 entries.
- `discard` / `declare`: one entry per held card (except `pickedFromDiscard`).
- Players who are not on turn have **no** actions (arranging is only possible on your own turn, see NOTES engine request).
- Spectators and unknown ids get `[]`; nothing is legal in phase `over`.

### Stock running out
At the end of every turn (discard, skip, wrong show), if the stock is empty: when fewer than 3 rebuilds happened this deal and the open
pile has ≥ 2 cards, all open-pile cards except the top are shuffled into a new stock (`reshuffles` + 1). Otherwise the deal ends as a
**draw** (`reason: "stockOut"`): no winner, every player still in scores 0 this deal (drops/wrong shows keep their points).

## 3. Melds (`melds.ts`)

A **group** is valid when it is one of:
- **Pure sequence**: ≥ 3 cards, same suit, consecutive ranks, **no printed jokers**. A wild-rank card used as its own natural rank and suit
  keeps the sequence pure (wild 5: `4H 5H 6H` is pure).
- **Impure sequence**: ≥ 3 cards; the non-joker cards are of one suit with distinct ranks, and jokers fill the gaps/ends to make
  consecutive ranks. A group made **only of jokers** (≥ 3) also counts as an impure sequence.
- **Set**: 3 or 4 cards; the non-joker cards have the same rank and **all different suits** (two-deck duplicates like `7H 7H#2 7S`
  are invalid); jokers make up the rest. At most 4 cards.

Sequences: Ace is low **or** high, never both and never wrapping: `A-2-3` and `Q-K-A` valid, `K-A-2` invalid.
Max length 13. Duplicate ranks in one sequence are invalid (`7H 7H#2 8H`). Group order does not matter (it is validated as a multiset).
A group of fewer than 3 cards is never valid. `classifyGroup` returns `"pure" | "impure" | "set" | null`, preferring
pure > impure > set when a group fits several (e.g. `7H + 2 jokers` is an impure sequence).

**Valid declaration** (`checkDeclaration(groups, wildRank)`): every group is valid, at least **two sequences** (pure or impure),
at least **one pure sequence**. Remaining groups may be sequences or sets.

**Card points**: A, K, Q, J = 10; 10…2 = face value; jokers (printed and wild rank) = 0.

**Hand points** (`handPoints(hand, wildRank)`, used for losers): if the cards can be arranged with ≥ 1 pure sequence and ≥ 2 sequences
in total, the points are the **minimum** total of the cards left outside valid groups (over all such arrangements); otherwise
**all cards count** (full count). The game then caps it at `maxPoints` (default 80).
`bestGrouping(hand, wildRank)` returns that optimal arrangement (`groups`, `melds`, `deadwood`, `points`, `qualified`).

## 4. Ending a deal

- **Valid declaration** (`reason: "declare"`): the declarer wins the deal with 0 points. Every other player still `"in"` scores
  `min(handPoints(their hand), maxPoints)` (automatically, with the best possible arrangement). Dropped and wrong-show players keep their points.
- **Invalid declaration** (wrong show) — setting `wrongShow`:
  - `"continue"` (default): the declarer scores `wrongShowPenalty` (default 80), is out of this deal (`status: "wrongShow"`), their
    groups and finishing card are revealed in `shows`, the finishing card goes on top of the open pile, and play continues with the next player.
  - `"end"`: the deal ends immediately (`reason: "wrongShow"`): declarer scores `wrongShowPenalty`, everyone else still in scores 0, no winner.
- **Last player standing** (`reason: "lastStanding"`): when drops / wrong shows leave exactly one player `"in"`, that player wins with 0.
- **Stock out** (see §2): draw, no winner.

Deal points are added to `totals`; a summary is appended to `history`.

## 5. Match modes (`mode`)

- `"single"` (default): one deal; then phase `over`.
- `"deals"`: `dealCount` deals (2–10, default 3); after each deal phase `dealOver` (host `nextDeal`), after the last phase `over`.
- `"pool101"` / `"pool201"`: after each deal, any player whose total is **≥ 101 / 201** is eliminated (`status: "out"`, not dealt in
  any more). When at most one player is left the match is `over`, otherwise `dealOver`.

`scores(state) = rankScores(totals, false)` (lowest total ranks first; ties share a rank). Before the first deal ends everyone is 0 / rank 1.

## 6. Settings (house rules)

| key | type | default | notes |
|---|---|---|---|
| `variant` | select `"13"`/`"10"` | `"13"` | hand size |
| `mode` | select `single`/`deals`/`pool101`/`pool201` | `single` | |
| `dealCount` | number 2–10 | 3 | visible for `deals` |
| `decks` | select `auto`/`1`/`2` | `auto` | see §1 |
| `printedJokers` | number 0–4 | 2 | |
| `wildJoker` | boolean | true | cut a wild-joker rank |
| `jokerFromDiscard` | boolean | false | may a joker (printed or wild) be taken from the open pile |
| `maxPoints` | number 20–200 step 5 | 80 | cap for a losing hand |
| `wrongShowPenalty` | number 0–200 step 5 | 80 | |
| `wrongShow` | select `continue`/`end` | `continue` | |
| `firstDrop` | number 0–100 step 5 | 20 | |
| `middleDrop` | number 0–100 step 5 | 40 | |
| `autoGroup` | boolean | true | offers the Auto-group action |

## 7. Hidden information

- Secret: the stock order and contents, every other player's hand/arrangement, the card a player drew from the **stock**
  (`lastDrawn` is shown only to that player), the hands of dropped players (never revealed), the finishing card until the deal ends.
- Public: hand counts, statuses, stock count, open-pile top and count, wild card/rank, who drew from where (and the card when it
  came from the open pile), every discard, wrong-show groups, deal results (all remaining hands with their scored grouping) after a deal ends.
- `viewFor(state, null)` (spectator) has no hand and no secrets. `legalActions` only lists the actor's own cards.
- Note for leak tests with two decks: `findLeaks` matches substrings, so a secret `"7H"` "matches" a legitimately visible `"7H#2"`.
  Compare with exact card tokens (e.g. collect every string in the view and check membership) — see NOTES.

## 8. View (`types.ts` `View`)

`phase, deal, dealCount, poolLimit, variant, handSize, settings, turn, step, wildCard, wildRank, stockCount, discardTop,
discardCount, myGroups, myHand, myStatus, pickedFromDiscard, lastDrawn, myDropCost, players[] (id, status, handCount, dealPoints, total),
totals, log (last 12 public events), shows, result, history`.

## 9. Bots

`botAction` uses only the bot's view and `melds.ts`:
- Draw step: takes the open-pile top when legal and it improves its hand score (after the best discard) by ≥ 4, else draws from the stock.
  Never drops.
- Discard step: if some card can be thrown so that the rest is a valid declaration, it arranges (`autoGroup`, or `arrange` when
  auto-group is off) and then declares. Otherwise it discards the card that minimises its hand score (deadwood + a penalty while it lacks
  a pure sequence / second sequence), never the card it just picked.
- Bots finish every mode; the score of a bot's hand never rises between its turns, so open-pile ping-pong cannot loop forever.

## 10. UI plan (kit only)

- `top`: `PlayerStrip` with each opponent's card count, status badge (Dropped / Wrong show / Out) and total.
- `board`: `TableArea` with the closed stock (`CardBack count`) and a **Draw** tap target, the open pile top (`PlayingCard`) with
  **Take** (enabled from `legal`), the wild card ("Wild: 7s"), deal / pool info, and the last log line. Wrong shows listed under it.
- `bottom`: `TurnIndicator`, then the hand **as the player's groups**: each group is a small fan/row with a validity chip
  (`classifyGroup`: "Pure", "Sequence", "Set" or "—") and the hand's current points (`groupingPoints`). Tap a card to select it
  (lifts); with a card selected, each group shows a "Move here" target and there is a "New group" target (`move` actions from `legal`).
  Buttons: **Sort** (`sortGroups`), **Auto** (`autoGroup` when legal), **Discard** (selected card), **Declare** (selected card as
  the finishing card; before sending, run `checkDeclaration(groups without that card)` and show a confirm sheet warning about the
  wrong-show penalty when invalid), **Drop** (with the cost `myDropCost`, confirm sheet).
- Phase `dealOver`/`over`: a results board listing each player's revealed groups with chips, points this deal and totals
  (`result`, `history`); host gets **Next deal**.
- Optional: the UI may keep a local draft arrangement while waiting and send it with one `arrange` action when the turn starts.
