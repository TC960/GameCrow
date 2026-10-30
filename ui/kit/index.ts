/**
 * GameCrow shared UI kit. Game UIs (games/<name>/ui.tsx) build only from these exports
 * plus plain elements. Frozen for game fleets: request changes from the lead.
 */
export * from "./types";
export * from "./basics";
export * from "./cards";
export * from "./table";
export * from "./inputs";
export * from "./overlays";
export { haptic, useWakeLock, useOrientation, useDeviceTilt, useRisingEdge, useCompact, type HapticKind, type Tilt } from "./device";
export { usePrefs, type Prefs } from "./prefs";
