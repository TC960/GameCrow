/**
 * Client-side game UI registry (lazy-loaded per game). Owned by the lead, like registry.ts.
 * Only ui.tsx modules are listed here: rules never ship to clients.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameUIProps } from "../ui/kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGameUI = LazyExoticComponent<ComponentType<GameUIProps<any, any>>>;

export const GAME_UIS: Record<string, AnyGameUI> = {
  highcard: lazy(() => import("./highcard/ui")),
};
