# Raja Mantri Chor Sipahi — lead brief (game id `rajamantri`)

Source: SPEC.md §V1 GAMES 1. This brief expands it; SPEC.md wins on conflict. Every choice below marked
(setting) must be a house-rule setting with the stated default.

- Players **4–8**. Base roles: Raja 1000, Mantri 800, Sipahi 500, Chor 0 (all four point values are settings).
- 5–8 players: one extra role per extra player, taken in order from: **Rani** (default 900), **Sainik** (300),
  **Daku** (100), **Pandit** (600). Names fixed; points are settings. Extra roles are bystanders: they just
  score their points. Optional special behaviour must be a setting that defaults to off.
- Each round, roles are shuffled and dealt secretly (each player sees only their own, via tap-and-hold).
- **Who guesses** (setting): `mantri` (default) | `sipahi`. The guesser and the Raja are revealed publicly
  (setting "Raja reveals himself", default on). The guesser picks one of the players whose role is still hidden
  as the Chor.
- Scoring per round: correct guess → everyone gets their role's points (Chor 0). Wrong guess (setting
  `wrongGuess`): `swap` (default) = Chor gets the guesser's points and the guesser gets 0 | `zero` = guesser
  gets 0, Chor gets 0 as usual.
- After the guess, all roles are revealed with this round's points; the **host** taps "Next round".
- **Rounds** (setting, default 5, 1–20). Highest cumulative total wins; ties share rank.
- Hidden info: no one may learn another player's hidden role from `viewFor` or `legalActions`
  (e.g. the guesser's legal targets must be ALL hidden players, not filtered). Spectators see only public roles.
- Bots: guesser picks randomly among hidden players.
- UI: `HoldToReveal` + `RoleCard` with an emoji per role (👑 Raja, 🎩 Mantri, 🛡️ Sipahi, 🦹 Chor, 👸 Rani,
  ⚔️ Sainik, 🗡️ Daku, 📜 Pandit); guesser uses `ChoiceList` of players; others see "Mantri is choosing…";
  reveal screen lists every player's role and points; scoreboard with per-round columns.
