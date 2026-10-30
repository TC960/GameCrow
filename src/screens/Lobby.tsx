/** Room lobby: invite, players, game picker, house rules, start. */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { resolveSettings } from "../../engine/settings";
import type { SettingsValues } from "../../engine/types";
import { Avatar, Banner, Button, IconButton, Scoreboard, Sheet, useToast } from "../../ui/kit";
import { SettingsEditor } from "../shell/SettingsEditor";
import { PrefsPanel } from "../shell/PrefsPanel";
import { deviceToken, errorText, navigate } from "../lib";

export type LobbyData = Extract<FunctionReturnType<typeof api.rooms.lobby>, { exists: true }>;
export type Catalog = FunctionReturnType<typeof api.catalog.list>;

export function Lobby({ code, lobby, catalog }: { code: string; lobby: LobbyData; catalog: Catalog }) {
  const token = deviceToken();
  const toast = useToast();
  const isHost = lobby.hostId === lobby.meId;
  const selectGame = useMutation(api.rooms.selectGame);
  const updateSettings = useMutation(api.rooms.updateSettings);
  const addBot = useMutation(api.rooms.addBot);
  const start = useMutation(api.rooms.start);
  const leave = useMutation(api.rooms.leave);
  const claimHost = useMutation(api.rooms.claimHost);
  const transferHost = useMutation(api.rooms.transferHost);
  const removePlayer = useMutation(api.rooms.removePlayer);
  const lastMatch = useQuery(api.game.view, lobby.matchId ? { code, token } : "skip");
  const [playerMenu, setPlayerMenu] = useState<LobbyData["players"][number] | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);

  const game = catalog.find((g) => g.meta.id === lobby.gameId) ?? catalog[0];
  const serverSettings = lobby.settings[game?.meta.id ?? ""];
  // Local draft so typing/stepping feels instant; synced to the server (debounced).
  const [draft, setDraft] = useState<SettingsValues | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(null), [game?.meta.id]);
  const values = draft ?? (game ? resolveSettings(game.settings, serverSettings) : {});

  const run = async (p: Promise<unknown>) => {
    setBusy(true);
    try {
      await p;
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const onSettings = (next: SettingsValues) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      updateSettings({ code, token, gameId: game.meta.id, settings: next }).catch((e) => toast(errorText(e), "error"));
    }, 300);
  };

  const share = async () => {
    const url = `${location.origin}/r/${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Join my GameCrow room", text: `Room code ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Invite link copied", "success");
      }
    } catch {
      // share sheet dismissed
    }
  };

  const seated = lobby.players.length;
  const countProblem = game
    ? seated < game.meta.minPlayers
      ? `Needs at least ${game.meta.minPlayers} players (add a bot?)`
      : seated > game.meta.maxPlayers
        ? `At most ${game.meta.maxPlayers} players`
        : null
    : "No games available";

  return (
    <>
      <header className="gc-header">
        <span className="gc-room-badge">{code}</span>
        <span className="gc-header-title">Lobby</span>
        <Button size="sm" onClick={share}>
          Invite
        </Button>
        <IconButton aria-label="Room menu" onClick={() => setMenu(true)}>
          ☰
        </IconButton>
      </header>

      <div className="gc-scroll">
        <div className="gc-stack">
          <button type="button" className="gc-code-card" onClick={share} aria-label={`Room code ${code}. Tap to invite.`}>
            <span className="gc-label">Room code</span>
            <span className="gc-code-big">{code}</span>
            <span className="gc-muted gc-small">Friends open GameCrow and enter this code</span>
          </button>

          {lobby.hostClaimable && (
            <Banner tone="accent">
              <div className="gc-row">
                <span className="gc-grow">The host seems to be away.</span>
                <Button size="sm" onClick={() => run(claimHost({ code, token }))}>
                  Become host
                </Button>
              </div>
            </Banner>
          )}

          <section className="gc-panel gc-stack" aria-label="Players">
            <div className="gc-row">
              <span className="gc-label gc-grow">Players · {seated}</span>
              {isHost && (
                <Button size="sm" disabled={busy} onClick={() => run(addBot({ code, token }))}>
                  + Bot
                </Button>
              )}
            </div>
            <ul className="gc-player-list">
              {lobby.players.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="gc-player-row"
                    disabled={!isHost || p.id === lobby.meId}
                    onClick={() => setPlayerMenu(p)}
                  >
                    <Avatar id={p.id} name={p.name} online={p.online} isBot={p.isBot} size="lg" />
                    <span className="gc-grow">
                      {p.name}
                      {p.id === lobby.meId && <span className="gc-muted"> (you)</span>}
                    </span>
                    {p.isHost && <span title="Host">👑</span>}
                    {!p.online && <span className="gc-muted gc-small">away</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="gc-stack" aria-label="Game">
            <span className="gc-label">{isHost ? "Pick a game" : "Game"}</span>
            <div className="gc-game-picker" role="radiogroup">
              {catalog.map((g) => (
                <button
                  key={g.meta.id}
                  type="button"
                  role="radio"
                  aria-checked={g.meta.id === game?.meta.id}
                  className={`gc-game-tile ${g.meta.id === game?.meta.id ? "gc-game-tile--on" : ""}`}
                  disabled={!isHost && g.meta.id !== game?.meta.id}
                  onClick={() => isHost && g.meta.id !== game?.meta.id && run(selectGame({ code, token, gameId: g.meta.id }))}
                >
                  <span className="gc-game-emoji" aria-hidden>
                    {g.meta.emoji}
                  </span>
                  <span className="gc-game-name">{g.meta.name}</span>
                  <span className="gc-muted gc-small">
                    {g.meta.minPlayers === g.meta.maxPlayers ? g.meta.minPlayers : `${g.meta.minPlayers}–${g.meta.maxPlayers}`} players
                  </span>
                </button>
              ))}
            </div>
          </section>

          {game && (
            <section className="gc-panel gc-stack" aria-label="House rules">
              <div>
                <h2 className="gc-h2">
                  {game.meta.emoji} {game.meta.name}
                </h2>
                <p className="gc-muted" style={{ margin: "4px 0 0" }}>
                  {game.meta.tagline}
                </p>
              </div>
              <details className="gc-details">
                <summary>How to play</summary>
                <ul>
                  {game.meta.howToPlay.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </details>
              <span className="gc-label">House rules {isHost ? "" : "(set by the host)"}</span>
              <SettingsEditor schema={game.settings} values={values} onChange={onSettings} readOnly={!isHost} />
            </section>
          )}

          {lastMatch?.over && (
            <section className="gc-panel gc-stack" aria-label="Last game">
              <span className="gc-label">Last game</span>
              <Scoreboard scores={lastMatch.scores} players={lastMatch.players} me={lastMatch.me} />
            </section>
          )}
        </div>
      </div>

      <div className="gc-game-bottom">
        {isHost ? (
          <>
            {countProblem && <p className="gc-muted gc-small gc-center" style={{ margin: 0 }}>{countProblem}</p>}
            <Button variant="primary" size="lg" block disabled={busy || !!countProblem} onClick={() => run(start({ code, token }))}>
              Start {game?.meta.name}
            </Button>
          </>
        ) : (
          <div className="gc-turn">Waiting for the host to start…</div>
        )}
      </div>

      <Sheet open={!!playerMenu} onClose={() => setPlayerMenu(null)} title={playerMenu?.name}>
        {playerMenu && (
          <div className="gc-stack">
            {!playerMenu.isBot && (
              <Button
                block
                onClick={() => {
                  setPlayerMenu(null);
                  run(transferHost({ code, token, playerId: playerMenu.id as Id<"players"> }));
                }}
              >
                👑 Make host
              </Button>
            )}
            <Button
              variant="danger"
              block
              onClick={() => {
                setPlayerMenu(null);
                run(removePlayer({ code, token, playerId: playerMenu.id as Id<"players"> }));
              }}
            >
              Remove from room
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} title="Room">
        <div className="gc-stack">
          <PrefsPanel />
          <Button
            variant="danger"
            block
            onClick={() => {
              if (!confirm("Leave this room?")) return;
              run(leave({ code, token }).then(() => navigate("/")));
            }}
          >
            Leave room
          </Button>
        </div>
      </Sheet>
    </>
  );
}
