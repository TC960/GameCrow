/** Bottom sheet, toasts, rotate prompt. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./basics";

/** Bottom sheet modal. Tap the backdrop or ✕ to close. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="gc-backdrop" onClick={onClose}>
      <div className="gc-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="gc-sheet-grip" />
        <div className="gc-sheet-head">
          <h2 className="gc-h2 gc-grow">{title}</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

type Tone = "info" | "error" | "success";
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

/** Provided by the app shell. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((text: string, tone: Tone = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.filter((x) => x.text !== text), { id, text, tone }].slice(-3));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "error" ? 3500 : 2500);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="gc-toasts" aria-live="assertive">
        {items.map((t) => (
          <div key={t.id} className={`gc-toast gc-toast--${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast("Copied!", "success")`. */
export function useToast() {
  return useContext(ToastContext);
}

/** Full-screen "rotate your phone" prompt. */
export function RotatePrompt({ to = "portrait" }: { to?: "portrait" | "landscape" }) {
  return (
    <div className="gc-rotate" role="alert">
      <span className="gc-rotate-icon" aria-hidden>
        📱
      </span>
      <strong>Rotate your phone</strong>
      <span className="gc-muted">This game plays in {to} mode.</span>
    </div>
  );
}
