# Psych: rules notes

## House-rule settings

| key | label | default | options / range | effect |
|---|---|---|---|---|
| `mode` | Prompts | `trivia` | `trivia` \| `friends` \| `mixed` | Trivia facts with a real answer, prompts about the players, or alternate the two (round 1 is trivia). |
| `packs` | Trivia packs | all six | `general`, `animals`, `food`, `science`, `history`, `india` (may be empty) | Which trivia packs trivia rounds draw from. Shown when mode is trivia/mixed. |
| `friendsRealAnswer` | Real answer for player prompts | `none` | `none` \| `subject` | `none`: player prompts have no real answer, people vote for the fake they like best. `subject`: the subject writes the true answer, doesn't vote, and anyone who picks it scores `truthPoints`. Shown when mode is friends/mixed (also applies to custom `{player}` lines). |
| `customPrompts` | Custom prompts | empty | text, multiline, ≤ 4000 chars | One prompt per line: `Question \| Answer \| other accepted spellings`. The answer is optional. `{player}` gives the line a rotating subject. Custom prompts are always played, mixed in among pack prompts. |
| `rounds` | Rounds | 7 | 3–20 | Number of rounds (fewer if the chosen packs run out; prompts never repeat). |
| `answerSeconds` | Answer timer (seconds) | 0 (off) | 0–180, step 15 | When it runs out, the game moves on with whoever has answered (same as the host's skip). |
| `voteSeconds` | Vote timer (seconds) | 0 (off) | 0–120, step 15 | When it runs out, missing votes are skipped and the round is revealed. |
| `fooledPoints` | Points per player you fool | 1 | 1–5 | Each author of a fake gets this per vote it receives. |
| `truthPoints` | Points for picking the real answer | 2 | 0–5 | For voting for the real answer (and, in `subject` rounds, for writing the subject's truth). |

`validateSettings` blocks the start when the mode uses trivia but no pack is selected and there are no custom prompts.

## Rule decisions

- **Phases**: answer → vote → reveal → (host "Next round") → … → over. After the last reveal, the host's "Next round" ends the game; the last round's reveal stays in the view (`isLastRound` tells the UI to label the button "Finish").
- **Answers** are trimmed, control characters removed and whitespace collapsed, then must be 1–60 characters. One answer per player per round (no editing); one vote per player (no changing).
- **Real-answer check / merging** compare a key that ignores case, accents, spaces, punctuation and a leading "a"/"an"/"the" ("the UNICORN!" = "Unicorn"). Each trivia prompt also lists accepted alternative spellings (e.g. "3" for "Three"). Matching the real answer is rejected with "That's the real answer! Write a fake one".
- **Identical fakes** merge into one option credited to all their authors (each gets the full points for its votes). The shown spelling is the alphabetically first one, so it doesn't hint at who wrote it. None of the authors can vote for it.
- **`subject` rounds**: the subject's answer is the truth. Other players can't be rejected for matching it (that would leak the truth), so a matching answer merges into the real option instead: that player "read their mind" and scores `truthPoints`. They still vote, just not for the real option, which counts as theirs. The subject doesn't vote and scores nothing from the truth itself. If the subject never answers (skip/timer), the round has no real answer and the subject votes like everyone else.
- **Subjects** rotate through seat order starting at a random player, over every prompt with `{player}` (pack or custom).
- **Who votes**: every seated player (including players who didn't answer), except the subject of a `subject` round and anyone who has no option they're allowed to pick.
- **Skip / timeout**: during answering, everyone's answers so far are used. Voting needs ≥ 2 submitted answers and ≥ 2 options (after merging) and at least one eligible voter; otherwise the game goes straight to the reveal (`reveal.voteSkipped`), showing the real answer, and nobody scores. During voting, missing votes are just skipped.
- **No-real-answer rounds** (`friends` + `none`, or custom lines without an answer): only fakes are shown and votes give `fooledPoints` to their authors.
- **Prompt selection**: custom prompts are always included (shuffled, cut to the round count) and inserted at random positions. The other rounds come from the shuffled pools without repeats (mixed mode alternates, falling back to the other pool if one runs out). Trivia mode plays fewer rounds if the packs run out.
- **Hidden info**: before the reveal no view or legal list contains the real answer, alternatives, authors, `isReal` or other players' votes. During answering others see only who has answered. During voting options are anonymous and in a stored shuffled order (ids `o1..oN` assigned after shuffling); the viewer's own options are flagged `isMine`. Spectators (`null` or unseated ids) get the public view with no `isMine`/`myAnswer`/`myVote`.
- **Bots** write "A <adjective> <noun>" fakes (never a real answer in the packs) and vote randomly among legal options.
- **Timers** are stored as `state.deadline` (from `ctx.now`) only in the answer/vote phases. Reveal waits for the host only (allowed: only the host's tap is needed).

## Engine requests

- **Secret text settings (optional)**: the lobby and in-game "House rules" sheet show every setting to everyone in the room, so the answers in `customPrompts` are visible to all players. Smallest fix: a `secret?: boolean` flag on `TextField` that the lobby/house-rules UI shows only to the host (the value still reaches `setup`). Until then the setting's help text warns that custom answers aren't secret. Nothing else is needed.
