# GameCrow Engine Contract

**Status: FROZEN (v1).** Game fleets build against this document. They may not modify `engine/`, `ui/`,
`convex/`, `src/`, `games/registry*.ts` or other games. If a game needs an engine or UI-kit change,
stop and report it to the lead as an **ENGINE REQUEST** (what, why, and the smallest API that would do it).

The reference implementation of everything below is `games/highcard/` (rules.ts, ui.tsx) with
`tests/engine.test.ts`. Read it first.

---

## 1. Layout and ownership

```
engine/            pure TS engine (lead)          ui/kit/         shared UI kit (lead)
convex/            backend (lead)                 src/            app shell, lobby, sandbox (lead)
games/registry.ts  server registry (lead)         games/registry.ui.ts  client registry (lead)
games/<name>/      ONE game (its fleet)           tests/<name>.test.ts  its tests (its fleet)
```

A game folder contains:

| file | ships to clients? | purpose |
|---|---|---|
| `types.ts` | yes (types only) | `State`, `Action`, `View`, `Settings` types and any shared constants that are not secret |
| `rules.ts` | **never** | `export default defineGame({...})`, the plugin |
| `ui.tsx` | yes | `export default function <Name>UI(props: GameUIProps<View, Action>)` |
| other `*.ts` | only if `ui.tsx` imports them | e.g. `prompts.ts` (server-only data imported by rules), `shared.ts` (pure helpers for both) |
| `ui.css` (optional) | yes | game-only styles, every class prefixed `.g-<name>-` |

**Anything `ui.tsx` imports (transitively) ships to every client.** Secret data (Psych's real answers, role
tables you don't want inspected) must only be imported by `rules.ts`. `tests/contract.test.ts` walks
`ui.tsx`'s runtime imports and fails if it reaches `rules.ts` or `convex/`. Use `import type` for types.

Adding a game never needs an engine change: the lead adds one line to `games/registry.ts` and one to
`games/registry.ui.ts` during integration. Fleets do not edit the registries.

## 2. The plugin (`rules.ts`)

```ts
import { defineGame, check, fail, rankScores, ... } from "../../engine";
import type { State, Action, View, Settings } from "./types";

export default defineGame<State, Action, View, Settings>({
  meta, settings, validateSettings?,
  setup, legalActions, reduce, viewFor, activePlayers, isOver, scores,
  deadline?, botAction?,
});
```

Signatures are in `engine/types.ts` (`GamePlugin`). The rules for each part:

### meta
`id` equals the folder name. `minPlayers`/`maxPlayers` are enforced by the engine before `setup`.
`howToPlay` is 3–6 short bullets. `orientation` defaults to `"portrait"` (the shell shows a rotate prompt
on phones held sideways). Keep `hidden` unset for real games.

### setup(players, settings, { rng, now }) → State
`players` are in seat order (seat 0..n-1, clockwise). `settings` are already resolved: defaults filled,
numbers clamped and snapped, options validated. Use `rng` for every shuffle/deal.

### legalActions(state, actor) → Action[]
Every action `actor` may send **right now**, as concrete objects. `actor.isHost` tells you if this player
is the room host. Return `[]` when they have nothing to do (also for unknown ids/spectators).
- The engine **rejects any action that does not match an entry** (structural deep-equality), so this list is the source of truth for validation. Ordering doesn't matter.
- Free-form fields: put `FREE_TEXT` (any string) or `FREE_NUMBER` (any finite number) in the template, e.g. `{ type: "answer", text: FREE_TEXT }`. `reduce` must then validate the value (trim, length, range).
- It must not leak hidden info beyond what `viewFor(state, actor.id)` shows (it is sent to that player).

### reduce(state, action, { actor, rng, now }) → State
- **Pure and deterministic.** Do not mutate `state` (tests deep-freeze it). Return a new object.
- No `Math.random()`, `Date.now()`, `new Date()`, I/O or globals. Use `ctx.rng` and `ctx.now`.
- Only legal actions reach `reduce`, but keep cheap sanity checks with `check(cond, "msg")` / `fail("msg")` (they throw `GameError`; the message is shown to the player, so keep it short and friendly).
- The actor is `ctx.actor.id`. Never trust a player id inside the action payload for "who did this".

### State / Action / View data rules
- JSON only: plain objects, arrays, strings, finite numbers, booleans, `null`. No `undefined` values (omit the key or use `null`), no `Map`/`Set`/`Date`/classes. Tests call `assertJsonSafe`.
- Declare `Action` as a union of **`type` aliases** (not `interface`s) so it satisfies `GameAction`'s index signature: `export type Action = { type: "play"; card: Card } | { type: "pass" };`
- Action `type`s starting with `@` are reserved for the engine.
- Keep state small (< 100 KB). Keep the settings object inside state if rules need it later.
- Cards are strings from `engine/cards.ts` (`"7H"`, `"TS"`, `"AD"`, `"XR"`; multi-deck `"7H#2"`). Use its helpers (`makeDeck`, `shuffledDeck`, `deal`, `dealAll`, `sortCards`, `removeCard`, `trickWinner`, `followSuitOptions`, `rankValue`, `suitOf`...).

### viewFor(state, playerId | null) → View
What one player may see. `null` = spectator (joined after the match started) and must see only public info.
**Never include** another player's hand, role, secret pick/vote/answer authorship, the deck order, or
anything derivable from them (e.g. "the card that would win"), until the rules make it public.
Allowed: counts (cards in hand), booleans ("has answered"), the viewer's own secrets, public history.
Shuffle anonymous items in `reduce` (with `rng`) and store the order; don't sort them by author.
If the view includes the full `settings`, that's fine (they're public).

### activePlayers(state) → PlayerId[]
Who the game is waiting on (drives "your turn", haptics and bots). Public. Empty while waiting only for the host.

### isOver(state) / scores(state) → ScoreLine[]
`scores` is public and called mid-game for the live scoreboard: one line per seated player, `rank` 1 = best,
ties share a rank. Use `rankScores(totals, higherIsBetter)`. For loser-style games, map to scores so
that rank still means "better".

### Host-controlled rounds
"Host controls rounds" = host-only actions such as `{ type: "nextRound" }`, returned by `legalActions`
only when `actor.isHost`. Rules:
- A host action must only advance/skip. It must never pick an outcome for someone else.
- Never block forever on a non-host: if the game waits on a player who might be gone, give the host a skip action (e.g. "skip slow answers") or use a deadline.
- Bots are never host. The shell gives the host an "End game" button; you don't implement that.

### deadline(state) → epoch ms | null (optional timers)
If set, the server calls `reduce(state, { type: "@timeout" }, { actor: SYSTEM_ACTOR, ... })` once the time
passes. Include `{ type: "@timeout" }` in your `Action` union if you use it, and store deadlines computed
from `ctx.now`. The UI gets `props.deadline` (`<Countdown deadline={...} />`).

### botAction(view, legal, rng) → Action (optional)
Bots see only their own view. The default is a random legal action, with `FREE_TEXT` filled by a silly word.
Provide `botAction` if random play can't finish the game in reasonable time or makes the game feel broken.
Bots must be able to finish every game: `tests/contract.test.ts` simulates full games for min, mid and
max player counts with several seeds, using default settings. (v1.1) If the defaults are invalid for a count
(`validateSettings` refuses it, e.g. Judgement's 7 cards × 8 players), the contract test skips that count and
the game's own tests must simulate it with valid settings. The minimum player count must always work with defaults.

### settings (house rules)
`settings: SettingField[]` is pure data: `number` (min/max/step), `boolean`, `select`, `multiselect`, `text`;
optional `help`, `group` (section header) and `visibleIf: { key, in: [...] }`. Keys are camelCase.
**Every ambiguous or regional rule becomes a setting** with the most common rule as the default.
`validateSettings(settings, players)` may return a message to block starting (e.g. "7 cards × 8 players > 52").
Host edits them in the lobby before starting; they can't change mid-match.

## 3. The UI (`ui.tsx`)

```tsx
import type { GameUIProps } from "../../ui/kit";
import type { Action, View } from "./types";
export default function JudgementUI({ view, me, players, legal, active, isHost, scores, over, deadline, act, pending }: GameUIProps<View, Action>) { ... }
```

- Build only from `ui/kit` exports, plain elements, and pure helpers from `engine` (`legalOfType`, `isLegal`, card helpers). No other dependencies.
- `act(action)` resolves `true`/`false`. The shell already toasts errors and does haptics. Disable primary buttons while `pending`.
- Derive what's clickable from `legal` (e.g. playable cards = `legalOfType(legal, "play").map(a => a.card)`). Don't re-implement rules client-side.
- `me === null` means spectating: render the public view with no controls.
- When `over` is true, show the final board. The shell shows the results sheet and the host's "Play again" / "Back to lobby" buttons.

**The shell already provides (don't duplicate):** header with room code, game name and menu (scores,
how to play, house rules, display prefs, end game, leave); pulsing border plus `haptic("turn")` when it
becomes your turn; screen wake lock; rotate prompt; error toasts; the results sheet; keyboard-aware app
height; dark/light theme; four-colour-suit preference; safe-area padding.

**Layout (mobile first, 360–430px portrait):** use `<GameScreen top={...} board={...} bottom={...}>`.
- `top`: `<PlayerStrip players={stripPlayers(players, active, id => ({ sub, badge }))} me={me} />`, compact.
- `board`: `<TableArea label=...>` with `<Trick>`, cards, `<BigStatus>`, `<ChoiceList>`... It scrolls if tall.
- `bottom` (thumb zone): `<TurnIndicator>`, then your `<Hand>`, then `<ActionBar>` with the primary `<Button variant="primary" size="lg">` (Play / Bid / Pass / Submit).

**Kit cheat-sheet** (all in `ui/kit/index.ts`):
`GameScreen, ActionBar, Button, IconButton, Avatar, Banner, BigStatus, Countdown,
PlayingCard, CardBack, CardSlot, SuitBadge, Hand, TableArea, Trick, seatPositions, PlayerStrip, stripPlayers,
TurnIndicator, Scoreboard, HoldToReveal, RoleCard, NumberPicker, ChoiceList, TextEntry, Sheet, useToast,
RotatePrompt, haptic, useWakeLock, useOrientation, useDeviceTilt, useRisingEdge, usePrefs`.

- **Hand**: auto-sorted fan with a sort toggle, horizontally scrollable, every card ≥ 44px wide visible.
  Tap selects (lifts); tap again plays (`onPlay`). For a separate Play button, control it:
  `selected`/`onSelect`. `playable` dims the rest. `multi` for multi-select.
- **Hidden info** (roles, a secret word): `<HoldToReveal label="Hold to see your role"><RoleCard .../></HoldToReveal>`. Never show secrets un-held.
- **Inputs**: `<TextEntry>` (16px+, stays above the keyboard). No hover-only UI, tap targets ≥ 44px.
- **Colour**: never use colour alone for meaning (suits always show symbols; use text/icons too).
- Game CSS (rarely needed): `games/<name>/ui.css`, imported by `ui.tsx`, classes prefixed `.g-<name>-`, using kit CSS variables (`--accent`, `--surface`, `--muted`, …) so both themes work.

## 4. Testing conventions

`tests/<name>.test.ts` (vitest). Use `engine/testing.ts`:

```ts
import plugin from "../games/<name>/rules";
import { createHarness, simulateGame, findLeaks, assertJsonSafe, makePlayers } from "../engine/testing";
const h = createHarness(plugin, { players: 4, settings: { ... }, seed: 3 }); // p0..p3, host = p0
h.act("p1", action);            // through the real engine (legal check + reduce), throws GameError
h.tryAct("p2", action);         // → error message or null
h.legal("p1"); h.view("p1"); h.view(null); h.envelope("p1"); h.state; h.match.over
h.setState(crafted);            // put the game in an exact position (frozen + JSON-checked)
h.advanceTime(ms);              // fire deadlines
simulateGame(plugin, { players: 5, seed: 1 }) // full bot game
```

Required coverage per game:
1. **Setup**: deal sizes, who starts, initial scores, each house rule's effect on setup.
2. **Legal moves**: what's legal in each phase; illegal moves rejected (wrong turn, card not held, wrong phase, host-only by non-host, spectator).
3. **Game-specific constraints**, e.g. follow suit, forbidden last bid, must play if able, open/extend sevens.
4. **Scoring**: every scoring rule and every scoring setting, with hand-computed expected numbers.
5. **End conditions**: game ends exactly when it should; `isOver`, final `scores` ranks and ties.
6. **viewFor never leaks**: for every phase, `findLeaks(h.view(other), secretsOf(p))` is empty and the spectator view leaks nothing. Check `legal` too.
7. **Determinism / purity**: same seed gives the same game; states are JSON-safe (the harness checks).
8. **Bots**: `simulateGame` finishes for min and max players with several seeds and every non-default setting combination that changes flow.

Test-agent rule: write tests from `SPEC.md`, this contract and `games/<name>/types.ts`, **without reading
`rules.ts` first**. When a test fails, decide from the spec whether the test or the rules is wrong, and
record the decision in the fleet report.

Run: `npx vitest run tests/<name>.test.ts tests/contract.test.ts` and `npx tsc --noEmit`.

## 5. Sandbox and screenshots (no backend needed)

`npm run dev`, then open `/sandbox/<id>?players=4&seed=7&as=p1&bots=1&steps=12&settings={...}&chrome=0`
(dev only, runs the real engine locally with bots; `as` = whose screen, `steps` = bot moves to
fast-forward, `chrome=0` hides the dev bar). p0 is the host.
Screenshots at the two reference sizes:
`node scripts/screenshots.cjs <outDir> "/sandbox/<id>?players=4&steps=0&chrome=0" "/sandbox/<id>?...&steps=30&chrome=0"`
(375×667 and 412×915; fails on page errors or horizontal scroll). The sandbox needs the game in
`games/registry.ts` and `games/registry.ui.ts`. In a fleet worktree, register it **locally only** for
testing and don't commit those two files (the lead registers during integration).

## 6. Backlog fit (why no engine change is needed later)

Hidden roles / night phases (Mafia, Imposter): `viewFor` + `HoldToReveal` + simultaneous `activePlayers`.
Timed rounds (Heads Up, Psych timer): `deadline` + `@timeout`; `meta.orientation: "landscape"` + `useDeviceTilt().request()` on a Start tap.
Blind draw from a neighbour (Joker): an action with an index into the neighbour's hidden hand; the view exposes only counts.
Multi-card plays (Bluff, Rummy melds): `Hand multi` + actions with card arrays (enumerate in legalActions or validate in reduce with a game-local meld validator in `games/<name>/`).
Two decks / jokers (Rummy): `makeDeck({ decks: 2, jokers: 2 })`. Custom rank orders (29, Teen Do Paanch): `trickWinner(cards, trump, rankOrder)`.
Words/teams (Codenames-style): per-player views by team; `ChoiceList`/custom grid.
