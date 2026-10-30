# Brain Tilt — rules notes

Original forehead-guessing party game (`braintilt`, party, 2–12 players, `orientation: "any"`).
Full spec: `BRIEF.md`. Files: `types.ts` (public types + `DECKS` labels), `decks.ts` (8 × 40 words,
server-only, imported only by `rules.ts`), `rules.ts`.

## House rules

| key | label | default | range / options |
|---|---|---|---|
| `roundSeconds` | Seconds per round | 60 | 30–180, step 15 |
| `getReadySeconds` | Get-ready countdown | 3 | 0–10 (0 = no countdown phase) |
| `turnsEach` | Turns per player | 1 | 1–3 |
| `cardsPerRound` | Cards per round | 30 | 10–50, step 5 |
| `decks` | Decks | all 8 | animals, food, home, characters, sports, places, actions, nature (min 1) |
| `othersSeeWord` | Show the word on describers' phones | on | |
| `guesserScreen` | Guesser's phone | `forehead` | `forehead` / `hidden` |
| `passCostsPoint` | Each pass costs 1 point | off | |
| `scoring` | Scoring | `solo` | `solo` / `teams` |
| `teamCount` | Number of teams | 2 | 2–4 (teams only) |

`validateSettings` blocks: teams with fewer than 2 players per team; `guesserScreen = hidden` with
`othersSeeWord` off (nobody would see the word).

## Rule decisions

- **Phases** `ready → countdown → playing → ready… → over`. The guesser taps Start (the tap that requests tilt
  permission on iOS); the get-ready countdown and the round timer are both `deadline` + `@timeout`.
  `endsAt = max(startsAt, now) + roundSeconds`, so a late scheduler never shortens the round.
- **No separate summary phase.** The previous round (`lastRound`, with words) is shown on the next guesser's
  ready screen, so nobody has to tap "next". The final round goes straight to `over`.
- **Host control:** host can `skipTurn` in `ready` (absent/slow guesser); the guesser can skip their own turn.
  While playing nobody but the guesser acts; the timer guarantees progress.
- **Double-tilt guard:** `mark` carries `wordNo`; a stale mark no longer matches `legalActions` and is rejected.
- **Late mark:** a mark applied at `now >= endsAt` ends the round as a timeout and is ignored.
- **Time-up word** is recorded as `"timeout"` (no points, no penalty).
- **Card stack per round** (`cardsPerRound`, default 30): bounds state size and lets bot rounds finish
  (bots mark instantly in `simulateGame`, where time only moves when nobody can act). Running out ends the round.
- **Word reuse:** words become "used" when shown; a word repeats only after the whole pool was shown and,
  when the pool allows, never in the round right after it was seen (so `lastRound` never overlaps the secret stack).
- **History in the view** keeps only per-round summaries; only `lastRound` carries words.
- **Spectators never see the current word** (a late-joining device could be the guesser's own). Resolved words
  of the round in progress are public.
- **Teams:** team = `seat % teamCount`; teams alternate and each team gets `turnsEach × largest team` turns, so
  turn counts are equal across teams. Each player's score line is their team's total. Teammates are
  "describers", other teams are "watchers" (they also see the word if `othersSeeWord`, to referee).
- **Scoring:** +1 per correct word to the guesser (solo) or the guesser's team (teams); optional −1 per pass;
  totals can be negative with the pass penalty.
- **Decks:** 8 original decks of 40 family-friendly words (no brands, people or titles), unique across decks
  and with no word a case-insensitive substring of another (keeps `findLeaks` exact).
- **Bots:** always start, then mark correct 60% / pass 40%.

## ENGINE REQUESTS

1. *(nice to have, not blocking)* **Per-phase orientation.** `meta.orientation` is static, so the game uses
   `"any"` and shows its own "turn your phone sideways" hint on the forehead screen. Smallest API: optional
   `GamePlugin.orientationFor?(view): "portrait" | "landscape" | "any"` (or a `view.orientation` convention) that
   the shell uses instead of `meta.orientation` for the rotate prompt.
2. *(nice to have, not blocking)* **Landscape lock for the forehead screen.** A kit helper
   `requestLandscape(): Promise<boolean>` (fullscreen + `screen.orientation.lock("landscape")`, silently failing
   on iOS) that `ui.tsx` can call from the same Start tap, and a matching `releaseOrientation()`.
