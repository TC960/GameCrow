/** Judgement UI: bid your tricks, follow suit, hit the number exactly. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionBar,
  BigStatus,
  Button,
  Countdown,
  GameScreen,
  Hand,
  PlayerStrip,
  PlayingCard,
  NumberPicker,
  Scoreboard,
  Sheet,
  SuitBadge,
  TableArea,
  Trick,
  TurnIndicator,
  stripPlayers,
  type CardSize,
  type GameUIProps,
  type ScoreColumn,
  type SeatInfo,
} from "../../ui/kit";
import { SUIT_NAME, SUIT_SYMBOL, legalOfType, type Card, type PlayerId, type Suit } from "../../engine";
import type { Action, CompletedTrick, RoundResult, View } from "./types";
import "./ui.css";

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const trumpLabel = (s: Suit | null) => (s ? `${SUIT_SYMBOL[s]} ${SUIT_NAME[s]}` : "No trump");

export default function JudgementUI({ view, me, players, legal, active, isHost, scores, over, deadline, act, pending }: GameUIProps<View, Action>) {
  const [selected, setSelected] = useState<Card[]>([]);
  const [bid, setBid] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);

  // Reset the local picks when a new round starts.
  useEffect(() => {
    setBid(null);
    setSelected([]);
  }, [view.round]);

  const name = (id: PlayerId | null | undefined) => (id === me ? "You" : players.find((p) => p.id === id)?.name ?? "?");
  const seated = me !== null && view.order.includes(me);
  const myTurn = me !== null && active.includes(me);

  const bids = legalOfType(legal, "bid").map((a) => a.bid);
  const plays = legalOfType(legal, "play").map((a) => a.card);
  const canNext = legalOfType(legal, "nextRound").length > 0;
  const canHurry = legalOfType(legal, "hurry").length > 0;

  const phase = over ? "over" : view.phase;
  const bidding = phase === "bidding";
  const playing = phase === "playing";
  const ended = phase === "summary" || phase === "over";

  const doBid = (n: number) => act({ type: "bid", bid: n }).then((ok) => ok && setBid(null));
  const doPlay = (card: Card) => act({ type: "play", card }).then((ok) => ok && setSelected([]));

  // ---------- Top: players strip ----------
  const strip = stripPlayers(players, active, (id) => {
    const b = view.bids[id];
    const won = view.tricksWon[id] ?? 0;
    let sub: ReactNode;
    if (ended && view.lastRound) {
      const made = view.lastRound.made[id];
      sub = `${view.totals[id] ?? 0} pts ${made ? "✓" : "✗"}`;
    } else if (b === null || b === undefined) {
      sub = view.turn === id ? "Bidding…" : "Bid –";
    } else {
      sub = playing ? `Bid ${b}·Won ${won}` : `Bid ${b}`;
    }
    return { sub, badge: id === view.dealer ? "D" : undefined };
  });

  // ---------- Board ----------
  const label = (
    <span className="g-judgement-head">
      <SuitBadge suit={view.trump} />
      <span>
        Round {view.round}/{view.totalRounds} · {view.handSize} {view.handSize === 1 ? "card" : "cards"} · Dealer {name(view.dealer)}
      </span>
    </span>
  );

  let board: ReactNode;
  if (bidding) {
    board = (
      <div className="g-judgement-felt">
        <div className="g-judgement-felt-label">{label}</div>
        <BidList view={view} name={name} />
      </div>
    );
  } else if (playing) {
    // A trick that just finished is cleared at once and kept as lastTrick: show it until the next card.
    const showingLast = view.trick.length === 0 && view.lastTrick !== null;
    const shown = showingLast ? view.lastTrick!.plays : view.trick;
    const caption = showingLast
      ? `${name(view.lastTrick!.winner)} won the trick · ${view.turn === me ? "your lead" : `${name(view.turn)} leads`}`
      : view.trick.length === 0
        ? `${name(view.turn)} ${view.turn === me ? "lead" : "leads"} trick ${view.tricksPlayed + 1}`
        : `Trick ${view.tricksPlayed + 1} of ${view.handSize}${view.ledSuit ? ` · ${SUIT_SYMBOL[view.ledSuit]} led` : ""}`;
    board = (
      <TableArea label={label}>
        <div className="g-judgement-play">
          <SizedTrick
            players={players}
            me={me}
            plays={shown.map((p) => ({ playerId: p.player, card: p.card }))}
            winner={showingLast ? view.lastTrick!.winner : null}
          />
          <div className="g-judgement-caption">
            <span className="g-judgement-caption-text" aria-live="polite">
              {showingLast && <span aria-hidden>🏆 </span>}
              {caption}
            </span>
            {!showingLast && view.lastTrick && (
              <button type="button" className="g-judgement-chip" onClick={() => setPeek(true)}>
                Last trick
              </button>
            )}
          </div>
          <div className="g-judgement-tally">
            Bids {view.bidTotal} for {view.handSize} {view.handSize === 1 ? "trick" : "tricks"} ·{" "}
            {view.bidTotal > view.handSize ? "over" : view.bidTotal < view.handSize ? "under" : "even"}
          </div>
        </div>
      </TableArea>
    );
  } else {
    board = <Summary view={view} me={me} players={players} scores={scores} over={phase === "over"} name={name} />;
  }

  // ---------- Bottom ----------
  const myBid = me !== null ? view.bids[me] : null;
  const myLine = seated && myBid !== null && myBid !== undefined ? (playing ? `Bid ${myBid} · Won ${view.tricksWon[me!] ?? 0}` : `You bid ${myBid}`) : null;
  const timer = deadline ? (
    <>
      {" "}
      · <Countdown deadline={deadline} />
    </>
  ) : null;

  let turnText: ReactNode;
  if (phase === "over") turnText = "Game over";
  else if (phase === "summary") turnText = canNext ? "Round over · deal the next one" : "Waiting for the host to deal";
  else if (myTurn) turnText = (
    <>
      {bidding ? "Your bid" : "Your turn"}
      {myLine && playing ? ` · ${myLine}` : ""}
      {timer}
    </>
  );
  else if (view.turn) turnText = (
    <>
      Waiting for {name(view.turn)}
      {myLine ? ` · ${myLine}` : ""}
      {timer}
    </>
  );

  const forbidden = view.forbiddenBid;
  const pickerMax = view.handSize;
  const disabledBids = Array.from({ length: pickerMax + 1 }, (_, i) => i).filter((n) => !bids.includes(n));
  const chosenBid = bid !== null && bids.includes(bid) ? bid : null;
  const selectedCard = selected[0] && plays.includes(selected[0]) ? selected[0] : null;

  const bottom = (
    <>
      <TurnIndicator active={active} me={me} players={players} text={turnText} />
      {seated && view.myHand.length > 0 && (
        <Hand
          cards={view.myHand}
          playable={playing ? plays : view.myHand}
          selected={playing ? selected : []}
          onSelect={playing ? setSelected : undefined}
          onPlay={playing && plays.length > 0 ? doPlay : undefined}
          size={bidding && myTurn ? "sm" : "md"}
          disabled={!playing}
        />
      )}
      {bidding && myTurn && bids.length > 0 && (
        <div className="g-judgement-bid">
          <NumberPicker min={0} max={pickerMax} value={chosenBid} onChange={setBid} disabled={disabledBids} label="Your bid" />
          <div className="g-judgement-note">
            {forbidden !== null
              ? `Can't bid ${forbidden}: total would equal ${view.handSize}`
              : `Bids so far: ${view.bidTotal} for ${view.handSize}`}
          </div>
        </div>
      )}
      <ActionBar>
        {bidding && myTurn && bids.length > 0 && (
          <Button variant="primary" size="lg" disabled={pending || chosenBid === null} onClick={() => chosenBid !== null && doBid(chosenBid)}>
            {chosenBid === null ? "Pick a bid" : `Bid ${chosenBid}`}
          </Button>
        )}
        {playing && plays.length > 0 && (
          <Button variant="primary" size="lg" disabled={pending || selectedCard === null} onClick={() => selectedCard && doPlay(selectedCard)}>
            {selectedCard === null ? "Tap a card" : "Play card"}
          </Button>
        )}
        {canHurry && isHost && (
          <Button size="sm" disabled={pending} onClick={() => act({ type: "hurry" })}>
            ⏱ Hurry {name(view.turn)}
          </Button>
        )}
        {canNext && isHost && (
          <Button variant="primary" size="lg" disabled={pending} onClick={() => act({ type: "nextRound" })}>
            {view.next ? `Deal round ${view.next.round} · ${view.next.handSize} ${view.next.handSize === 1 ? "card" : "cards"}` : "Next round"}
          </Button>
        )}
      </ActionBar>
    </>
  );

  return (
    <>
      <GameScreen top={<PlayerStrip me={me} players={strip} />} board={board} bottom={bottom} />
      <Sheet open={peek && view.lastTrick !== null} onClose={() => setPeek(false)} title="Last trick">
        {view.lastTrick && <LastTrick trick={view.lastTrick} name={name} />}
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------

const SIZE_ORDER: CardSize[] = ["xs", "sm", "md"];

/** The kit Trick with a card size that fits the space it gets (and the kit's per-count cap). */
function SizedTrick(props: { players: SeatInfo[]; me: PlayerId | null; plays: { playerId: PlayerId; card: Card }[]; winner: PlayerId | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const n = props.players.length;
  const cap: CardSize = n <= 4 ? "md" : n <= 6 ? "sm" : "xs";
  const fit: CardSize = h >= 330 ? "md" : h >= 175 ? "sm" : "xs";
  const size = SIZE_ORDER[Math.min(SIZE_ORDER.indexOf(cap), SIZE_ORDER.indexOf(fit))];
  return (
    <div className="g-judgement-trick" ref={ref}>
      <Trick {...props} size={size} />
    </div>
  );
}

function BidList({ view, name }: { view: View; name: (id: PlayerId | null) => string }) {
  const lastBidder = view.bidOrder[view.bidOrder.length - 1];
  return (
    <div className="g-judgement-bids">
      <ol className="g-judgement-bidlist" aria-label="Bids in bidding order">
        {view.bidOrder.map((id) => {
          const b = view.bids[id];
          const now = view.turn === id;
          return (
            <li key={id} className={`g-judgement-bidrow ${now ? "g-judgement-bidrow--now" : ""}`}>
              {now && <span aria-hidden>▶</span>}
              <span className="g-judgement-bidname">{name(id)}</span>
              {id === view.dealer && <span className="g-judgement-tag" aria-label="dealer">D</span>}
              <span className="g-judgement-bidval">{b !== null && b !== undefined ? b : now ? "…" : "–"}</span>
            </li>
          );
        })}
      </ol>
      <div className="g-judgement-tally">
        Bids total {view.bidTotal} of {view.handSize}
        {view.forbiddenBid !== null && view.turn === lastBidder ? ` · ${name(lastBidder)} can't bid ${view.forbiddenBid}` : ""}
      </div>
    </div>
  );
}

function LastTrick({ trick, name }: { trick: CompletedTrick; name: (id: PlayerId | null) => string }) {
  return (
    <div className="gc-stack">
      <div className="g-judgement-last">
        {trick.plays.map((p) => (
          <div key={p.player} className={`g-judgement-last-play ${p.player === trick.winner ? "g-judgement-last-play--win" : ""}`}>
            <PlayingCard card={p.card} size="sm" />
            <span className="gc-small">{name(p.player)}</span>
            {p.player === trick.winner && <span className="gc-small">🏆 won</span>}
          </div>
        ))}
      </div>
      <p className="gc-muted gc-center gc-small">In play order. {name(trick.winner)} won it.</p>
    </div>
  );
}

function Summary({
  view,
  me,
  players,
  scores,
  over,
  name,
}: {
  view: View;
  me: PlayerId | null;
  players: SeatInfo[];
  scores: GameUIProps["scores"];
  over: boolean;
  name: (id: PlayerId | null) => string;
}) {
  const r: RoundResult | null = view.lastRound;
  const columns: ScoreColumn[] = view.history.map((h) => ({
    label: `R${h.round}`,
    values: Object.fromEntries(view.order.map((id) => [id, `${h.made[id] ? "✓" : "✗"}${signed(h.points[id] ?? 0)}`])),
  }));
  const top = scores.filter((s) => s.rank === 1).map((s) => name(s.playerId));
  const mine = r && me !== null && me in r.bids ? r : null;
  return (
    <div className="gc-stack g-judgement-summary">
      {over ? (
        <BigStatus>
          🏆 {top.join(" & ")} {top.length === 1 && top[0] !== "You" ? "wins" : "win"}!
        </BigStatus>
      ) : (
        <BigStatus>Round {view.round} done</BigStatus>
      )}
      {r && (
        <>
          <div className="g-judgement-roundhead gc-muted gc-small">
            Round {r.round}: {r.handSize} {r.handSize === 1 ? "card" : "cards"}, {trumpLabel(r.trump)}
            {mine && ` · you ${mine.made[me!] ? "made it" : "missed"} (${mine.bids[me!]} bid, ${mine.won[me!]} won)`}
          </div>
          <div className="gc-label">This round</div>
          <Scoreboard
            scores={scores}
            players={players}
            me={me}
            columns={[
              { label: "Bid", values: r.bids },
              { label: "Won", values: r.won },
              { label: "Pts", values: Object.fromEntries(view.order.map((id) => [id, `${r.made[id] ? "✓" : "✗"} ${signed(r.points[id] ?? 0)}`])) },
            ]}
          />
        </>
      )}
      {columns.length > 1 && (
        <>
          <div className="gc-label">Round by round</div>
          <Scoreboard scores={scores} players={players} me={me} columns={columns} />
        </>
      )}
      {!over && view.next && (
        <p className="gc-muted gc-small gc-center">
          Next: round {view.next.round}, {view.next.handSize} {view.next.handSize === 1 ? "card" : "cards"}, {trumpLabel(view.next.trump)}, dealer {name(view.next.dealer)}
        </p>
      )}
    </div>
  );
}
