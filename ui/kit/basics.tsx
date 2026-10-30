/** Buttons, layout, avatars, banners: the building blocks every screen uses. */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { haptic } from "./device";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
}

/** Pill button, at least 48px tall (44px for size "sm"). */
export function Button({ variant = "secondary", size = "md", block, className = "", onClick, ...rest }: ButtonProps) {
  const cls = [
    "gc-btn",
    variant !== "secondary" && `gc-btn--${variant}`,
    size !== "md" && `gc-btn--${size}`,
    block && "gc-btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => {
        haptic("tap");
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

/** Round 44px icon button. Always pass an aria-label. */
export function IconButton({ className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return <button type="button" className={`gc-btn gc-btn--ghost gc-icon-btn ${className}`} {...rest} />;
}

/** Row of primary actions for the bottom (thumb) zone. Children are usually <Button>s. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="gc-action-bar">{children}</div>;
}

/**
 * Standard game layout. `top`: opponents/scores (compact). `board`: the table, flexible and scrollable.
 * `bottom`: your hand + action buttons, kept in the thumb zone above the home bar.
 */
export function GameScreen({ top, board, bottom }: { top?: ReactNode; board?: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="gc-game">
      {top && <div className="gc-game-top">{top}</div>}
      <div className="gc-game-board">{board}</div>
      {bottom && <div className="gc-game-bottom">{bottom}</div>}
    </div>
  );
}

const AVATAR_COLORS = ["#ffc23d", "#7cc4ff", "#ff8fa3", "#8be28b", "#c4a7ff", "#ffb07c", "#6ee7d8", "#f9a8d4"];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Initial in a coloured circle; optional online dot. Bots show a robot. */
export function Avatar({ id, name, online, isBot, size = "md" }: { id: string; name: string; online?: boolean; isBot?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`gc-avatar ${size === "lg" ? "gc-avatar--lg" : ""}`} style={{ background: colorFor(id) }} aria-hidden>
      {isBot ? "🤖" : (name.trim()[0] ?? "?").toUpperCase()}
      {online !== undefined && <span className={`gc-online-dot ${online ? "" : "gc-online-dot--off"}`} />}
    </span>
  );
}

/** Informational box. `tone="accent"` for calls to action. */
export function Banner({ children, tone }: { children: ReactNode; tone?: "accent" }) {
  return <div className={`gc-banner ${tone === "accent" ? "gc-banner--accent" : ""}`}>{children}</div>;
}

/** Large centred status line for the board ("Raja is revealed!", "Round 3 of 7"). */
export function BigStatus({ children }: { children: ReactNode }) {
  return <div className="gc-big-status">{children}</div>;
}

/** Seconds left until `deadline` (epoch ms). Turns red under 10s. */
export function Countdown({ deadline, label }: { deadline: number | null; label?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className={`gc-countdown ${secs <= 10 ? "gc-countdown--low" : ""}`} aria-live="polite">
      {label ? `${label} ` : ""}
      {secs}s
    </span>
  );
}
