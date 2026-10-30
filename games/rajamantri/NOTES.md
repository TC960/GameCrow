# Raja Mantri Chor Sipahi: rules notes

## House-rule settings

| key | label | default | options / range | effect |
|---|---|---|---|---|
| `rounds` | Rounds | 5 | 1–20 | Number of rounds. After the last round's reveal, the host's "Next round" ends the game. |
| `guesser` | Who guesses the Chor | `mantri` | `mantri`, `sipahi` | Which role must find the Chor. That player is revealed to everyone at the start of the round. |
| `revealRaja` | Raja reveals himself | on | boolean | On: the Raja is public each round and can't be accused. Off: the Raja stays hidden and is a possible (wrong) target. |
| `wrongGuess` | Wrong guess | `swap` | `swap`, `zero` | `swap`: the Chor scores the guesser's role points and the guesser scores 0. `zero`: the guesser scores 0 and the Chor scores the Chor's points as usual. |
| `guessSeconds` | Guess timer (seconds) | 90 | 0–300, step 15 (0 = off) | Time the guesser has to accuse. When it runs out the round is voided: nobody scores, all roles are revealed, the round still counts, and the host continues with "Next round". |
| `pointsRaja` | 👑 Raja points | 1000 | 0–5000, step 50 | Raja's score each round. |
| `pointsMantri` | 🎩 Mantri points | 800 | 0–5000, step 50 | Mantri's score each round. |
| `pointsSipahi` | 🛡️ Sipahi points | 500 | 0–5000, step 50 | Sipahi's score each round. |
| `pointsChor` | 🦹 Chor points | 0 | 0–5000, step 50 | What the Chor scores when caught (and with `wrongGuess: zero`). |
| `pointsRani` | 👸 Rani points | 900 | 0–5000, step 50 | Extra role, in play with 5+ players. |
| `pointsSainik` | ⚔️ Sainik points | 300 | 0–5000, step 50 | Extra role, in play with 6+ players. |
| `pointsDaku` | 🗡️ Daku points | 100 | 0–5000, step 50 | Extra role, in play with 7+ players. |
| `pointsPandit` | 📜 Pandit points | 600 | 0–5000, step 50 | Extra role, in play with 8 players. |

## Rule decisions

- **Players 4–8.** With n players the first n roles of Raja, Mantri, Sipahi, Chor, Rani, Sainik, Daku, Pandit are
  dealt (shuffled with the seeded RNG) every round. Extra roles are bystanders and just score their points; no
  special behaviour (the brief makes that optional, so there is none).
- **Phases:** `guess` → `reveal` → host `nextRound` → `guess` … The last round's `nextRound` moves to `over`
  (same pattern as High Card), so everyone sees the final reveal before the results sheet. `View.isLastRound`
  lets the UI label that button "See results".
- **Who is public during the guess:** the guesser always (the table must know who is choosing), the Raja when
  `revealRaja` is on, and each viewer's own role. Spectators see only the public roles.
- **Guess targets** are every player who is not publicly known (everyone except the guesser and, if revealed,
  the Raja). The list is identical for every viewer and is never filtered by secret knowledge (`View.hiddenPlayers`
  equals the guesser's legal targets).
- **Wrong guess, `swap`:** taken literally from the brief: the Chor scores the guesser's role points and the
  guesser scores 0, even if `pointsChor` is set above 0 (it is not an exchange). The wrongly accused player and
  everyone else score their own role's points.
- **Guesser is Sipahi:** same flow; the Mantri is then an ordinary hidden player and scores 800 either way.
- **Absent or stuck guesser:** the contract says never to block forever on a non-host. Each deal stores
  `guessDeadline = now + guessSeconds·1000` (null when 0) and `deadline()` returns it during the guess. When the
  engine fires `@timeout`, the round is **voided**: a `RoundResult` with `voided: true`, `accused: null`,
  `correct: false` and 0 points for everyone is added to history, all roles are revealed, and the host's normal
  "Next round" continues. A voided round counts toward `rounds`. Nobody chooses the outcome and nothing depends on
  anyone's secret role. With the timer off (0), the shell's "End game" is the escape hatch. (An earlier host-only
  `redeal` action was removed: the host saw their new role after each deal, so they could re-roll a better one.)
- **The host has no actions during the guess** (unless they are the guesser), so host status never leaks or
  shapes anything.
- **Round history** (`View.history`) includes earlier rounds' full roles and points: they were revealed and roles
  are reshuffled each round, so this is public. Leak checks should look at the current round's mapping.
- **Scores:** cumulative totals, ranked with `rankScores` (higher is better, ties share a rank).
- **Bots:** the guesser bot accuses a random hidden player.

## Engine requests

None.
