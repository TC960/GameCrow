# Badam Satti / Sevens — lead brief (game id `badamsatti`)

Source: SPEC.md §V1 GAMES 2. SPEC.md wins on conflict. (setting) = house-rule setting with the stated default.

- Players **3–8**, one 52-card deck, **dealt entirely** round-robin (some players get one extra card).
- The holder of **7♥** starts. (setting `firstCard7H`, default on): the very first card played must be the 7♥.
- A suit opens when its 7 is played. Then it extends one rank at a time downward (6, 5, … A) and upward
  (8, 9, … K). Ace is low (A sits below 2) (setting `aceHigh`, default off: when on, Ace may instead go above K;
  the agent decides the cleanest rule and documents it).
- On your turn you **must play if able**, else pass (setting `allowPassWhenAble`, default off).
- **First to empty their hand wins** the round. (setting `playToEnd`, default off): keep playing until only one
  player has cards, to rank everyone.
- (setting `rounds`, default 1, 1–10): with more than one round, each player's penalty = cards left in hand
  at round end; lowest total penalty wins. The next round's dealer/start rotates naturally via 7♥.
- Scores: rank by finishing order (and penalties for multi-round). Ties share a rank.
- Hidden info: hands are secret; others see only counts. Passing reveals nothing beyond "passed".
- Bots: a legal play (prefer not opening sevens / not extending toward cards that only help others is optional).
- UI: board with four suit rows (♠ ♥ ♣ ♦) showing the played range compactly (low end, 7, high end, plus
  empty `CardSlot`s for the next playable ranks); `Hand` with `playable` from `legal`; a big **Pass** button only
  when passing is legal; opponents strip with card counts; log line "Ravi played 8♠".
  Hands can be 17+ cards: the kit `Hand` scrolls; verify it at 375px.
