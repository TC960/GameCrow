/** Service worker registration and the one-time iOS "Add to Home Screen" hint. */
import { useState } from "react";
import { Banner, IconButton } from "../ui/kit";

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const HINT_KEY = "gamecrow:a2hsHintShown";

function shouldShowHint(): boolean {
  try {
    const ua = navigator.userAgent;
    const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!iOS || standalone || localStorage.getItem(HINT_KEY) === "1") return false;
    localStorage.setItem(HINT_KEY, "1"); // one-time: never shown on a later visit
    return true;
  } catch {
    return false;
  }
}

/** Shown once on iOS Safari: how to install GameCrow as an app. */
export function InstallHint() {
  const [show, setShow] = useState(shouldShowHint);
  if (!show) return null;
  const dismiss = () => setShow(false);
  return (
    <Banner tone="accent">
      <div className="gc-row">
        <span className="gc-grow">
          <strong>Install GameCrow:</strong> tap <span aria-label="Share">⎋ Share</span>, then <strong>Add to Home Screen</strong> for full-screen play.
        </span>
        <IconButton aria-label="Dismiss" onClick={dismiss}>
          ✕
        </IconButton>
      </div>
    </Banner>
  );
}
