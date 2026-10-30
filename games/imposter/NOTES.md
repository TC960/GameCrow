# Imposter: rules-agent notes

Files: `BRIEF.md` (the spec), `types.ts` (public types + constants), `words.ts` (server-only word lists,
10 categories × 24 words, imported by `rules.ts` only), `rules.ts` (the plugin).

## Settings (house rules)

| key | default | options / range | group |
|---|---|---|---|
| `rounds` | 5 | 1–20 | Game |
| `imposterCount` | `auto` (1 for 4–7 players, 2 for 8–12) | auto, 1, 2, 3 | Game |
| `impostersKnow` | false | boolean (shown when 2+ imposters possible) | Game |
| `imposterHint` | `category` | category, nothing | Game |
| `imposterPick` | `random` | random, fair (least-picked first) | Game |
| `categories` | all 10 built-in | multiselect, min 1, plus `custom` | Words |
| `customWords` | `""` | text ≤ 1000, comma/newline separated, min 3 if `custom` selected | Words |
| `clueRounds` | 2 | 1–3 | Clues |
| `firstClue` | `rotate` | rotate (one seat per round), random | Clues |
| `oneWordClues` | true | boolean | Clues |
| `uniqueClues` | true | boolean | Clues |
| `blockSecretWord` | true | boolean (crew only) | Clues |
| `discussion` | true | boolean (host-ended discussion phase) | Voting |
| `tieRule` | `revote` | revote (once, among tied), escape, random | Voting |
| `revealVotes` | true | boolean | Voting |
| `lastChanceGuess` | true | boolean | Voting |
| `guessMode` | `choice` | choice (8 words), text | Voting |
| `crewWinPoints` | 1 | 0–10 | Scoring |
| `correctVoteBonus` | 0 | 0–5 | Scoring |
| `imposterEscapePoints` | 2 | 0–10 | Scoring |
| `imposterStealPoints` | 2 | 0–10 | Scoring |
| `clueSeconds` | 0 (off) | 0–120 step 5 | Timers |
| `discussSeconds` | 0 (host decides) | 0–300 step 15 | Timers |
| `voteSeconds` | 0 (off) | 0–180 step 5 | Timers |
| `guessSeconds` | 0 (off) | 0–120 step 5 | Timers |

`validateSettings`: blocks `2 × imposters >= players` and `custom` with fewer than 3 custom words.

## Rule decisions

- **One accusation per round, team outcome.** Even with 2–3 imposters the table accuses one player.
  Catching any imposter is a crew win (unless the caught one steals with the guess). Points go to the whole
  winning team. Simple to explain and keeps big games moving.
- **Votes are final** and you can't vote for yourself. Imposters vote too (otherwise the vote screen
  would reveal them). Missing votes at close/timeout are abstentions. A ballot where nobody voted means
  nobody is accused (imposters escape), never a revote.
- **Revote happens at most once**; a second tie means the imposters escape.
- **Secret-word clue block is crew-only**: rejecting an imposter's clue would reveal the word to them.
  Words shorter than 3 letters (custom only) are blocked on exact match only.
- **Choice guess (default)**: 8 shuffled words from the same category, stored in state when the guess
  phase starts and public during it. Typing on a phone under pressure was judged worse; `text` mode
  remains for purists and matches case/accents/punctuation-insensitively with a trailing s/es allowed.
- **Host skips count as "no clue" / "no guess"** (the guess then fails, crew wins). That's the same as a
  timeout; the host never picks an outcome directly.
- **Discussion phase is host-ended** (or timed) because the game is played in the same room. Nobody is
  "active" there, so no "your turn" buzz.
- **Reveal for every round, including the last**: the host's `nextRound` after the last reveal ends the
  game, so the table sees the final reveal before the results sheet.
- **Words don't repeat within a game.** When a (custom) pool runs out the used-list resets, avoiding the
  previous round's word if possible.
- **Category labels are public** (`CATEGORIES` in `types.ts`); the words are server-only. Custom words
  live in the settings, which every player can read in the lobby; `view.rules` drops `customWords`, but
  with `custom` selected an imposter effectively knows the candidate list. Documented in the setting help.
- **Leak-test friendliness**: no built-in word is a substring of another word, a category label, a view
  field name or a bot clue (checked during development), so `findLeaks` gives no false positives.
- Not implemented (possible later settings): "undercover" variant where the imposter gets a decoy word
  and doesn't know their role; changing votes before the ballot closes; multiple accusations per round.

## Bots

Bots give a random generic one-word clue from `BOT_CLUES` (not already said this round; crew bots skip
any that would contain the word), vote randomly, and guess randomly among the options (text mode: echo one
of the round's clues). Verified with `simulateGame` at 4, 8 and 12 players across non-default setting
combinations (discussion off, every tie rule, text guesses, no hint, no last guess, hidden votes, fair
pick, random first clue, 1 and 3 clue rounds, custom-only words, all timers, 2–3 imposters).

## Self-check done

`npx tsc --noEmit` clean. A temporary smoke test (deleted) covered simulateGame at 4/8/12 players × 6
setting combos × 4 seeds, determinism, schema lint, validateSettings, clue validation errors, the
scoring example from the brief, revote + vote timeout + clue timeouts, guess matching, and leak checks
for every viewer (incl. spectator) after every step in every phase (word, category in no-hint mode,
role fields, open votes, hidden votes after reveal). All phases were reached.

## ENGINE REQUESTS

None.
