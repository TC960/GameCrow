/** Table area, trick layout, opponents strip, turn indicator and scoreboard. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Card } from "../../engine/cards";
import type { PlayerId, ScoreLine } from "../../engine/types";
import { Avatar } from "./basics";
import { PlayingCard, type CardSize } from "./cards";
import type { SeatInfo } from "./types";

/** Felt-green play area for the middle of the screen. */
export function TableArea({ children, label }: { children?: ReactNode; label?: ReactNode }) {
  return (
    <div className="gc-table">
      {label && <div className="gc-table-label">{label}</div>}
      <div className="gc-table-body">{children}</div>
    </div>
  );
}

/**
 * Seat positions around an oval relative to `me` (me at the bottom), as percentages.
 * Works for spectators too (seat 0 at the bottom).
 */
export function seatPositions(players: { id: PlayerId; seat: number }[], me: PlayerId | null): Record<PlayerId, { x: number; y: number }> {
  const ordered = players.slice().sort((a, b) => a.seat - b.seat);
  const n = ordered.length;
  const myIndex = Math.max(0, ordered.findIndex((p) => p.id === me));
  const out: Record<PlayerId, { x: number; y: number }> = {};
  ordered.forEach((p, i) => {
    const k = (i - myIndex + n) % n;
    // Clockwise from the bottom.
    const angle = Math.PI / 2 + (2 * Math.PI * k) / n;
    out[p.id] = { x: 50 + 38 * Math.cos(angle), y: 50 + 33 * Math.sin(angle) };
  });
  return out;
}

export interface TrickPlay {
  playerId: PlayerId;
  card: Card;
}

const CARD_W: Record<CardSize, number> = { xs: 34, sm: 46, md: 60, lg: 78 };
const NAME_H = 18;

/** Largest card size (≤ `max`) whose oval layout fits inside a w×h box. */
function fitSize(w: number, h: number, n: number, max: CardSize): CardSize {
  const order: CardSize[] = ["lg", "md", "sm", "xs"];
  for (const s of order.slice(order.indexOf(max))) {
    const cw = CARD_W[s], ch = cw * 1.42 + NAME_H;
    // Vertical spread between the top and bottom seats, horizontal between left/right seats.
    const needH = ch + (n > 1 ? ch * 1.15 : 0);
    const needW = cw + (n > 2 ? cw * 2.2 : 0);
    if (needH <= h && needW <= w) return s;
  }
  return "xs";
}

/**
 * Cards on the table placed by seat (me at the bottom). Highlights `winner` when the trick is done.
 * Card size fits the available space (and player count) unless `size` is given; cards never spill
 * outside the table area.
 */
export function Trick({
  plays,
  players,
  me,
  winner,
  size,
}: {
  plays: TrickPlay[];
  players: SeatInfo[];
  me: PlayerId | null;
  winner?: PlayerId | null;
  size?: CardSize;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 220 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const n = players.length;
  const maxSize: CardSize = n <= 4 ? "md" : n <= 6 ? "sm" : "xs";
  const cardSize = size ?? fitSize(box.w, box.h, n, maxSize);
  const cw = CARD_W[cardSize], ch = cw * 1.42 + NAME_H;
  // Keep every slot's centre far enough from the edges that the whole card + name stay inside.
  const rx = Math.max(0, 50 - ((cw / 2 + 4) / Math.max(box.w, 1)) * 100);
  const ry = Math.max(0, 50 - ((ch / 2 + 4) / Math.max(box.h, 1)) * 100);
  const pos = seatPositions(players, me);
  const place = (id: PlayerId) => {
    const p = pos[id] ?? { x: 50, y: 50 };
    // seatPositions uses radii 38/33; rescale them to the radii that fit.
    return { x: 50 + ((p.x - 50) / 38) * rx, y: 50 + ((p.y - 50) / 33) * ry };
  };
  const names = Object.fromEntries(players.map((p) => [p.id, p.id === me ? "You" : p.name]));
  return (
    <div className="gc-trick" ref={ref} aria-label="Cards on the table">
      {plays.map((p, i) => {
        const at = place(p.playerId);
        return (
          <div
            key={p.playerId}
            className={`gc-trick-slot ${winner === p.playerId ? "gc-trick-slot--win" : ""}`}
            style={{ left: `${at.x}%`, top: `${at.y}%`, zIndex: i + 1 }}
          >
            <PlayingCard card={p.card} size={cardSize} />
            <span className="gc-trick-name">{names[p.playerId] ?? "?"}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface StripPlayer {
  id: PlayerId;
  name: string;
  online?: boolean;
  isBot?: boolean;
  /** Highlighted (whose turn). */
  active?: boolean;
  /** Greyed (e.g. finished / out). */
  dim?: boolean;
  /** Top-right badge, e.g. card count "🂠 7". */
  badge?: ReactNode;
  /** Second line, e.g. "Bid 2 · Won 1" or the score. */
  sub?: ReactNode;
}

/** Compact opponents/scores row for the top of the screen. Scrolls horizontally with many players. */
export function PlayerStrip({ players, me }: { players: StripPlayer[]; me: PlayerId | null }) {
  return (
    <div className="gc-strip" role="list">
      {players.map((p) => (
        <div
          key={p.id}
          role="listitem"
          className={[
            "gc-strip-player",
            p.active && "gc-strip-player--active",
            p.id === me && "gc-strip-player--me",
            p.dim && "gc-strip-player--dim",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={p.active ? "true" : undefined}
        >
          {p.badge !== undefined && <span className="gc-strip-badge">{p.badge}</span>}
          <Avatar id={p.id} name={p.name} online={p.online} isBot={p.isBot} />
          <span className="gc-strip-name">{p.id === me ? "You" : p.name}</span>
          {p.sub !== undefined && <span className="gc-strip-sub">{p.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Build strip entries from the shell's players + `active`, adding game-specific fields. */
export function stripPlayers(
  players: SeatInfo[],
  active: PlayerId[],
  extra: (id: PlayerId) => Partial<StripPlayer> = () => ({}),
): StripPlayer[] {
  return players.map((p) => ({ id: p.id, name: p.name, online: p.online, isBot: p.isBot, active: active.includes(p.id), ...extra(p.id) }));
}

/** "Your turn" (pulsing) or "Waiting for Ravi" / "Waiting for 3 players". Override with `text`. */
export function TurnIndicator({ active, me, players, text }: { active: PlayerId[]; me: PlayerId | null; players: SeatInfo[]; text?: ReactNode }) {
  const mine = me !== null && active.includes(me);
  let content: ReactNode = text;
  if (content === undefined) {
    if (mine) content = active.length > 1 ? "Your move" : "Your turn";
    else if (active.length === 0) content = "…";
    else if (active.length === 1) content = `Waiting for ${players.find((p) => p.id === active[0])?.name ?? "player"}`;
    else content = `Waiting for ${active.length} players`;
  }
  return (
    <div className={`gc-turn ${mine ? "gc-turn--mine" : ""}`} role="status" aria-live="polite">
      {content}
    </div>
  );
}

export interface ScoreColumn {
  label: string;
  values: Record<PlayerId, ReactNode>;
}

/**
 * Standings table: rank, name, optional extra columns (e.g. per round), total.
 * `scores` comes straight from props.scores (already ranked).
 */
export function Scoreboard({ scores, players, me, columns = [] }: { scores: ScoreLine[]; players: { id: PlayerId; name: string }[]; me: PlayerId | null; columns?: ScoreColumn[] }) {
  const name = (id: PlayerId) => (id === me ? "You" : players.find((p) => p.id === id)?.name ?? "?");
  return (
    <div className="gc-scores-wrap">
      <table className="gc-scores">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            {columns.map((c) => (
              <th key={c.label}>{c.label}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.playerId} className={s.playerId === me ? "gc-scores-me" : undefined}>
              <td className={s.rank === 1 ? "gc-rank-1" : undefined}>{s.rank === 1 ? "👑" : s.rank}</td>
              <td>{name(s.playerId)}</td>
              {columns.map((c) => (
                <td key={c.label}>{c.values[s.playerId] ?? "–"}</td>
              ))}
              <td>
                <strong>{s.score}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
