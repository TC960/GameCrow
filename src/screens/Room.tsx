/** /r/CODE: join form, lobby, or the running game. Everything live via Convex queries. */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { GameAction } from "../../engine/types";
import { Button, useToast, type SeatInfo } from "../../ui/kit";
import { GameShell } from "../shell/GameShell";
import { deviceToken, errorText, navigate, saveLastRoom, saveName, savedName } from "../lib";
import { Lobby, type Catalog, type LobbyData } from "./Lobby";

const HEARTBEAT_MS = 15_000;

export function Room({ code }: { code: string }) {
  const token = deviceToken();
  const lobby = useQuery(api.rooms.lobby, { code, token });
  const catalog = useQuery(api.catalog.list, { includeHidden: import.meta.env.DEV });
  const heartbeat = useMutation(api.rooms.heartbeat);

  useEffect(() => {
    if (!lobby?.exists || !lobby.meId) return;
    saveLastRoom(code);
    const beat = () => document.visibilityState === "visible" && heartbeat({ code, token }).catch(() => {});
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [code, token, heartbeat, lobby?.exists, lobby?.meId]);

  if (lobby === undefined || catalog === undefined) return <div className="gc-scroll gc-center gc-muted">Connecting…</div>;
  if (!lobby.exists) {
    return (
      <div className="gc-scroll">
        <div className="gc-stack gc-center" style={{ marginTop: "20vh" }}>
          <h1 className="gc-h1">Room {code} not found</h1>
          <p className="gc-muted">It may have expired. Rooms close after a day of inactivity.</p>
          <Button variant="primary" onClick={() => navigate("/")}>
            Home
          </Button>
        </div>
      </div>
    );
  }
  if (!lobby.meId) return <JoinForm code={code} />;
  if (lobby.status === "playing") return <LiveGame code={code} lobby={lobby} catalog={catalog} />;
  return <Lobby code={code} lobby={lobby} catalog={catalog} />;
}

function JoinForm({ code }: { code: string }) {
  const join = useMutation(api.rooms.join);
  const toast = useToast();
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  return (
    <div className="gc-scroll">
      <form
        className="gc-stack"
        style={{ marginTop: "12vh" }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            saveName(name);
            await join({ code, name, token: deviceToken() });
          } catch (err) {
            toast(errorText(err), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="gc-h1 gc-center">Join room {code}</h1>
        <input className="gc-input" value={name} maxLength={20} placeholder="Your nickname" autoFocus onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="gc-btn gc-btn--primary gc-btn--lg" disabled={busy || !name.trim()}>
          Join
        </button>
        <Button variant="ghost" onClick={() => navigate("/")}>
          Cancel
        </Button>
      </form>
    </div>
  );
}

function LiveGame({ code, lobby, catalog }: { code: string; lobby: LobbyData; catalog: Catalog }) {
  const token = deviceToken();
  const envelope = useQuery(api.game.view, { code, token });
  const act = useMutation(api.game.act);
  const endMatch = useMutation(api.rooms.endMatch);
  const start = useMutation(api.rooms.start);
  const leave = useMutation(api.rooms.leave);
  const toast = useToast();
  const isHost = lobby.hostId === lobby.meId;

  const seats: SeatInfo[] = useMemo(() => {
    if (!envelope) return [];
    return envelope.players.map((p) => {
      const live = lobby.players.find((x) => x.id === p.id);
      return { ...p, online: live?.online ?? false, isBot: live?.isBot ?? false, isHost: p.id === lobby.hostId };
    });
  }, [envelope, lobby.players, lobby.hostId]);

  if (!envelope) return <div className="gc-scroll gc-center gc-muted">Loading game…</div>;
  const entry = catalog.find((g) => g.meta.id === envelope.gameId);
  if (!entry) return <div className="gc-scroll gc-center">Unknown game. Refresh to update.</div>;
  const run = (p: Promise<unknown>) => p.catch((e) => toast(errorText(e), "error"));

  return (
    <GameShell
      envelope={envelope}
      seats={seats}
      isHost={isHost}
      meta={entry.meta}
      settingsSchema={entry.settings}
      settings={lobby.settings[envelope.gameId]}
      badge={<span className="gc-room-badge">{code}</span>}
      errorText={errorText}
      send={async (action: GameAction) => {
        await act({ code, token, action });
      }}
      onEndGame={() => run(endMatch({ code, token }))}
      onPlayAgain={() => run(endMatch({ code, token }).then(() => start({ code, token })))}
      onLeave={() => {
        if (!confirm("Leave this room? You'll lose your seat.")) return;
        run(leave({ code, token }).then(() => navigate("/")));
      }}
    />
  );
}
