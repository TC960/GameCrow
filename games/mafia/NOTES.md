# Mafia: rules notes

Spec: `BRIEF.md`. Types: `types.ts`. Plugin: `rules.ts`.

## House-rule settings

| key | label | default | options / range | effect |
|---|---|---|---|---|
| `mafiaCount` | Mafia | 0 (Auto) | 0–5 | 0 = Auto: 1 for 5–6 players, 2 for 7–9, 3 for 10–12, 4 for 13–16 (`autoMafiaCount`). Start is blocked if `2 × mafia ≥ players`. |
| `doctors` | Doctors | 1 | 0–2 | Number of Doctors. Each protects independently. |
| `detectives` | Detectives | 1 | 0–2 | Number of Detectives. Each sees only their own results. Start is blocked if Mafia + Doctors + Detectives > players. |
| `killRule` | Mafia must agree | `unanimous` | `unanimous`, `majority`, `first` | `unanimous`: all living Mafia must pick the same victim; when all have picked and disagree they may re-pick. `majority`: most picks wins, ties random. `first`: the first Mafia pick decides; teammates can only confirm it. |
| `selfProtect` | Doctor can protect themself | `always` | `always`, `once`, `never` | Whether a Doctor may pick themself (`once` = once per game). |
| `repeatProtect` | Doctor can protect the same player two nights in a row | off | boolean | Off: the player a Doctor protected last night (if they acted) is not a legal pick tonight. |
| `detectiveResult` | Detective learns | `team` | `team`, `role` | `team`: "mafia"/"village". `role`: the exact role. |
| `startWith` | Game starts with | `night` | `night`, `day` | `day`: Day 1 discussion + vote before the first night. |
| `revealOnDeath` | When someone dies, reveal | `role` | `role`, `team`, `none` | Public reveal of killed and voted-out players. |
| `deadSeeRoles` | Dead players see everyone's role | off | boolean | On: a dead player's view gets `allRoles`. |
| `voteRule` | Vote someone out with | `plurality` | `plurality`, `majority` | `majority`: needs more than half of the living players. |
| `tieRule` | Tied vote | `none` | `none`, `random` | Plurality only: a tie between players eliminates nobody, or one of them at random. |
| `allowAbstain` | Allow a "No elimination" vote | on | boolean | Adds the `abstain` vote. |
| `voteVisibility` | After the vote show | `open` | `open`, `tally` | `open`: who voted for whom (`lastVote.ballots`). `tally`: totals only. |
| `nightTimer` | Night timer | 0 (off) | 0–300 s, step 15 | Night ends when it fires, with the picks made so far. |
| `discussionTimer` | Discussion timer | 0 (off) | 0–900 s, step 30 | Day moves to the vote when it fires. |
| `voteTimer` | Vote timer | 0 (off) | 0–300 s, step 15 | Vote closes when it fires; non-voters don't count. |

## Rule decisions

- **Everyone acts at night.** Villagers pick a "suspect" (no effect) using the same `{type:"night", target}`
  action as every role, so `activePlayers`/`nightDone` (public) never reveal who has a night role, and every
  phone does the same thing. Picks are final, except Mafia re-picks under `unanimous` (only once all living
  Mafia have picked and they disagree; locked again once they agree). This keeps bot simulations from looping.
- **Mafia coordination** is silent, via the app: living Mafia see teammates' current picks (`teamPicks`).
  Mafia can't target fellow Mafia. There is no "no kill" option.
- **Unanimous stall:** while Mafia disagree after everyone has acted, `activePlayers` is `[]` (listing them would
  expose them); their own view shows the disagreement. The host's `advance` / the night timer resolves it:
  no kill unless the picks made so far all agree.
- **Forced night end** (host `advance` or `@timeout`) uses only the picks made so far; a non-acting doctor protects
  nobody and their repeat restriction clears; `majority` breaks ties with the seeded rng; `first` uses the first pick.
- **Detective results are immediate** (recorded when the detective acts, even if they die that night) and stay
  in the detective's view for the rest of the game, also after death.
- **Save** = the Mafia target was picked by any living doctor tonight. Saves are never announced; the report just
  says nobody died. At most one death per night.
- **Plurality vote** treats "No elimination" as a candidate: it wins outright → nobody; it ties the top player → nobody
  (reason `tie`, regardless of `tieRule`). `tieRule` only breaks ties between players. Majority needs
  `floor(L/2)+1` votes of the `L` living players; non-voters and abstains count against.
- **Votes** are final and hidden (only "has voted" booleans) until the vote resolves.
- **Win check** only after a night resolves and after a vote resolves. Village: no living Mafia. Mafia: living Mafia
  ≥ living non-Mafia. The game goes straight to `over` (no verdict screen) when someone wins; `lastNight` /
  `lastVote` still describe the final event.
- **Scores:** every member of the winning team (alive or dead) scores 1, others 0 (0 for everyone mid-game).
- **Host:** one host-only `advance` in every phase but `over`, alive or dead, which does exactly what that phase's
  timer would do. `roles` (Ready) and `verdict` have no timer, by design: the host taps through them.
- **Spectators** and **dead players** see public info; dead players also keep their own secrets (role, team,
  detective results) and get `allRoles` only with `deadSeeRoles`. Dead players have no actions.
- **No leaks by construction:** the public part of `View` (everything except `myRole`, `amAlive`, `nightTask`,
  `team`, `teamPicks`, `myNightPick`, `investigations`, `myLastProtected`, `selfProtectUsed`, `iVoted`, `myVote`,
  `allRoles`) is identical for every viewer and the spectator. Every role map is `Record<PlayerId, Role>`, so
  `findLeaks(view, ['"pX":"mafia"'])` catches a leaked role.
- **Bots:** Ready at once; Mafia copy a teammate's pick (so unanimous converges); Detectives investigate new players
  and vote out known Mafia; Mafia vote non-teammates; nobody abstains. Bot games (5/9/16 players, 40 seeds) end in
  ≤ ~220 steps.

## Self-check done (fleet rules agent)

`npx tsc --noEmit` clean. A temporary smoke test (deleted) ran full bot games at 5, 9 and 16 players for 6
setting combinations × 4 seeds plus `simulateGame`, checked at every step that the public view part is identical
for all viewers and the spectator, that `team`/`teamPicks`/`investigations`/`allRoles` are empty/null for
non-entitled viewers, and `findLeaks` with `"pX":"role"` pairs on every view and legal list; plus scenario
checks (unanimous disagreement re-pick, doctor save, detective result, `first` confirm, all three timers,
host-only `advance`, `validateSettings` messages).

## ENGINE REQUESTS

None.
