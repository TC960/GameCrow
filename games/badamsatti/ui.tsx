/** Badam Satti / Sevens UI: four suit rows growing out from the 7s, your hand, Play / Pass. */
import { useEffect, useState, type ReactNode } from "react";
import {
  ActionBar,
  Banner,
  BigStatus,
  Button,
  CardSlot,
  GameScreen,
  Hand,
  PlayerStrip,
  PlayingCard,
  Scoreboard,
  TableArea,
  TurnIndicator,
  stripPlayers,
  type CardSize,
  type GameUIProps,
  type ScoreColumn,
} from "../../ui/kit";
import { RANK_LABEL, SUIT_NAME, SUIT_SYMBOL, cardLabel, isLegal, legalOfType, makeCard, type Card, type PlayerId, type Rank } from "../../engine";
import type { Action, LogEntry, SuitRow, View } from "./types";
import "./ui.css";

const P = "g-badamsatti";

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** Bigger board cards on tall, wide phones; xs keeps all four rows visible at 375×667. */
function useBoardSize(): CardSize {
  const query = "(min-width: 400px) and (min-height: 780px)";
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [big, setBig] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setBig(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return big ? "sm" : "xs";
}

export default function BadamSattiUI({ view, me, players, legal, active, scores, over, act, pending }: GameUIProps<View, Action>) {
  const size = useBoardSize();
  const [selected, setSelected] = useState<Card[]>([]);

  const name = (id: PlayerId | null | undefined) => (id === me ? "You" : players.find((p) => p.id === id)?.name ?? "?");
  const seated = me !== null && view.order.includes(me);
  const myTurn = me !== null && active.includes(me);
  const playable = legalOfType(legal, "play").map((a) => a.card);
  const canPass = isLegal(legal, { type: "pass" });
  const canNext = isLegal(legal, { type: "nextRound" });
  const multiRound = view.totalRounds > 1;
  const lastResult = view.phase !== "play" ? view.history[view.history.length - 1] : undefined;

  // Clear a stale selection when the hand or turn changes.
  useEffect(() => {
    setSelected((s) => (s.every((c) => view.myHand.includes(c)) ? s : s.filter((c) => view.myHand.includes(c))));
  }, [view.myHand]);

  const sel = selected[0];
  const selPlayable = sel !== undefined && playable.includes(sel);
  const play = async (card: Card) => {
    if (pending || !playable.includes(card)) return;
    setSelected([]);
    await act({ type: "play", card });
  };

  // ---- Top: players with card counts, places, passes ----
  const placeOf = (id: PlayerId): number | null => {
    const i = view.finishOrder.indexOf(id);
    return i >= 0 ? i + 1 : null;
  };
  const strip = stripPlayers(players, active, (id) => {
    const count = view.handCounts[id] ?? 0;
    const badge = <span aria-label={`${count} cards`}>🂠 {count}</span>;
    if (lastResult) {
      const place = lastResult.places[id];
      return { badge, sub: `${place === 1 ? "🏆 " : ""}${ordinal(place)} · +${lastResult.penalty[id] ?? 0}` };
    }
    const place = placeOf(id);
    if (place !== null) return { badge, dim: true, sub: `${place === 1 ? "🏆" : "✓"} Out ${ordinal(place)}` };
    if (view.passedLastTurn[id]) return { badge, sub: "Passed" };
    if (multiRound) return { badge, sub: `${view.totals[id] ?? 0} pt${view.totals[id] === 1 ? "" : "s"}` };
    return { badge, sub: `${count} card${count === 1 ? "" : "s"}` };
  });

  // ---- Board ----
  const last = view.log[view.log.length - 1];
  const lastLine = last ? moveLine(last, name) : openingLine(view, name);
  const roundLabel = multiRound ? `Round ${view.round}/${view.totalRounds}` : null;

  const rows = (
    <div className={`${P}-rows ${P}-rows--${size}`} role="list" aria-label="Table">
      {view.board.map((row) => (
        <SuitRowView key={row.suit} row={row} size={size} playable={playable} />
      ))}
    </div>
  );

  const table = (
    <TableArea
      label={
        <span className={`${P}-last`} aria-live="polite">
          {roundLabel && <span className={`${P}-round`}>{roundLabel}</span>}
          {lastLine}
        </span>
      }
    >
      {rows}
    </TableArea>
  );

  const roundColumns: ScoreColumn[] = view.history.map((r) => ({
    label: `R${r.round}`,
    values: Object.fromEntries(Object.entries(r.penalty).map(([id, p]) => [id, p])),
  }));
  const scoringNote = view.rules.playToEnd
    ? "Points: finishing place − 1. Lowest total wins."
    : "Points: cards left in hand. Lowest total wins.";

  let summary: ReactNode = null;
  if (lastResult) {
    const winners = lastResult.finishOrder.length > 0 ? [lastResult.finishOrder[0]] : [];
    const top = scores.filter((s) => s.rank === 1).map((s) => s.playerId);
    const title = !over
      ? `Round ${lastResult.round} of ${view.totalRounds} over`
      : top.length === 1
        ? `🏆 ${top[0] === me ? "You win" : `${name(top[0])} wins`}!`
        : `🏆 Tie for 1st: ${top.map(name).join(" & ")}`;
    summary = (
      <div className={`${P}-summary gc-stack`}>
        <BigStatus>{title}</BigStatus>
        {winners.length > 0 && (
          <div className={`${P}-center gc-muted`}>
            {name(winners[0])} emptied {winners[0] === me ? "your" : "their"} hand first
            {lastResult.finishOrder.length > 1 && ` · then ${lastResult.finishOrder.slice(1).map(name).join(", ")}`}
          </div>
        )}
        {(multiRound || !over) && (
          <>
            <Scoreboard scores={scores} players={players} me={me} columns={multiRound ? roundColumns : []} />
            <div className={`${P}-center gc-muted gc-small`}>{scoringNote}</div>
          </>
        )}
      </div>
    );
  }

  const board = (
    <div className={`${P}-board`}>
      {summary && !over && summary}
      {table}
      {summary && over && summary}
    </div>
  );

  // ---- Bottom ----
  let turnText: ReactNode | undefined;
  if (view.phase === "roundOver") turnText = canNext ? `Start round ${view.round + 1} when ready` : "Waiting for the host to start the next round";
  else if (over || view.phase === "over") turnText = "Game over";
  else if (myTurn) {
    if (view.openingMove) turnText = view.rules.openWithSevenOfHearts ? "Your turn: open with the 7♥" : "Your turn: open with a 7";
    else if (playable.length === 0) turnText = "Your turn: nothing fits, pass";
    else turnText = `Your turn: ${playable.length} card${playable.length === 1 ? "" : "s"} can go down`;
  } else if (seated && placeOf(me!) !== null) turnText = `You're out in ${ordinal(placeOf(me!)!)} place!`;

  let bottom: ReactNode;
  if (!seated) {
    bottom = (
      <>
        <TurnIndicator active={active} me={me} players={players} text={turnText} />
        <Banner>You're watching. Hands stay hidden.</Banner>
      </>
    );
  } else if (view.phase !== "play") {
    bottom = (
      <>
        <TurnIndicator active={active} me={me} players={players} text={turnText} />
        {view.myHand.length > 0 && <Hand cards={view.myHand} size="sm" label="Left in your hand" disabled />}
        {canNext && (
          <ActionBar>
            <Button variant="primary" size="lg" disabled={pending} onClick={() => act({ type: "nextRound" })}>
              Start round {view.round + 1}
            </Button>
          </ActionBar>
        )}
      </>
    );
  } else if (view.myHand.length === 0) {
    bottom = (
      <>
        <TurnIndicator active={active} me={me} players={players} text={turnText} />
        <Banner>Your hand is empty. Watch the others finish.</Banner>
      </>
    );
  } else {
    const onlyPass = myTurn && canPass && playable.length === 0;
    bottom = (
      <>
        <TurnIndicator active={active} me={me} players={players} text={turnText} />
        <Hand
          cards={view.myHand}
          size="sm"
          playable={myTurn ? playable : []}
          selected={selected}
          onSelect={setSelected}
          onPlay={play}
          disabled={pending}
        />
        <ActionBar>
          {canPass && (
            <Button variant={onlyPass ? "primary" : "secondary"} size="lg" disabled={pending} onClick={() => act({ type: "pass" })}>
              Pass
            </Button>
          )}
          {!onlyPass && (
            <Button variant="primary" size="lg" disabled={pending || !myTurn || !selPlayable} onClick={() => sel && play(sel)}>
              {!myTurn
                ? "Play"
                : sel === undefined
                  ? "Pick a card"
                  : selPlayable
                    ? `Play ${cardLabel(sel)}`
                    : `${cardLabel(sel)} doesn't fit`}
            </Button>
          )}
        </ActionBar>
      </>
    );
  }

  return <GameScreen top={<PlayerStrip players={strip} me={me} />} board={board} bottom={bottom} />;
}

function moveLine(e: LogEntry, name: (id: PlayerId) => string): string {
  if (e.kind === "pass") return `${name(e.playerId)} passed`;
  const who = name(e.playerId);
  const out = e.wentOut !== null ? (e.wentOut === 1 ? ` and ${who === "You" ? "are" : "is"} out first! 🏆` : ` and ${who === "You" ? "are" : "is"} out (${ordinal(e.wentOut)})`) : "";
  return `${who} played ${cardLabel(e.card!)}${out}`;
}

function openingLine(view: View, name: (id: PlayerId) => string): string {
  if (view.phase !== "play") return "";
  const who = name(view.starter);
  const has = who === "You" ? "have" : "has";
  return view.rules.openWithSevenOfHearts ? `${who} ${has} the 7♥ and must open with it` : `${who} ${has} the 7♥ and opens with any 7`;
}

/** One suit: [next-down slot] [low] +n [7] +n [high] [next-up slot], with the 7s lined up in a column. */
function SuitRowView({ row, size, playable }: { row: SuitRow; size: CardSize; playable: Card[] }) {
  const sym = SUIT_SYMBOL[row.suit];
  const suitCls = `${P}-suit gc-card--${row.suit}`;
  const label = row.open
    ? `${SUIT_NAME[row.suit]}: ${RANK_LABEL[row.low!]} to ${RANK_LABEL[row.high!]}${row.complete ? ", complete" : ""}`
    : `${SUIT_NAME[row.suit]}: closed`;

  const slot = (rank: Rank) => {
    const card = makeCard(rank, row.suit);
    const mine = playable.includes(card);
    return (
      <span className={`${P}-slot ${mine ? `${P}-slot--mine` : ""}`} aria-label={mine ? `You can play ${cardLabel(card)}` : `Next: ${cardLabel(card)}`}>
        <CardSlot size={size} />
        <span className={`${P}-slot-text gc-card--${row.suit}`} aria-hidden>
          {RANK_LABEL[rank]}
          <span>{sym}</span>
        </span>
        {mine && <span className={`${P}-you`} aria-hidden>YOU</span>}
      </span>
    );
  };
  const gap = (n: number) => (n > 0 ? <span className={`${P}-gap`} aria-hidden>+{n}</span> : null);

  if (!row.open) {
    return (
      <div className={`${P}-row ${P}-row--closed`} role="listitem" aria-label={label}>
        <span className={suitCls} aria-hidden>{sym}</span>
        <span className={`${P}-down`} />
        {slot("7")}
        <span className={`${P}-up`}>
          <span className={`${P}-closed`}>Closed</span>
        </span>
      </div>
    );
  }

  const i7 = row.played.indexOf("7");
  const below = i7; // ranks below 7 on the table
  const above = row.played.length - 1 - i7;
  return (
    <div className={`${P}-row ${row.complete ? `${P}-row--done` : ""}`} role="listitem" aria-label={label}>
      <span className={suitCls} aria-hidden>
        {sym}
        {row.complete && <span className={`${P}-check`}>✓</span>}
      </span>
      <span className={`${P}-down`}>
        {row.nextDown ? slot(row.nextDown) : below > 0 ? <span className={`${P}-end`}>end</span> : null}
        {below > 0 && <PlayingCard card={makeCard(row.low!, row.suit)} size={size} />}
        {gap(below - 1)}
      </span>
      <PlayingCard card={makeCard("7", row.suit)} size={size} className={`${P}-seven`} />
      <span className={`${P}-up`}>
        {gap(above - 1)}
        {above > 0 && <PlayingCard card={makeCard(row.high!, row.suit)} size={size} />}
        {row.nextUp ? slot(row.nextUp) : above > 0 ? <span className={`${P}-end`}>end</span> : null}
      </span>
    </div>
  );
}
