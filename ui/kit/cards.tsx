/** Playing cards, card backs, suit badges and the hand fan. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RANK_LABEL,
  SUIT_NAME,
  SUIT_SYMBOL,
  cardName,
  parseCard,
  sortCards,
  type Card,
  type Suit,
} from "../../engine/cards";
import { haptic } from "./device";
import { usePrefs } from "./prefs";

export type CardSize = "xs" | "sm" | "md" | "lg";

export interface PlayingCardProps {
  card: Card;
  size?: CardSize;
  selected?: boolean;
  /** Greyed out (e.g. not playable). Still tappable unless `disabled`. */
  dim?: boolean;
  /** Outline to show it can be played. */
  highlight?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/** A face-up card. Suits use colour + symbol (+ optional four-colour deck), never colour alone. */
export function PlayingCard({ card, size = "md", selected, dim, highlight, disabled, onClick, className = "", style }: PlayingCardProps) {
  const p = parseCard(card);
  const cls = [
    "gc-card",
    `gc-card--${size}`,
    p.joker ? "gc-card--joker" : `gc-card--${p.suit}`,
    selected && "gc-card--selected",
    dim && "gc-card--dim",
    highlight && "gc-card--playable",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const face = p.joker ? (
    <span aria-hidden>★</span>
  ) : (
    <>
      <span className="gc-card-corner" aria-hidden>
        <span className="gc-card-rank">{RANK_LABEL[p.rank!]}</span>
        <span className="gc-card-suit">{SUIT_SYMBOL[p.suit!]}</span>
      </span>
      <span className="gc-card-pip" aria-hidden>
        {SUIT_SYMBOL[p.suit!]}
      </span>
    </>
  );
  if (!onClick) {
    return (
      <div className={cls} style={style} role="img" aria-label={cardName(card)}>
        {face}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      style={style}
      disabled={disabled}
      aria-label={cardName(card)}
      aria-pressed={selected}
      onClick={onClick}
    >
      {face}
    </button>
  );
}

/** Face-down card, optionally with a count badge (e.g. opponents' hand sizes). */
export function CardBack({ size = "md", count, style }: { size?: CardSize; count?: number; style?: React.CSSProperties }) {
  return (
    <div className={`gc-card gc-card--${size} gc-card-back`} style={style} role="img" aria-label={count !== undefined ? `${count} cards` : "Face-down card"}>
      {count !== undefined && <span className="gc-card-back-count">{count}</span>}
    </div>
  );
}

/** Empty dashed card-sized slot (e.g. where the next card in a suit goes). `children` shows inside (e.g. "8"). */
export function CardSlot({ size = "md", label, children }: { size?: CardSize; label?: string; children?: React.ReactNode }) {
  return (
    <div className={`gc-card gc-card--${size} gc-card-slot`} aria-label={label} role={label ? "img" : undefined}>
      {children !== undefined && <span className="gc-card-slot-text">{children}</span>}
    </div>
  );
}

/** Suit chip like "♠ Spades"; `suit` null shows "No trump". */
export function SuitBadge({ suit, showName = true }: { suit: Suit | null; showName?: boolean }) {
  if (!suit) return <span className="gc-suit-badge gc-suit-badge--none">No trump</span>;
  return (
    <span className={`gc-suit-badge gc-card--${suit}`} aria-label={SUIT_NAME[suit]}>
      <span aria-hidden>{SUIT_SYMBOL[suit]}</span>
      {showName && <span>{SUIT_NAME[suit]}</span>}
    </span>
  );
}

const CARD_PX: Record<CardSize, number> = { xs: 34, sm: 46, md: 60, lg: 78 };
/** Minimum visible width of an overlapped card so every card stays a >= 44px tap target. */
const MIN_VISIBLE = 44;

export interface HandProps {
  cards: Card[];
  /**
   * Cards that may be played now; others are dimmed. Omit to treat all as playable.
   * Pass [] when it's not your turn (all dimmed, but still selectable for planning).
   */
  playable?: Card[];
  /** Tap a selected card again (or press your Play button) to play it. Omit for a display-only hand. */
  onPlay?: (card: Card) => void;
  /** Multi-select mode (e.g. discard several): `selected` + `onSelect` are then required. */
  multi?: boolean;
  /** Controlled selection. If omitted, the hand keeps its own single selection. */
  selected?: Card[];
  onSelect?: (cards: Card[]) => void;
  size?: CardSize;
  /** Show the sort toggle (default true). The order is a per-device preference. */
  sortable?: boolean;
  /** Keep the given order instead of auto-sorting. */
  unsorted?: boolean;
  /** Sort Aces below 2 (e.g. Badam Satti). Default false (Ace high). */
  aceLow?: boolean;
  label?: string;
  disabled?: boolean;
}

/**
 * Your hand: overlapping, horizontally scrollable fan, auto-sorted (suit or rank toggle).
 * Tap a card to select (it lifts); tap it again to play. Non-playable cards are dimmed and cannot be played.
 */
export function Hand({
  cards,
  playable,
  onPlay,
  multi,
  selected: controlled,
  onSelect,
  size = "md",
  sortable = true,
  unsorted,
  aceLow,
  label = "Your hand",
  disabled,
}: HandProps) {
  const [prefs, setPrefs] = usePrefs();
  const [internal, setInternal] = useState<Card[]>([]);
  const selected = controlled ?? internal;
  const setSelected = (next: Card[]) => {
    if (!controlled) setInternal(next);
    onSelect?.(next);
  };
  const sorted = useMemo(
    () => (unsorted ? cards : sortCards(cards, prefs.handSort, { aceLow })),
    [cards, prefs.handSort, unsorted, aceLow],
  );
  const playableSet = useMemo(() => new Set(playable ?? cards), [playable, cards]);

  // Drop selections of cards that left the hand.
  useEffect(() => {
    if (!controlled && internal.some((c) => !cards.includes(c))) setInternal(internal.filter((c) => cards.includes(c)));
  }, [cards, controlled, internal]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cardW = CARD_PX[size];
  const n = sorted.length;
  const fitVisible = n > 1 ? (width - 16 - cardW) / (n - 1) : cardW;
  const visible = Math.max(MIN_VISIBLE, Math.min(cardW + 4, fitVisible));
  const overlap = `${Math.round(visible - cardW)}px`;

  const tap = (card: Card) => {
    if (disabled) return;
    if (multi) {
      haptic("tap");
      setSelected(selected.includes(card) ? selected.filter((c) => c !== card) : [...selected, card]);
      return;
    }
    if (selected[0] === card) {
      if (onPlay && playableSet.has(card)) {
        haptic("success");
        onPlay(card);
        setSelected([]);
      } else {
        haptic("error");
      }
      return;
    }
    haptic("tap");
    setSelected([card]);
  };

  let prevSuit: string | undefined;
  return (
    <div className="gc-hand">
      <div className="gc-hand-toolbar">
        <span className="gc-label">
          {label} · {n}
        </span>
        {sortable && !unsorted && n > 1 && (
          <button
            type="button"
            className="gc-chip-toggle"
            onClick={() => setPrefs({ handSort: prefs.handSort === "suit" ? "rank" : "suit" })}
            aria-label={`Sorted by ${prefs.handSort}. Tap to sort by ${prefs.handSort === "suit" ? "rank" : "suit"}`}
          >
            Sort: {prefs.handSort === "suit" ? "Suit" : "Rank"}
          </button>
        )}
      </div>
      <div className="gc-hand-scroll" ref={scrollRef}>
        {n === 0 ? (
          <div className="gc-hand-empty">No cards</div>
        ) : (
          <div className="gc-hand-row" style={{ "--overlap": overlap } as React.CSSProperties}>
            {sorted.map((card, i) => {
              const suit = card[1];
              const brk = i > 0 && prefs.handSort === "suit" && !unsorted && suit !== prevSuit;
              prevSuit = suit;
              const canPlay = playableSet.has(card);
              return (
                <PlayingCard
                  key={card}
                  card={card}
                  size={size}
                  selected={selected.includes(card)}
                  dim={!canPlay}
                  disabled={disabled}
                  className={brk ? "gc-suit-break" : undefined}
                  style={{ zIndex: i }}
                  onClick={() => tap(card)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
