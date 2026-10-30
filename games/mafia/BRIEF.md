# Mafia — fleet brief (game id `mafia`, category `party`)

Source: SPEC.md BACKLOG ("Mafia") + ENGINE_CONTRACT.md. This brief is the precise spec the rules, test and UI
agents build against. SPEC.md / the contract win on conflict. Everything marked **(setting)** is a house rule
with the stated default; the full table is in NOTES.md.

The app is the narrator. Players sit together and talk in person; phones hold the secret roles, take the
night actions and the votes, and announce results.

## 1. Players and roles

- **5–16 players** (`meta.minPlayers = 5`, `maxPlayers = 16`).
- Roles: `mafia`, `doctor`, `detective`, `villager`. Teams: `mafia` = the Mafia; everyone else = the village
  (`doctor`, `detective`, `villager`).
- Counts, fixed at setup:
  - Mafia **(setting `mafiaCount`, 0–5, default 0 = Auto)**. Auto (`autoMafiaCount(n)` in types.ts):
    5–6 players → 1, 7–9 → 2, 10–12 → 3, 13–16 → 4.
  - Doctors **(setting `doctors`, 0–2, default 1)**; Detectives **(setting `detectives`, 0–2, default 1)**.
  - Everyone else is a Villager (may be 0).
- `validateSettings` blocks the start when: Mafia count `m` (after Auto) has `2m >= n` ("Too many Mafia for
  N players": the Mafia would already have won), or `m + doctors + detectives > n` ("Not enough players
  for these roles"). Auto never fails for 5–16 with the default doctor/detective counts.
- Setup shuffles the roles with the seeded RNG. The starting role counts (`roleCounts`) are public.

## 2. Phases and flow

```
roles ──(all ready | host advance)──▶ night or day (setting startWith, default night)
night ──(everyone acted & Mafia resolved | host advance | timer)──▶ day   (or over)
day   ──(host advance | discussion timer)──▶ vote
vote  ──(all living voted | host advance | timer)──▶ verdict (or over)
verdict ──(host advance)──▶ night
```

`nightNo` counts nights entered, `dayNo` counts days entered (both start at 0; entering a phase adds 1).
With `startWith: night` it is Night 1 → Day 1 → Night 2 …; with `startWith: day` it is Day 1 → Night 1 → Day 2 ….

### roles
Every player (all alive) privately sees their role. Each taps **Ready** (`{type:"ready"}`, once). Mafia also
see who the other Mafia are from this moment on. When every player is ready, or the host sends
`{type:"advance"}`, the first phase starts.

### night
- **Every living player acts exactly once** with the same action shape `{type:"night", target}`, so the
  public "who is done" list (`nightDone`, `activePlayers`) reveals nothing about roles. Legal targets:
  - **Mafia** (task `kill`): any living non-Mafia player.
  - **Doctor** (task `protect`): any living player, minus self when self-protection is not allowed
    **(setting `selfProtect`: `always` (default) | `once` (once per game) | `never`)**, minus the player this
    doctor protected the previous night unless **(setting `repeatProtect`, default false)**. "Previous night"
    means the immediately preceding night; a night where the doctor did not act clears the restriction.
  - **Detective** (task `investigate`): any living player except self. The result is recorded **immediately**
    and only this detective sees it: **(setting `detectiveResult`: `team` (default) → `"mafia"` or `"village"` |
    `role` → the exact role)**. Results persist for the whole game in that detective's view (also after death).
  - **Villager** (task `suspect`): any living player except self. It has no effect (it is a decoy so every
    phone does the same thing at night). It is never shown to anyone else.
- A night pick is final, except for Mafia under `unanimous` (below).
- **Mafia agreement (setting `killRule`)**, default `unanimous`:
  - `unanimous`: the kill needs every living Mafia member to pick the same target. Living Mafia see their
    teammates' current picks live (`teamPicks`). When **all living Mafia have picked and they disagree**, each
    of them may re-pick (legal: every valid kill target except their current pick). Before that (a teammate
    still to pick) and after they agree, a Mafia pick cannot change.
  - `majority`: each living Mafia member picks once; the most-picked target dies; a tie is broken at random
    (seeded `ctx.rng`, among the tied players).
  - `first`: the first Mafia pick of the night is the team's target. Once it exists, any Mafia member who has not
    yet acted has exactly one legal night action: that same target (a "confirm").
- **The night ends** as soon as every living player has a night pick and (for `unanimous`) all living Mafia
  picks are equal. It also ends when the host sends `advance` or the night timer fires (`@timeout`), using only
  the picks made so far:
  - `unanimous`: kill if at least one Mafia picked and all Mafia picks made so far name the same target; else no kill.
  - `majority`: most-picked among the picks made (tie random); no picks → no kill.
  - `first`: the first pick, if any.
  - A doctor who did not act protects nobody (and their repeat restriction clears); a detective who did not act
    learns nothing.
- **Resolution**: if the Mafia target was protected by any doctor's pick this night, nobody dies. Otherwise the
  target dies. At most one death per night. Doctors' picks are recorded as their "last protected" and `once`
  self-protection is used up when a doctor picks themself.
- Then the win check (§4); if nobody has won → `day`.

### day (discussion)
- Everyone sees the night report `lastNight = { night, deaths }` ("P3 was killed" or "Nobody died"; saves
  are never announced as such). A dead player's role is made public per **(setting `revealOnDeath`: `role`
  (default) | `team` (shows `"mafia"` or `"village"`) | `none`)**. The same reveal rule applies to day eliminations.
- Players talk in person. Nothing to send. The host taps **Start vote** (`advance`), or the discussion timer
  fires → `vote`.
- With `startWith: day`, Day 1 has `lastNight = null`.

### vote
- Each living player votes once: `{type:"vote", target}` for any other living player (not self), or
  `{type:"abstain"}` ("No elimination") when **(setting `allowAbstain`, default true)**. Votes are final.
  While voting, only *who has voted* is public (`voted`), never for whom.
- The vote closes when every living player has voted, or on host `advance` / vote timer (non-voters count as
  not voting).
- **Elimination rule (setting `voteRule`)**, default `plurality`. Let `top` = the highest number of votes on a
  single player, `abstains` = number of `abstain` votes, `L` = living players at the vote:
  - `plurality`: `top == 0` → nobody (reason `noVotes`); `abstains > top` → nobody (`abstain`);
    `abstains == top` → nobody (`tie`); several players tied at `top` → **(setting `tieRule`: `none` (default)
    → nobody, reason `tie` | `random` → one of the tied players at random)**; otherwise the single top player.
  - `majority`: the player with **more than half of `L`** (`top >= floor(L/2)+1`) is eliminated; otherwise
    nobody (`noMajority`). `tieRule` does not apply.
- The result `lastVote = { day, eliminated, reason, tally, abstains, ballots }` is public. `tally` (votes per
  player with ≥1 vote) and `abstains` always; `ballots` (voter → target, `null` = abstain; non-voters
  absent) only when **(setting `voteVisibility`: `open` (default) | `tally` → `ballots` is `null`)**.
  `reason` ∈ `eliminated | noVotes | abstain | tie | noMajority`.
- Eliminated → dead, reveal per `revealOnDeath`. Win check (§4); if nobody has won → `verdict`.

### verdict
Everyone sees the vote result. The host taps **Next night** (`advance`) → `night`.

### over
Terminal. `winner` is set; **all roles become public** (`allRoles` for every viewer, spectators included).

## 3. Host controls and timers

- Host-only `{type:"advance"}` is legal in `roles`, `night`, `day`, `vote` and `verdict` (never in `over`),
  whether the host is alive or dead. It only moves the game forward exactly as the timer would; it never picks
  a target or vote for anyone.
- Timers **(settings, seconds, 0 = off, default 0 each)**: `nightTimer` (0–300, step 15),
  `discussionTimer` (0–900, step 30), `voteTimer` (0–300, step 15). When a timed phase is entered,
  `phaseEndsAt = ctx.now + seconds*1000`; `deadline(state)` returns it (`null` in untimed phases, `roles`,
  `verdict` and `over`). `@timeout` behaves exactly like host `advance` for that phase.
- Bots are never host; the shell's "End game" covers abandoned games.

## 4. Win conditions and scoring

- Checked after every night resolution and every vote resolution (and only then):
  - **Village wins** when no Mafia is alive.
  - **Mafia wins** when living Mafia ≥ living non-Mafia.
- `scores`: before the end everyone has 0. At the end every member of the winning team (alive or dead) scores
  **1**, everyone else 0; `rankScores` (winners rank 1, losers rank 2).

## 5. Hidden information (viewFor / legalActions)

What each viewer gets (field names from types.ts `View`):

| info | who sees it |
|---|---|
| own role (`myRole`, `nightTask`) | that player (alive or dead); spectators `null` |
| Mafia membership (`team`: all Mafia ids incl. self) | Mafia players only (alive or dead); `[]` for everyone else |
| teammates' current night picks (`teamPicks`) | living Mafia, during `night` only; `null` otherwise |
| own night pick (`myNightPick`) | that player, during `night` |
| detective results (`investigations`) | that detective only; `[]` for everyone else |
| doctor's last protection / self-protect used (`myLastProtected`, `selfProtectUsed`) | that doctor only |
| who has acted at night / voted (`nightDone`, `voted`, `ready`) | everyone (booleans only) |
| own vote (`myVote`, `iVoted`) | that player |
| dead players' revealed roles (`revealed`) | everyone, per `revealOnDeath` |
| all roles (`allRoles`) | everyone in `over`; a **dead** player before that only if **(setting `deadSeeRoles`, default false)** |
| night report, vote results, log, alive map, settings, role counts | everyone |

Never in any view or legal list of a player who isn't entitled: another living player's role, which players are
Mafia, any night pick, whom the doctor protected, any detective result, any ballot before the vote resolves.
Legal action lists are private but must not reveal more than the player's own view (e.g. a Mafia player's
kill list excludes teammates, which they already know; a villager's list is "every living player but me").
Role values appear only in `myRole`, `revealed`, `allRoles`, `investigations` (and `nightTask`, which is
derived from `myRole`); every role map is a `Record<PlayerId, …>`, so a leak test can search a view's JSON for
the pair string `"pX":"mafia"` (via `findLeaks(view, ['"pX":"mafia"'])`) and check `team`, `teamPicks`,
`investigations`, `allRoles` per viewer. Note that role names also appear harmlessly as keys of `roleCounts`
and in `settings`, so searching for a bare role string is not a valid leak test.

Spectators (`viewFor(state, null)`) see only public info. Dead players see the public info plus their own
secrets (and `allRoles` only with `deadSeeRoles`). Dead players have no legal actions (except a dead host's
`advance`).

## 6. activePlayers

`roles`: players not ready. `night`: living players without a night pick. `vote`: living players who haven't
voted. `day`, `verdict`, `over`: `[]` (waiting on the host). Mafia re-picking under `unanimous` are not listed
(listing them would reveal them); their own view tells them to agree.

## 7. Bots (`botAction`, own view only)

- `ready` immediately.
- Night: Mafia copy a teammate's existing pick when it is legal (so `unanimous` converges), else a random legal
  target. Detectives prefer living players they have not investigated. Doctors and villagers pick at random.
- Vote: a detective votes a living player it knows is Mafia; Mafia vote a random non-teammate; everyone else
  votes a random other player. Bots never abstain.
- Bot games must finish for 5–16 players under every setting combination (nights keep killing, so they do).

## 8. UI plan (360–430px portrait, kit only)

`GameScreen` with `top` = `PlayerStrip` (dead players dimmed with a 💀 badge and their revealed role emoji; `✓`
badge for "acted/voted/ready" in the current phase), `board` = phase content, `bottom` = `TurnIndicator` +
`ActionBar`.

- **Role card everywhere**: a `HoldToReveal label="Hold to see your role"` wrapping `RoleCard` (emoji + name +
  one-line goal; for Mafia also "Your team: …"; for a detective the result list; for a doctor the last
  protection). Never shown un-held. It is available in every phase (collapsed at the bottom of the board).
- **roles**: big "Your secret role" HoldToReveal; primary `Ready` button; "N of M ready".
- **night: identical for everyone at rest.** Dark full-board panel: 🌙 "Night N — close your eyes",
  "Hold below to take your night action", the same `HoldToReveal` box for every role and dead players too
  (dead: "You're out. Stay quiet."). Inside, a `ChoiceList` of players with a role-specific short prompt
  ("Choose a victim" / "Choose who to protect" / "Choose who to investigate" / "Who do you suspect?"); for
  Mafia each option shows teammates' picks as a sub-label; the detective's result is shown inside the held
  area only. Use the same layout, same number of rows where possible, the same button label (`Confirm`) and the
  same "Done ✓ — wait for morning" message after acting, so a glance at any phone reveals nothing. The
  `Countdown` (if timed) and the host's `End night` (behind a confirm) are the only extras. No haptics at night
  other than the shell's turn haptic (which everyone gets).
- **day**: ☀️ BigStatus with the night report ("P3 was killed — they were the Doctor" / "Nobody died"),
  living players list, log of earlier days (collapsed), `Countdown`; host `Start vote` primary button.
- **vote**: `ChoiceList` of living players (not self) + "No elimination" option (if allowed); `Vote` primary;
  after voting "You voted for X"; "K of L voted"; host `Close vote`.
- **verdict**: tally list (and who voted whom when `open`), the eliminated player's reveal; host `Next night`.
- **over**: winner banner ("The village wins" / "The Mafia wins"), every player with role emoji.
- Spectators (`me === null`): public view, no controls. Dead players: same as spectators plus their role card
  (and all roles if `allRoles` is present), with an "You're out — no talking" banner.
- Role emojis (`ROLE_INFO` in types.ts): 🔪 Mafia, 💉 Doctor, 🔎 Detective, 🧑‍🌾 Villager; team reveal
  🔪 Mafia / 🏘️ Village. Never colour alone: always text + emoji.
