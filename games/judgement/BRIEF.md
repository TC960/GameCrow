# Judgement — lead brief (game id `judgement`)

Source: SPEC.md §V1 GAMES 3. SPEC.md wins on conflict. (setting) = house-rule setting with the stated default.

- Players **3–8**, one deck. (setting `startCards`, default 7, 1–13); `validateSettings` must block starts
  where startCards × players > 52.
- Hand sizes (setting `sequence`): `down` (default: 7,6,…,1) | `downUp` (7…1…7, 1 played once) | `up` (1…7).
- Trump rotates **Spades, Diamonds, Clubs, Hearts** each round; (setting `noTrump`, default off) adds a
  no-trump round after Hearts in the rotation.
- Dealer rotates clockwise each round. Bidding starts left of the dealer, the dealer bids last. Each player
  bids 0..handSize tricks; bids are public as they happen.
- (setting `lastBidderRule`, default on): the last bidder may not bid the number that makes the total of
  bids equal the hand size.
- Play: the player left of the dealer leads the first trick; trick winner leads next. **Must follow suit**;
  if void, any card (setting `mustTrumpWhenVoid`, default off). Highest trump wins, else highest of led suit.
- Scoring per round: exact bid → `exactBonus` (setting, default 10) + `perTrick` (setting, default 1) × bid;
  miss → (setting `missPenalty`): `zero` (default) | `minusBid` | `minusDiff` (minus |bid − won|).
- After each round a summary phase; the **host** taps "Next round". Game ends after the last round;
  highest total wins, ties share rank.
- Hidden info: only your own hand; others see counts, public bids, tricks won, current and last trick.
- Bots: sensible bids (count aces/kings/trumps) and plays (follow suit; win cheaply or dump low).
- UI: trump `SuitBadge`, "Round 3 · 5 cards · Dealer Ravi"; bid with `NumberPicker` (forbidden bid disabled
  and explained); strip subs "Bid 2 · Won 1"; `Trick` in the middle; last trick peek; `Hand` with
  `playable`; round summary with `Scoreboard` per-round columns.
