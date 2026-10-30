Build "GameCrow": a mobile-first multiplayer card & party game suite for playing with friends. Use this message as the spec; save it to SPEC.md in the repo first.

STACK
- Vite + React + TypeScript, Convex backend (realtime), deploy frontend to Vercel from this GitHub repo
- No accounts: join a room with a 4-letter code + nickname. Host starts games and controls rounds. Refresh = rejoin same seat.

ENGINE
- Each game is a plugin folder: games/<name>/rules.ts + ui.tsx
- rules.ts exports: setup(players, settings), legalActions(state, playerId), reduce(state, action) -> state (pure, deterministic, seeded RNG), viewFor(state, playerId) -> only what that player may see, isOver/scores
- All reduce() calls run server-side in Convex mutations. Clients never receive other players' hidden cards or roles. Validate every action server-side.
- Per-room "house rules" settings per game, editable by host before start.
- Shared UI kit: hand (card fan), card back, table area, turn indicator, scoreboard, role reveal (tap-and-hold).
- Adding a new game must require zero engine changes.

V1 GAMES
1. Raja Mantri Chor Sipahi: 4 hidden roles. Raja 1000, Mantri 800, Sipahi 500, Chor 0. Mantri guesses the Chor; wrong guess = Chor takes Mantri's points. Settings: extra roles for 5-8 players (e.g. Rani, Sainik, Daku) with configurable points, who guesses, number of rounds.
2. Badam Satti / Sevens: deal full deck. Holder of 7 of hearts starts. Play a 7 to open a suit, or extend an open suit up/down by one rank. Must play if able, else pass. First to empty hand wins.
3. Judgement: hand size 7 -> 1 (configurable, incl. back up); trump rotates spades, diamonds, clubs, hearts (+ optional no-trump). Everyone bids tricks; last bidder can't make total equal hand size (toggle). Must follow suit. Exact bid = 10 + bid, else 0 (configurable).
4. Psych: show a prompt (trivia with a real answer, or "about a player" mode). Everyone writes a fake answer; answers shown shuffled and anonymous; everyone votes. +1 per vote your answer gets, +2 for picking the real answer.

BACKLOG (engine must fit these later): Imposter, Mafia, Joker (draw blind from neighbour's hand, discard pairs, last holding the joker loses), Bluff, Get Away (Bhabhi), Hearts, Teen Do Paanch, Rummy 10 & 13 card (needs meld validator), Uno-style, Codenames-style, Heads Up (tilt via DeviceOrientation; request iOS permission on a Start tap).

RULES
- Original names/art for anything trademarked (Uno, Codenames, Heads Up).
- Ambiguous rule -> make it a house-rule setting, list it in the README.
- Unit tests for every rules.ts (legal moves, scoring, follow-suit, end conditions, viewFor never leaks hidden info).

MOBILE-FIRST UI
- Design for 360-430px portrait; desktop = centered phone-width column.
- 100dvh + env(safe-area-inset-*) padding.
- Hand and primary actions (Play, Bid, Pass, Submit) in the bottom third; board in the middle; opponents/scores compact at top.
- Tap targets >= 44px, no hover-only interactions. Tap card to select, tap again or Play to confirm.
- Big hands: overlapping, horizontally scrollable fan, auto-sorted, sort toggle; selected card lifts.
- Hidden info revealed by tap-and-hold only.
- Wake Lock during games; haptics + clear "your turn" state.
- Landscape usable or a "rotate your phone" prompt.
- Inputs stay above the keyboard; font-size >= 16px (no zoom on focus).
- Dark mode default with light toggle; colorblind-safe suits (color + symbol).
- PWA: manifest, icons, standalone, offline shell, one-time iOS "Add to Home Screen" hint.

AGENT ORCHESTRATION
Phase 1, lead agent only: build engine, lobby, shared UI kit, GamePlugin interface. Write ENGINE_CONTRACT.md, then freeze it. Game agents may not modify engine/ or shared UI; they report needed engine changes to the lead.
Phase 2, one fleet per V1 game in parallel, each in its own git worktree/branch (game/<name>), touching only games/<name>/ and tests/<name>.test.ts:
- Rules agent writes rules.ts from the spec.
- Test agent writes tests from the spec without reading rules.ts first; iterate until green.
- UI agent builds ui.tsx with the shared kit.
- Reviewer agent (fresh context) checks against the spec and contract, simulates a full game with bot players via reduce(), and checks screens at 375x667 and 412x915.
Phase 3, lead integrates: merge each branch after tests + review pass, register in lobby, deploy, add README entries with house-rule settings.

Start Phase 1 now. Ask me only for things you can't decide, like Convex/Vercel login steps.
