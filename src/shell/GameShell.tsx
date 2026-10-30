/**
 * Wraps a game UI with everything every game gets for free: header + menu, "your turn" glow and
 * haptics, wake lock, rotate prompt, error toasts, scoreboard, how-to-play, results sheet.
 * Used by the live room (Convex) and the dev sandbox (local engine) alike.
 */
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import type { GameAction, GameMeta, MatchView, SettingField } from "../../engine/types";
import {
  Button,
  IconButton,
  RotatePrompt,
  Scoreboard,
  Sheet,
  haptic,
  useOrientation,
  useRisingEdge,
  useToast,
  useWakeLock,
  type SeatInfo,
} from "../../ui/kit";
import { GAME_UIS } from "../../games/registry.ui";
import { SettingsEditor } from "./SettingsEditor";
import { PrefsPanel } from "./PrefsPanel";

export interface GameShellProps {
  envelope: MatchView;
  seats: SeatInfo[];
  isHost: boolean;
  meta: GameMeta;
  settingsSchema: SettingField[];
  /** House-rule values this match uses. */
  settings: unknown;
  /** Throws with a player-safe message on failure. */
  send: (action: GameAction) => Promise<void>;
  /** Host: stop the game and go back to the lobby. */
  onEndGame?: () => void;
  /** Host: start a new match of the same game. */
  onPlayAgain?: () => void;
  onLeave?: () => void;
  /** Shown left of the title (e.g. the room code). */
  badge?: ReactNode;
  errorText: (e: unknown) => string;
}

export function GameShell({ envelope, seats, isHost, meta, settingsSchema, settings, send, onEndGame, onPlayAgain, onLeave, badge, errorText }: GameShellProps) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [results, setResults] = useState(envelope.over);
  const { shortLandscape, orientation } = useOrientation();
  const UI = GAME_UIS[envelope.gameId];

  const myTurn = envelope.me !== null && envelope.active.includes(envelope.me);
  useWakeLock(!envelope.over);
  useRisingEdge(myTurn, () => haptic("turn"));
  useRisingEdge(envelope.over, () => {
    haptic("success");
    setResults(true);
  });
  useEffect(() => {
    if (!envelope.over) setResults(false);
  }, [envelope.over]);

  const act = useCallback(
    async (action: GameAction) => {
      setPending(true);
      try {
        await send(action);
        return true;
      } catch (e) {
        haptic("error");
        toast(errorText(e), "error");
        return false;
      } finally {
        setPending(false);
      }
    },
    [send, toast, errorText],
  );

  const wants = meta.orientation ?? "portrait";
  const rotate = (wants === "portrait" && shortLandscape) || (wants === "landscape" && orientation === "portrait");

  return (
    <div className={`gc-game ${myTurn ? "gc-my-turn" : ""}`}>
      <header className="gc-header">
        {badge}
        <span className="gc-header-title">
          {meta.emoji} {meta.name}
          {envelope.me === null && <span className="gc-muted gc-small"> · spectating</span>}
        </span>
        {envelope.over && (
          <Button size="sm" variant="primary" onClick={() => setResults(true)}>
            Results
          </Button>
        )}
        <IconButton aria-label="Game menu" onClick={() => setMenu(true)}>
          ☰
        </IconButton>
      </header>

      {myTurn && <div className="gc-turn-glow" aria-hidden />}

      {UI ? (
        <Suspense fallback={<div className="gc-scroll gc-center gc-muted">Loading game…</div>}>
          <UI
            view={envelope.view}
            me={envelope.me}
            players={seats}
            legal={envelope.legal}
            active={envelope.active}
            isHost={isHost}
            scores={envelope.scores}
            over={envelope.over}
            deadline={envelope.deadline}
            act={act}
            pending={pending}
          />
        </Suspense>
      ) : (
        <div className="gc-scroll gc-center">This game isn't available in this version. Refresh to update.</div>
      )}

      {rotate && <RotatePrompt to={wants === "landscape" ? "landscape" : "portrait"} />}

      <Sheet open={menu} onClose={() => setMenu(false)} title={`${meta.emoji} ${meta.name}`}>
        <div className="gc-stack">
          <div className="gc-label">Scores</div>
          <Scoreboard scores={envelope.scores} players={seats} me={envelope.me} />
          <details className="gc-details">
            <summary>How to play</summary>
            <ul>
              {meta.howToPlay.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
          {settingsSchema.length > 0 && (
            <details className="gc-details">
              <summary>House rules</summary>
              <SettingsEditor schema={settingsSchema} values={settings} readOnly />
            </details>
          )}
          <details className="gc-details">
            <summary>Display</summary>
            <PrefsPanel />
          </details>
          {isHost && onEndGame && (
            <Button
              variant="danger"
              block
              onClick={() => {
                if (envelope.over || confirm("End this game for everyone?")) {
                  setMenu(false);
                  onEndGame();
                }
              }}
            >
              {envelope.over ? "Back to lobby" : "End game for everyone"}
            </Button>
          )}
          {onLeave && (
            <Button variant="ghost" block onClick={onLeave}>
              Leave room
            </Button>
          )}
        </div>
      </Sheet>

      <Sheet open={results && envelope.over} onClose={() => setResults(false)} title="🏆 Game over">
        <div className="gc-stack">
          <Scoreboard scores={envelope.scores} players={seats} me={envelope.me} />
          {isHost ? (
            <div className="gc-stack">
              {onPlayAgain && (
                <Button variant="primary" size="lg" block onClick={onPlayAgain}>
                  Play again
                </Button>
              )}
              {onEndGame && (
                <Button block onClick={onEndGame}>
                  Back to lobby
                </Button>
              )}
            </div>
          ) : (
            <p className="gc-muted gc-center">Waiting for the host to start the next game…</p>
          )}
          <Button variant="ghost" block onClick={() => setResults(false)}>
            See the table
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
