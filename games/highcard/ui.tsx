/** High Card Duel UI: the reference ui.tsx for ENGINE_CONTRACT.md. */
import { useState } from "react";
import {
  ActionBar,
  BigStatus,
  Button,
  GameScreen,
  Hand,
  PlayerStrip,
  PlayingCard,
  TableArea,
  Trick,
  TurnIndicator,
  CardBack,
  stripPlayers,
  type GameUIProps,
} from "../../ui/kit";
import { legalOfType } from "../../engine";
import type { Action, View } from "./types";

export default function HighCardUI({ view, me, players, legal, active, act, pending, isHost }: GameUIProps<View, Action>) {
  const [selected, setSelected] = useState<string[]>([]);
  const picks = legalOfType(legal, "pick");
  const canNext = legalOfType(legal, "nextRound").length > 0;
  const play = (card: string) => act({ type: "pick", card }).then((ok) => ok && setSelected([]));
  const winnerNames = view.lastWinners.map((id) => (id === me ? "You" : players.find((p) => p.id === id)?.name)).join(" & ");

  return (
    <GameScreen
      top={
        <PlayerStrip
          me={me}
          players={stripPlayers(players, active, (id) => ({
            sub: `${view.scores[id]} pts`,
            badge: view.phase === "pick" ? (view.picked[id] ? "✓" : "…") : undefined,
          }))}
        />
      }
      board={
        <TableArea label={`Round ${view.round} of ${view.totalRounds}`}>
          {view.revealed ? (
            <Trick
              players={players}
              me={me}
              plays={Object.entries(view.revealed).map(([playerId, card]) => ({ playerId, card }))}
              winner={view.lastWinners.length === 1 ? view.lastWinners[0] : null}
            />
          ) : view.myPick ? (
            <div className="gc-stack gc-center">
              <PlayingCard card={view.myPick} size="lg" />
              <span>Waiting for the others…</span>
            </div>
          ) : (
            <CardBack size="lg" />
          )}
        </TableArea>
      }
      bottom={
        <>
          {view.phase === "reveal" && <BigStatus>{winnerNames} won the round</BigStatus>}
          {view.phase === "over" ? (
            <BigStatus>Game over</BigStatus>
          ) : (
            <TurnIndicator active={active} me={me} players={players} text={view.phase === "reveal" && !canNext ? "Waiting for the host" : undefined} />
          )}
          {me && (
            <Hand
              cards={view.myHand}
              playable={picks.map((a) => a.card)}
              selected={selected}
              onSelect={setSelected}
              onPlay={play}
            />
          )}
          <ActionBar>
            {picks.length > 0 && (
              <Button variant="primary" size="lg" disabled={pending || selected.length !== 1} onClick={() => play(selected[0])}>
                Play card
              </Button>
            )}
            {canNext && isHost && (
              <Button variant="primary" size="lg" disabled={pending} onClick={() => act({ type: "nextRound" })}>
                Next round
              </Button>
            )}
          </ActionBar>
        </>
      }
    />
  );
}
