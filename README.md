# 🐦‍⬛ GameCrow

Mobile-first multiplayer card & party games for playing with friends. No accounts: create a room, share
the 4-letter code, everyone joins from their phone. Refreshing rejoins the same seat.

- **Frontend:** Vite + React + TypeScript, installable PWA (dark mode by default).
- **Backend:** [Convex](https://convex.dev). Every move runs through the game's `reduce()` inside a Convex
  mutation, and each player only receives `viewFor(state, them)`, so hidden cards and roles never reach other phones.
- **Hosting:** Vercel builds the frontend from this repo and deploys the Convex functions in the same step.

Read [`SPEC.md`](SPEC.md) for the product spec and [`ENGINE_CONTRACT.md`](ENGINE_CONTRACT.md) for how to write a game.

## Develop

```bash
npm install
npx convex dev          # first run: log in and create a project (writes .env.local with VITE_CONVEX_URL)
npm run dev             # http://localhost:5173 (use your LAN IP on phones)
npm test                # engine, backend (in-memory Convex) and per-game tests
npm run typecheck
```

**No Convex deployment? `npm run dev` still works end to end.** Without `VITE_CONVEX_URL`, the dev server runs
the real `convex/*.ts` functions in memory (convex-test, see `scripts/mock-convex-plugin.ts`), bots and timers
included; rooms reset when the dev server restarts or server code changes. Each browser profile is one player;
to seat several players in one browser, open tabs with `?player=2`, `?player=3`, ... (dev only). Set
`VITE_MOCK_CONVEX=1` to use the mock even when `VITE_CONVEX_URL` is set. Production builds never include it.
`node scripts/e2e-mock.cjs [outDir]` (with `npx vite --port 5190` running) plays a full room with a host, two
guests and a bot at 375×667 and 412×915 and saves screenshots.

You can also try every game locally at **`/sandbox`** (dev only): the real
engine plus bots, with a seat switcher. `node scripts/screenshots.cjs <dir> "/sandbox/<game>?players=4&steps=10&chrome=0"`
captures 375×667 and 412×915 screenshots.

## Deploy (Vercel + Convex)

1. In the Convex dashboard, create a **production deploy key** (Project → Settings → Deploy keys).
2. Import this repo in Vercel. Add the environment variable `CONVEX_DEPLOY_KEY` (Production).
   `vercel.json` already sets the build command `npx convex deploy --cmd 'npm run build'`, which deploys the
   backend and injects `VITE_CONVEX_URL` into the frontend build.
3. Every push to the production branch redeploys both.

## Project layout

```
engine/      pure game engine: plugin types, seeded RNG, cards, settings, match runner, test helpers
convex/      backend: rooms, presence, matches, bots, timers, cleanup
ui/kit/      shared mobile UI kit (cards, hand fan, table, scoreboard, hold-to-reveal, ...)
src/         app shell: home, lobby, game shell, dev sandbox, PWA
games/<id>/  one folder per game: types.ts, rules.ts (server only), ui.tsx
tests/       vitest suites (contract tests run against every registered game)
```

## Games

The V1 games are being built: Raja Mantri Chor Sipahi, Badam Satti (Sevens), Judgement and Psych.
Each game's house-rule settings will be listed here.
