# Get Away (Bhabhi): game brief

Game id `getaway`, category `cards`, 3 to 8 players. One standard 52-card deck, no jokers, aces high
(rank order 2 < 3 < ... < 10 < J < Q < K < A). There are no trumps.

This is the binding spec for `games/getaway/` (rules.ts, ui.tsx) and for `tests/getaway.test.ts`.
Types are in `games/getaway/types.ts`.

## 1. Goal

Get rid of all your cards. Players who empty their hand "get away" (are safe) in the order they finish.
The last player still holding cards is the **Bhabhi** (the loser).

## 2. Setup (each round)

- Shuffle one 52-card deck with the seeded rng and deal the whole deck round-robin with
  `dealAll(deck, n, startIndex)`, where `startIndex = round % n` (round is 1-based, so round 1 starts
  dealing at seat 1, round 2 at seat 2, ...). With 52 cards some players get one more card than others:
  the `52 % n` players starting at seat `startIndex` (clockwise) get `ceil(52/n)`, the rest `floor(52/n)`.
  (`dealAll` gives card i to seat `(startIndex + i) % n`.) Example: 3 players, round 1: seat 1 gets 18,
  seats 2 and 0 get 17. 5 players, round 1: seats 1 and 2 get 11, seats 3, 4, 0 get 10. Tests should check
  at least: every hand size is `floor(52/n)` or `ceil(52/n)`, the total is 52, no duplicates.
- Hands are stored sorted (`sortCards(hand, "suit")`); order inside a hand is not meaningful.
- The holder of the **A♠ ("AS")** leads the first trick of every round.
- `phase = "play"`, `round` = 1 for the first round, `trickNo = 1`, nobody safe, `discardCount = 0`,
  `lastTrick = null`, `bhabhi = null`.

## 3. Play

- Tricks go clockwise in seat order, starting with the leader. **Trick players** are fixed when the trick
  starts: everyone who holds at least one card at that moment, in clockwise order from the leader. Each
  trick player plays exactly one card per trick (unless the trick is cut early, see below).
- **Opening lead**: on trick 1 of a round, with `openingLead = "aceSpades"` (default) the leader's only legal
  play is A♠. With `"anyCard"` the A♠ holder may lead any card.
- Any other lead: the leader may lead any card in their hand.
- **Follow suit**: a player who holds a card of the led suit must play one of them (any of them).
- A player with no card of the led suit may play any card. This is a **cut** ("thulla").

### 3.1 Trick ends: everyone followed (discard)

If every trick player played a card of the led suit, the trick is **discarded** (removed from the game;
`discardCount` grows by the number of cards). The player who played the highest card of the led suit leads
the next trick. If that player now has no cards, the lead goes to the next player clockwise from them who
still holds cards.

### 3.2 Trick ends: a cut (pick up)

As soon as a player cuts (plays off-suit), the trick **ends immediately**; trick players after the cutter
do not play to it. The player who played the **highest card of the led suit** in that trick picks up
**every card** of the trick (including the cutting card and their own card) into their hand, and leads the
next trick. `discardCount` does not change.

House rules change this (see section 5):
- `firstTrickCut = false` (default): on **trick 1 of each round** an off-suit card is NOT a cut. The trick
  continues, everyone plays, and the trick is discarded as in 3.1 (the highest led-suit card leads next).
  From trick 2 on, cuts work normally. With `firstTrickCut = true`, cuts work on trick 1 too.
- `lastCardSafe = true`: a player who has no cards left after playing can never be made to pick up. The
  pick-up goes to the highest led-suit card among trick plays made by players who **still hold cards**. If
  no such play exists, the trick is discarded instead (`discardCount` grows) and the lead goes to the next
  player clockwise, after the player with the highest led-suit card, who still holds cards.
  With `lastCardSafe = false` (default) the highest led-suit card always picks up, even if that player had
  just played their last card (they take the trick back into their hand and are not safe).

### 3.3 Getting away

- Escapes are decided **when a trick ends** (after any pick-up). Every trick player who now holds no cards
  gets away. Players who get away on the same trick form one **finishing group** and tie with each other.
  `safe` is the list of groups in finishing order (`safe[0]` finished first). Inside a group, order is the
  order they played to that trick (cosmetic only).
- A safe player takes no further part in the round: not a trick player, never leads, never on turn.
- A player who plays their last card mid-trick is not safe yet (with default rules they may still have to
  pick up). They simply have nothing left to play in that trick.

### 3.4 End of a round

After a trick ends and escapes are applied:
- If exactly **one** player still holds cards, that player is the **Bhabhi**. The round ends.
- If **nobody** holds cards (everyone left ran out on the same trick), `allOutRule` decides:
  - `"trickWinner"` (default): the player who played the highest led-suit card of that final trick is the
    Bhabhi. They are removed from that trick's finishing group (the group is then everyone else).
  - `"draw"`: there is no Bhabhi this round; the final group stays as is.
- Otherwise the next trick starts with the leader from 3.1 / 3.2.

When a round ends:
- The Bhabhi (if any) gets `losses[bhabhi] += 1`.
- Placement points are added to `points` (section 6).
- The round result is appended to `history`.
- If `round < rounds`: `phase = "roundOver"`; the host sends `{ type: "nextRound" }` to deal the next round
  (fresh deck, `round + 1`, rules from section 2). Non-hosts have no legal action in `"roundOver"`.
- If `round == rounds`: `phase = "over"`, `isOver` is true.

## 4. Actions

```ts
type Action = { type: "play"; card: Card } | { type: "nextRound" };
```

`legalActions(state, actor)`:
- `phase "play"` and `actor.id === turn`: one `{ type: "play", card }` per legal card (follow suit when
  able; only `"AS"` for the opening lead under `"aceSpades"`).
- `phase "play"`, anyone else (including safe players, unknown ids, spectators, the host off-turn): `[]`.
- `phase "roundOver"`: `[{ type: "nextRound" }]` for the host only; `[]` for everyone else.
- `phase "over"`: `[]`.

`activePlayers`: `[turn]` during `"play"`, `[]` otherwise.

## 5. House rules (settings)

| key | type | default | effect |
|---|---|---|---|
| `rounds` | number 1..10 | `1` | Rounds in the match. The host deals each next round. |
| `scoring` | select `"placement"` / `"losses"` | `"placement"` | How the scoreboard ranks players (section 6). |
| `openingLead` | select `"aceSpades"` / `"anyCard"` | `"aceSpades"` | The A♠ holder must lead A♠, or may lead any card, on trick 1. |
| `firstTrickCut` | boolean | `false` | Whether an off-suit card on trick 1 is a cut (pick up). Off = the first trick is always discarded. |
| `lastCardSafe` | boolean | `false` | A player who has played their last card can never be made to pick up (section 3.2). |
| `allOutRule` | select `"trickWinner"` / `"draw"` | `"trickWinner"` | Who is Bhabhi when everyone left runs out on the same trick. |

No `validateSettings` (every combination works for 3 to 8 players).

## 6. Scoring

Both totals are kept in state and shown in the view (`points`, `losses`); `scoring` picks which one
`scores()` ranks.

- **Placement points** (per round): a player who gets away earns the number of players who finished
  strictly after them: `points = n - (number of players in their finishing group and all earlier groups)`.
  The Bhabhi (and, under `"draw"`, the final group) earns 0. Example, 4 players finishing A, then B, then C,
  Bhabhi D: A=3, B=2, C=1, D=0. If B and C got away on the same trick: A=3, B=1, C=1, D=0.
- **Losses**: number of rounds a player was the Bhabhi.

`scores(state)`:
- `"placement"`: `rankScores(totals, true)` where `totals[p] = points[p]` (completed rounds) plus, while a
  round is in `"play"`, the placement points already earned this round by players who are safe (their value
  is final as soon as they get away). In a 1-round game this ranks players by finishing order with the
  Bhabhi last.
- `"losses"`: `rankScores(losses, false)` (fewest losses ranks 1; the score shown is the loss count).
- One line per seated player; ties share a rank.

## 7. Hidden information (`viewFor`)

- A player sees only their own hand (`myHand`); others are counts (`handCounts`). Spectators (`null`) get
  `myHand: []`.
- Public: the current trick's plays, led suit, whose turn, trick players, safe groups, discard count,
  losses, points, history, the Bhabhi, settings, and `lastTrick` (the most recently ended trick, with all
  its cards: they were played face up).
- **Leak-test definition**: for player `p`, the secrets are the cards in `p`'s hand, except cards in
  `lastTrick.plays` when `lastTrick.pickedUpBy === p` (everyone saw those go into p's hand). No other view
  (other players', spectator) may contain any of p's secret cards, and `legalActions` for another player
  never mentions them. Hands are never revealed, not even at the end of the round or game.
- Discarded cards are not listed (count only). The deck order is not stored after the deal.

## 8. Bots (`botAction`, uses only the bot's own view and its legal list)

- Leading: lead the lowest card of the suit it holds most of (ties: suit order S, H, C, D).
- Following suit: if it is the last trick player to play, play its highest legal card; else if it holds
  led-suit cards lower than the current highest led-suit card, play the highest of those; else play its
  lowest legal card.
- Void (cut, or off-suit on a no-cut first trick): play its highest-ranked card.
- Only one legal action: play it. Never acts as host.

## 9. UI plan (ui.tsx, shared kit only)

- `top`: `PlayerStrip` from `stripPlayers(players, active, ...)`: badge = card count (`🂠 12`), or `Safe #k`
  for safe players (dim them), or `Bhabhi` at round end; `sub` = points or losses (per `scoring`) and the
  loss count when `rounds > 1`.
- `board`: `TableArea` labelled `Round r of R · Trick t` with `Trick` showing the current plays (winner
  highlight = current highest led-suit card), a `SuitBadge` for the led suit, and the discard count
  ("Discarded 24"). Right after a trick ends (current trick empty), show `lastTrick` instead with a
  `Banner`/`BigStatus`: "P3 cut! P1 picks up 4 cards" or "Trick discarded, P2 leads". Round end:
  `BigStatus` "P4 is the Bhabhi!" plus the finishing order.
- `bottom`: `TurnIndicator` (text "Waiting for the host" in `"roundOver"`), then `Hand` with
  `playable = legalOfType(legal, "play").map(a => a.card)`, controlled `selected`, tap-again to play, and an
  `ActionBar` with "Play card" (primary, lg) and, for the host in `"roundOver"`, "Next round".
- A short hint when void: "No ♥ – you can cut with any card" (or "first trick: no cut" when
  `cutsAllowed` is false).

## 10. Edge cases the tests should cover

1. Opening lead: only `AS` legal under `"aceSpades"`; whole hand under `"anyCard"`.
2. Follow suit: off-suit cards are not legal while holding the led suit; void players may play anything.
3. Cut ends the trick immediately; remaining trick players don't play; the highest led-suit card picks up
   all trick cards and leads; `discardCount` unchanged.
4. All follow: trick discarded, highest led-suit card leads; if they are out, next clockwise holder leads.
5. Trick 1 with a void player: discarded (no pick-up) by default; picked up with `firstTrickCut = true`.
6. Player plays last card and is the highest when cut: picks up (default) vs safe with `lastCardSafe`.
7. Cutter playing their last card gets away.
8. Same-trick escapes tie in placement points.
9. Two players left, one empties: the other is Bhabhi, round ends, `isOver` (1 round).
10. Everyone runs out on one trick: `"trickWinner"` vs `"draw"`.
11. Multi-round: `"roundOver"` waits for the host's `nextRound`; losses accumulate; `scoring = "losses"` ranks
    fewest losses first; game over after `rounds` rounds.
