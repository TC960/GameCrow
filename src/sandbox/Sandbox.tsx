/**
 * DEV-ONLY sandbox: runs any registered game locally through the real engine (no Convex),
 * with bots and a seat switcher. Never included in production builds.
 *
 * URL: /sandbox/<gameId>?players=4&seed=7&as=p1&bots=1&steps=12&settings={"handSize":3}&chrome=0
 *   players  seat count (default meta.minPlayers)      as     seat to view (default p0, the host)
 *   seed     RNG seed (default 1)                      bots   1 = other seats auto-play (default 1)
 *   steps    bot moves to fast-forward on load          chrome 0 = hide the dev toolbar (screenshots)
 *   settings JSON house rules
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAMES } from "../../games/registry";
import { applyAction, buildView, chooseBotAction, startMatch, errorMessage, type MatchRecord } from "../../engine/match";
import type { AnyGamePlugin, GameAction, PlayerId } from "../../engine/types";
import { makePlayers } from "../../engine/testing";
import { Button } from "../../ui/kit";
import { GameShell } from "../shell/GameShell";
import { navigate } from "../lib";

const HOST = "p0";
const BOT_DELAY = 600;

function params() {
  const q = new URLSearchParams(location.search);
  let settings: unknown = {};
  try {
    settings = JSON.parse(q.get("settings") ?? "{}");
  } catch {
    // ignore bad JSON
  }
  return {
    players: q.get("players") ? Number(q.get("players")) : null,
    seed: Number(q.get("seed") ?? 1),
    as: q.get("as") ?? HOST,
    bots: q.get("bots") !== "0",
    steps: Number(q.get("steps") ?? 0),
    chrome: q.get("chrome") !== "0",
    settings,
  };
}

/** One bot move by anyone except `skip` (host seat also takes host-only actions). */
function botStep(plugin: AnyGamePlugin, match: MatchRecord, skip: PlayerId | null): MatchRecord | null {
  if (match.over) return null;
  const active = plugin.activePlayers(match.state);
  const order = [...active, ...match.players.map((p) => p.id).filter((id) => !active.includes(id))];
  for (const id of order) {
    if (id === skip) continue;
    let action = chooseBotAction(plugin, match, id);
    // The host seat only takes host-only actions when the game is waiting on nobody else
    // (e.g. "next round"), never skip/redeal-style actions while a player is still deciding.
    if (!action && id === HOST && active.length === 0) {
      action = (plugin.legalActions(match.state, { id, isHost: true }) as GameAction[])[0] ?? null;
    }
    if (!action) continue;
    return applyAction(plugin, match, { id, isHost: id === HOST }, action, Date.now());
  }
  return null;
}

export default function Sandbox({ gameId }: { gameId?: string }) {
  const plugin = gameId ? GAMES[gameId] : undefined;
  if (!plugin) return <GamePicker />;
  return <SandboxGame key={gameId} plugin={plugin} />;
}

function GamePicker() {
  return (
    <div className="gc-scroll">
      <div className="gc-stack">
        <h1 className="gc-h1">🧪 Sandbox</h1>
        <p className="gc-muted">Local engine + bots. Dev builds only.</p>
        {Object.values(GAMES).map((g) => (
          <Button key={g.meta.id} block onClick={() => navigate(`/sandbox/${g.meta.id}`)}>
            {g.meta.emoji} {g.meta.name} ({g.meta.minPlayers}–{g.meta.maxPlayers})
          </Button>
        ))}
        <Button variant="ghost" onClick={() => navigate("/")}>
          Home
        </Button>
      </div>
    </div>
  );
}

function SandboxGame({ plugin }: { plugin: AnyGamePlugin }) {
  const p = useMemo(params, []);
  const count = Math.min(plugin.meta.maxPlayers, Math.max(plugin.meta.minPlayers, p.players ?? plugin.meta.minPlayers));
  const fresh = useCallback(() => {
    let m = startMatch(plugin, makePlayers(count), p.settings, p.seed, Date.now());
    for (let i = 0; i < p.steps; i++) m = botStep(plugin, m, null) ?? m;
    return m;
  }, [plugin, count, p]);
  const [match, setMatch] = useState<MatchRecord>(fresh);
  const [viewer, setViewer] = useState<PlayerId>(p.as);
  const [bots, setBots] = useState(p.bots);
  const latest = useRef(match);
  latest.current = match;

  useEffect(() => {
    if (!bots || match.over) return;
    const t = setTimeout(() => {
      const next = botStep(plugin, match, viewer);
      if (next) setMatch(next);
    }, BOT_DELAY);
    return () => clearTimeout(t);
  }, [bots, match, viewer, plugin]);

  const envelope = buildView(plugin, match, viewer, viewer === HOST);
  const seats = match.players.map((pl) => ({ ...pl, online: true, isBot: bots && pl.id !== viewer, isHost: pl.id === HOST }));

  return (
    <>
      {p.chrome && (
        <div className="gc-dev-bar">
          {match.players.map((pl) => (
            <button key={pl.id} type="button" className={`gc-segment ${pl.id === viewer ? "gc-segment--on" : ""}`} onClick={() => setViewer(pl.id)}>
              {pl.id}
            </button>
          ))}
          <button type="button" className={`gc-segment ${bots ? "gc-segment--on" : ""}`} onClick={() => setBots(!bots)}>
            🤖
          </button>
          <button type="button" className="gc-segment" onClick={() => setMatch(botStep(plugin, match, null) ?? match)}>
            ⏭
          </button>
          <button type="button" className="gc-segment" onClick={() => setMatch(fresh())}>
            ↺
          </button>
          <span className="gc-muted gc-small">seq {match.seq}</span>
        </div>
      )}
      <GameShell
        envelope={envelope}
        seats={seats}
        isHost={viewer === HOST}
        meta={plugin.meta}
        settingsSchema={plugin.settings}
        settings={match.settings}
        badge={<span className="gc-room-badge">DEV</span>}
        errorText={errorMessage}
        send={async (action) => {
          // Throws GameError synchronously so the shell can toast it.
          const next = applyAction(plugin, latest.current, { id: viewer, isHost: viewer === HOST }, action, Date.now());
          latest.current = next;
          setMatch(next);
        }}
        onEndGame={() => navigate("/sandbox")}
        onPlayAgain={() => setMatch(fresh())}
      />
    </>
  );
}
