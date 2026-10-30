# Bluff (game id `bluff`): brief

Also known as Cheat / "I Doubt It". Category `cards`, 3–8 players, portrait.
Shed all your cards by playing them face down and announcing a rank. You may lie. Anyone you
let get away with a lie gets closer to winning; anyone caught lying picks up the whole pile.

This brief is the source of truth for the test agent and the UI agent. Types are in `types.ts`.

---

## 1. Setup

- Deck: 1 standard 52-card deck, or 2 decks (104 cards, copies carry the `#2` suffix, e.g. `"7H#2"`).
  Setting `decks` (default `"auto"`): `"auto"` = 1 deck for 3–6 players, 2 decks for 7–8; `"1"`; `"2"`.
  No jokers. `state.decks` holds the resolved number (1 or 2).
- The whole deck is shuffled with the seeded RNG and dealt round-robin starting at seat 0
  (`dealAll(deck, n, 0)`), so when it does not divide evenly the lowest seats hold one extra card.
  Example: 3 players, 1 deck: 18/17/17. 5 players: 11/11/10/10/10. 8 players, 2 decks: 13 each.
- Seat 0 leads the first round (the dealer is the last seat; play starts on the dealer's left).
- Phase `"turn"`, `turn = order[0]`, pile empty, nothing discarded, nobody finished, all scores as in §7.

## 2. Turn structure

The game alternates between two phases while it runs:

### Phase `"turn"`: one player (`turn`) acts

Actions (only for `turn`):

- **play** `{ type: "play", cards: Card[], rank: Rank }`: put 1..`maxPlay` cards from your hand face down
  on the pile and claim they are all of rank `rank`.
  - `maxPlay` = `min(settings.maxCards, 4 × decks, cards in your hand)`.
  - Cards must be distinct and all in your hand. `rank` is one of `"2".."9","T","J","Q","K","A"`.
  - Which `rank` is allowed depends on `claimMode` (see §3) and is exposed as `requiredRank` in the view
    (`null` = free choice of any of the 13 ranks).
- **pass** `{ type: "pass" }`: only if `allowPass` is on **and** the current round already has at least
  one play (the round leader can never pass).

After a **play** the game moves to phase `"respond"` (§4). After a **pass**, see §5 (all-pass).

### Phase `"respond"`: the call window on the last play

The cards just played are the **pending claim** (`claim` in the view: who, how many, which rank;
never which cards). Eligible callers (`whoCanCall`):

- `"anyone"` (default): every player who has not finished, except the claimant.
- `"next"`: only the next player in turn order (clockwise, skipping finished players) after the claimant.

Actions (for eligible callers who have not yet declined):

- **call** `{ type: "call" }`: "Bluff!". The first call applied wins the race and resolves immediately (§4).
- **accept** `{ type: "accept" }`: "Believe it" / let it go. That player is done for this window.

Host-only, only when the call timer is off (`callSeconds = 0`) and at least one undecided eligible player
is not the host: **skip** `{ type: "skip" }` closes the window as if everyone left accepted.

Timer (`callSeconds`, default 8): when > 0 the window has a deadline `now + callSeconds × 1000` set on the
play; when it passes the engine sends `@timeout`, which closes the window as if everyone left accepted.
The window also closes as soon as every eligible player has accepted.

`activePlayers` in `"respond"` = eligible players who have not declined (seat order starting after the
claimant). The claimant is never active in their own window.

## 3. Claim modes (`claimMode`, default `"follow"`)

- `"follow"` (default, the Indian style): the round leader (first play of a round) names any rank; every
  later play in the same round must claim that same rank. `requiredRank` = round rank, or `null` for the leader.
- `"free"`: every play may claim any rank (`requiredRank` always `null`). A new round still starts on a
  call or an all-pass.
- `"sequence"` (classic Cheat): one global sequence A, 2, 3, …, 10, J, Q, K, A, 2, …; each play must claim
  the next rank in it. The game starts at A. The sequence advances by one after every **play**
  (not on a pass, not on a call) and never resets.

## 4. Resolving a call

The claimed cards (only those of the last play) are revealed to everyone.

- The claim is **true** iff every revealed card has the claimed rank (any copy / suit).
- False claim: the **claimant** (bluffer) takes the whole pile into their hand. The caller won the challenge.
- True claim: the **caller** takes the whole pile. The claimant won the challenge.
- "The whole pile" = every card on the pile, including the claimed cards and, with `allPass = "keep"`,
  cards left from earlier rounds.
- The round ends. The next round's leader (`afterCall`, default `"winner"`):
  - `"winner"`: whoever won the challenge (caller if it was a bluff, claimant if it was true).
  - `"loser"`: whoever picked up the pile.
  - `"next"`: the next player after the claimant in turn order.
  - If that player has just finished (only possible for a truthful claimant who emptied their hand),
    the leader is the next unfinished player after them.
- `lastCall` in the view is set (public, see §8) and the log gets a `call` entry.
- If the claim was true and the claimant's hand is now empty, the claimant **finishes** (§6) before the
  next round starts.

### Window closes without a call (all accepted, `@timeout`, or host `skip`)

- If the claimant's hand is empty, they **finish** (§6).
- Otherwise nothing happens to the cards; the pile stays.
- The turn passes to the next unfinished player after the claimant, in the same round.

## 5. Passing and the all-pass rule

- `passCount` counts passes since the last play of the round (reset by each play).
- The round ends when every unfinished player other than the round's last claimant has passed in a row
  (if the last claimant has finished, every unfinished player). Then, by `allPass` (default `"discard"`):
  - `"discard"`: the pile is removed from the game (face down, hidden; only the count is public).
  - `"keep"`: the pile stays and carries into the next round (the next caller takes it all).
- The next round is led by the last claimant, or if they finished, the next unfinished player after them.
- With `allowPass` off there is no pass action, so rounds end only by calls.

## 6. Finishing and the end of the game (`endMode`, default `"first"`)

A player finishes when a call window on their play closes with their hand empty (either nobody called,
or someone called and the claim was true). Emptying your hand on a bluff that gets called does not count:
you pick the pile up.

- `"first"` (default): the first player to finish wins and the game ends (`phase = "over"`).
- `"full"`: finished players leave the turn order (skipped as turn, never eligible callers) and play goes
  on; the game ends when at most one player still holds cards. Finish order gives the ranking.

## 7. Scores (`scores(state)`, public, higher is better, `rankScores(totals, true)`)

- A finished player in place `k` (1 = first to finish) scores `n − k` (n = number of players).
- Every other player scores `−(cards in hand)` (0, never −0, for an empty hand awaiting its window).
- So the first finisher is rank 1; unfinished players rank by fewest cards; ties share a rank.
- Example, 4 players, `"first"` mode, p2 finishes, others hold 5/9/5 cards: p2 = 3 (rank 1), p0 = −5 and
  p3 = −5 (rank 2), p1 = −9 (rank 4).
- `"full"`, 4 players, finish order p1, p3, p0, p2 left with 7 cards: p1 = 3, p3 = 2, p0 = 1, p2 = −7.

## 8. Hidden information (`viewFor`)

Never in any view (player or spectator `null`):
- another player's hand (only `handCounts`);
- the pile's cards (only `pileCount`) and the pending claim's cards (only count + claimed rank);
- discarded cards (only `discardCount`).

Visible:
- `myHand`: the viewer's own hand (empty for spectators).
- `lastCall`: the most recent call: caller, claimant, claimed rank, the **revealed cards of the called
  play**, whether the claim was true, who took the pile and how many cards. It stays until the next call
  replaces it. These cards are public; tests checking leaks must treat `lastCall.cards` (and the `cards`
  of `call` log entries) as public, even though they now sit in the taker's hand.
- Public history `log` (last 30 entries): plays (who, count, claimed rank), passes, calls, clears, finishes.
- Everything else in `View` (counts, phase, turn, claim, round info, settings, finish order).

`legalActions` contains only `FREE_TEXT` placeholders for cards, so it leaks nothing.

## 9. Legal actions: the multi-card design

The engine matches actions to `legalActions` entries by deep structural equality, and enumerating every
card subset is impossible (C(40,4) ≈ 91k). But an array template of `FREE_TEXT` strings matches any array
of that many strings. So for each allowed count `k` and each allowed rank `r` there is exactly one entry:

```ts
{ type: "play", cards: [FREE_TEXT, …k times], rank: r }
```

`reduce` then validates the actual cards (strings, distinct, in hand). At most `maxPlay × 13` entries
(≤ 104). The UI derives allowed counts and ranks from these entries:
`legalOfType(legal, "play")` → `cards.length` values and `rank` values. Any card in hand may be selected.

Summary of `legalActions(state, actor)`:

| phase | actor | entries |
|---|---|---|
| turn | `turn` | one `play` per (count 1..maxPlay, allowed rank); `pass` if allowed |
| turn | anyone else | `[]` |
| respond | eligible and undecided | `call`, `accept` (+ `skip` if host, timer off, another undecided eligible exists) |
| respond | host, not undecided-eligible | `skip` if timer off and someone is undecided |
| respond | others | `[]` |
| over | anyone | `[]` |

Unknown ids and spectators always get `[]`.

## 10. House rules (settings)

| key | type | default | values / range |
|---|---|---|---|
| `claimMode` | select | `"follow"` | `follow` / `free` / `sequence` |
| `maxCards` | number | 4 | 1–8 (effective cap `4 × decks`) |
| `whoCanCall` | select | `"anyone"` | `anyone` / `next` |
| `callSeconds` | number | 8 | 0–30 (0 = no timer; host can skip) |
| `allowPass` | boolean | true | |
| `allPass` | select | `"discard"` | `discard` / `keep` (shown only when `allowPass`) |
| `afterCall` | select | `"winner"` | `winner` / `loser` / `next` |
| `endMode` | select | `"first"` | `first` / `full` |
| `decks` | select | `"auto"` | `auto` / `1` / `2` |

No `validateSettings` block (every combination is playable).

## 11. Bots (`botAction`, sees only its own view)

- Respond: always calls when the claim is impossible from its own hand (cards of that rank it holds +
  claimed count > 4 × decks). Otherwise calls with a probability that grows with the claimed count, with
  how many of that rank it holds, and when the claimant would go out (empty hand). Else accepts.
- Turn, rank chosen freely (leader in follow, or free mode): claims the rank it holds most of and plays
  those cards truthfully (up to the cap); sometimes (~20%) slips one extra card in as a bluff.
- Turn, rank forced: plays its real cards of that rank if it has any (sometimes adding one bluff card);
  otherwise bluffs with 1–2 cards (preferring ranks it holds few of) or passes (~45% when passing is allowed).
- Always returns an entry that matches `legal`.

## 12. UI plan (ui.tsx, kit only)

- `top`: `PlayerStrip` with each player's card count as `sub` and badges: "▶" turn, "✓" finished with
  place, "?" undecided in a call window.
- `board` (`TableArea`, label "Round n · claim: 7s" or "Free claim"): the pile as a `CardBack` with
  `count = pileCount`, discard count small; the pending claim in big text ("Ravi: three 7s");
  the reveal of the last call (`lastCall.cards` as face-up `PlayingCard`s, ✓ True / ✗ Bluff, "X takes N
  cards") shown for the newest call; a short scrolling log line.
- `bottom` (thumb zone):
  - Respond phase, eligible: huge `Button variant="primary" size="lg"` **"Bluff!"** and a secondary
    "Believe it", with `Countdown` when `deadline` is set; host sees "Skip waiting" when offered.
  - Turn phase, my turn: `Hand multi` with controlled `selected` (cap at max allowed count; extra taps
    ignored or toast), a rank picker (`ChoiceList` or a row of 13 rank chips, preselected and locked to
    `requiredRank` when it is not null), then `ActionBar` with **"Play N as 7s"** (primary, disabled until
    1..max cards selected and a rank chosen) and "Pass" when legal.
  - Otherwise: `TurnIndicator` and my `Hand` (no selection).
- Disable buttons while `pending`. Spectators see the public board only.
