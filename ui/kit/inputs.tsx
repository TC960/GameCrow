/** Hold-to-reveal, role cards, number picker, choice list, text entry. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "./device";

/**
 * Hidden info shown only while the player keeps a finger on it. The secret is not even rendered
 * while released, and it hides again on release, pointer cancel, or when the tab is hidden.
 */
export function HoldToReveal({
  children,
  label = "Hold to reveal",
  hint = "Release to hide",
  onReveal,
}: {
  children: ReactNode;
  label?: ReactNode;
  hint?: ReactNode;
  /** Called the first time it is revealed (e.g. to mark "seen"). */
  onReveal?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const revealed = useRef(false);
  useEffect(() => {
    const hide = () => setOpen(false);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  const show = () => {
    setOpen(true);
    haptic("reveal");
    if (!revealed.current) {
      revealed.current = true;
      onReveal?.();
    }
  };
  const hide = () => setOpen(false);
  return (
    <div
      className={`gc-reveal ${open ? "gc-reveal--open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={typeof label === "string" ? label : "Hold to reveal"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        show();
      }}
      onPointerUp={hide}
      onPointerCancel={hide}
      onLostPointerCapture={hide}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && show()}
      onKeyUp={hide}
      onBlur={hide}
    >
      {open ? (
        children
      ) : (
        <>
          <span className="gc-reveal-icon" aria-hidden>
            👆
          </span>
          <strong>{label}</strong>
          <span className="gc-muted gc-small">{hint}</span>
        </>
      )}
    </div>
  );
}

/** Big role display (use inside HoldToReveal for secret roles). */
export function RoleCard({ emoji, title, subtitle }: { emoji: string; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="gc-role">
      <span className="gc-role-emoji" aria-hidden>
        {emoji}
      </span>
      <span className="gc-role-title">{title}</span>
      {subtitle && <span className="gc-role-sub">{subtitle}</span>}
    </div>
  );
}

/** Round number buttons for bids. `disabled` values are struck through (e.g. the forbidden last bid). */
export function NumberPicker({
  min,
  max,
  value,
  onChange,
  disabled = [],
  label,
}: {
  min: number;
  max: number;
  value: number | null;
  onChange: (n: number) => void;
  disabled?: number[];
  label?: string;
}) {
  const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="gc-numbers" role="radiogroup" aria-label={label}>
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={`gc-number ${value === n ? "gc-number--on" : ""}`}
          disabled={disabled.includes(n)}
          onClick={() => {
            haptic("tap");
            onChange(n);
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export interface Choice<T extends string = string> {
  value: T;
  label: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  /** Leading element, e.g. an <Avatar>. */
  icon?: ReactNode;
}

/** Full-width tappable options (votes, picking a player, answers). */
export function ChoiceList<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Choice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="gc-choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`gc-choice ${value === o.value ? "gc-choice--on" : ""}`}
          disabled={o.disabled}
          onClick={() => {
            haptic("tap");
            onChange(o.value);
          }}
        >
          {o.icon}
          <span className="gc-grow">
            {o.label}
            {o.sub && <span className="gc-choice-sub">{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Text input + submit for the bottom zone. 16px+ font (no iOS zoom); the app shell keeps it
 * above the on-screen keyboard. Enter submits.
 */
export function TextEntry({
  value,
  onChange,
  onSubmit,
  placeholder,
  maxLength = 80,
  submitLabel = "Submit",
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  submitLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const submit = () => {
    const v = value.trim();
    if (!v || disabled) return;
    onSubmit(v);
  };
  return (
    <form
      className="gc-row"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        ref={ref}
        className="gc-input gc-grow"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="on"
        enterKeyHint="send"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setTimeout(() => ref.current?.scrollIntoView({ block: "nearest" }), 300)}
      />
      <button type="submit" className="gc-btn gc-btn--primary" disabled={disabled || !value.trim()}>
        {submitLabel}
      </button>
    </form>
  );
}
