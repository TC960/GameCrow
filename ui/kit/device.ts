/** Device helpers: haptics, wake lock, orientation, keyboard inset, tilt. All fail silently when unsupported. */
import { useCallback, useEffect, useRef, useState } from "react";
import { getPrefs } from "./prefs";

export type HapticKind = "tap" | "turn" | "success" | "error" | "reveal";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  turn: [30, 60, 30],
  success: [20, 40, 60],
  error: [60, 40, 60],
  reveal: 15,
};

/** Vibrate (no-op on iOS Safari and when the player turned haptics off). */
export function haptic(kind: HapticKind = "tap"): void {
  if (!getPrefs().haptics) return;
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    // ignore
  }
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

/** Keep the screen awake while `enabled`. Re-acquires after the tab becomes visible again. */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((s) => {
          if (cancelled) s.release().catch(() => {});
          else sentinel = s;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}

/** "portrait" | "landscape", plus whether this looks like a phone held sideways (short viewport). */
export function useOrientation(): { orientation: "portrait" | "landscape"; shortLandscape: boolean } {
  const read = () => {
    if (typeof window === "undefined") return { orientation: "portrait" as const, shortLandscape: false };
    const landscape = window.matchMedia("(orientation: landscape)").matches;
    return { orientation: landscape ? ("landscape" as const) : ("portrait" as const), shortLandscape: landscape && window.innerHeight < 500 };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return state;
}

/**
 * Sets --app-height to the visual viewport height so the on-screen keyboard never covers
 * bottom-anchored inputs (iOS does not resize the layout viewport). Call once at the app root.
 */
export function useKeyboardAwareHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const keyboard = window.innerHeight - vv.height > 120;
      root.style.setProperty("--app-height", keyboard ? `${vv.height}px` : "100dvh");
      if (keyboard) window.scrollTo(0, 0);
    };
    vv.addEventListener("resize", update);
    update();
    return () => vv.removeEventListener("resize", update);
  }, []);
}

/** Calls `fn` when `value` changes from false to true (e.g. it just became my turn). */
export function useRisingEdge(value: boolean, fn: () => void): void {
  const prev = useRef(value);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (value && !prev.current) latest.current();
    prev.current = value;
  }, [value]);
}

export interface Tilt {
  /** "unknown" until requested on iOS; "granted"/"denied" afterwards; "unsupported" without sensors. */
  permission: "unknown" | "granted" | "denied" | "unsupported";
  /** Front-back tilt in degrees (-180..180) or null before the first reading. */
  beta: number | null;
  /** Left-right tilt in degrees (-90..90). */
  gamma: number | null;
  /** Must be called from a tap handler (iOS requires a user gesture). */
  request(): Promise<boolean>;
}

/** Device tilt for motion games. Call request() from a "Start" button tap. */
export function useDeviceTilt(): Tilt {
  type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
  const supported = typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  const [permission, setPermission] = useState<Tilt["permission"]>(supported ? "unknown" : "unsupported");
  const [angles, setAngles] = useState<{ beta: number | null; gamma: number | null }>({ beta: null, gamma: null });

  useEffect(() => {
    if (permission !== "granted") return;
    const onOrient = (e: DeviceOrientationEvent) => setAngles({ beta: e.beta, gamma: e.gamma });
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [permission]);

  const request = useCallback(async () => {
    if (!supported) return false;
    const Ctor = window.DeviceOrientationEvent as DOE;
    try {
      const result = Ctor.requestPermission ? await Ctor.requestPermission() : "granted";
      setPermission(result);
      return result === "granted";
    } catch {
      setPermission("denied");
      return false;
    }
  }, [supported]);

  return { permission, ...angles, request };
}
