# Psych (original party game) — lead brief (game id `psych`)

Source: SPEC.md §V1 GAMES 4. SPEC.md wins on conflict. (setting) = house-rule setting with the stated default.
Use original wording and the name "Psych" for the game; do not copy any commercial app's question packs.

- Players **3–12**.
- Mode (setting `mode`): `trivia` (default) | `friends` | `mixed` (alternate).
  - Trivia prompt: a fill-in question with a surprising **real answer** ("The national animal of Scotland is
    the ___" → "Unicorn"). Write ≥ 60 accurate, widely verifiable facts in `games/psych/prompts.ts`, grouped in
    packs (setting `packs` multiselect, e.g. general, food, animals, India, science, history). Avoid shaky or
    contested facts, and keep it family friendly.
  - Friends prompt: ≥ 40 templates with a `{player}` placeholder ("{player}'s secret talent is ___"); the subject
    rotates among players. No real answer by default (setting `friendsRealAnswer`: `none` (default) |
    `subject`, where the subject writes the true answer and players who pick it get +2; the subject doesn't vote).
  - (setting `customPrompts`, text, multiline): extra prompts "Question | Answer" per line, used in addition.
- Phases: **answer** (everyone writes a fake answer, 1–60 chars trimmed; an answer equal to the real answer,
  ignoring case/spaces/punctuation, is rejected with "That's the real answer! Write a fake one");
  **vote** (answers shown shuffled and anonymous, real answer mixed in; you can't vote for your own); **reveal**
  (who wrote what, who voted for what, points); then the **host** taps "Next round".
  Identical fake answers merge into one option credited to all their authors.
- Scoring: +1 per vote your answer receives; +2 for picking the real answer.
- (setting `rounds`, default 7, 3–20). Optional timers (settings `answerSeconds`, `voteSeconds`, default 0 = off)
  via `deadline` + `@timeout`. The host always has a "Skip waiting" action that moves on with whoever has answered
  or voted (needs ≥ 2 answers to vote; otherwise reveal).
- Hidden info: answers are anonymous until reveal (during answering others only see who has answered); votes
  are hidden until reveal (only "has voted"); the real answer never appears in any view before reveal.
  Prompt/answer data must live in `prompts.ts` imported ONLY by `rules.ts` (it must not ship to clients).
- Bots: write a silly answer, vote randomly (not own).
- UI: big prompt card; `TextEntry` in the bottom zone; "Waiting for 3 answers" + strip ✓ marks; voting with
  `ChoiceList`; reveal list with authors, voters and +points; `Countdown` when a deadline exists.
