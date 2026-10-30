/** App-level helpers: device session, tiny router, error messages. */
import { useEffect, useState } from "react";
import { ConvexError } from "convex/values";

// ---------- Session (no accounts: a random device token in localStorage) ----------

const TOKEN_KEY = "gamecrow:token";
const NAME_KEY = "gamecrow:name";
const LAST_ROOM_KEY = "gamecrow:lastRoom";

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

let memoryToken: string | null = null;
/** Secret that identifies this device's seat in every room. Refresh = same seat. */
export function deviceToken(): string {
  const stored = storageGet(TOKEN_KEY);
  if (stored) return stored;
  memoryToken ??= crypto.randomUUID();
  storageSet(TOKEN_KEY, memoryToken);
  return memoryToken;
}

export const savedName = () => storageGet(NAME_KEY) ?? "";
export const saveName = (n: string) => storageSet(NAME_KEY, n.trim());
export const lastRoom = () => storageGet(LAST_ROOM_KEY);
export const saveLastRoom = (code: string) => storageSet(LAST_ROOM_KEY, code);

// ---------- Router ----------

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event("gc:navigate"));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener("gc:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("gc:navigate", update);
    };
  }, []);
  return path;
}

// ---------- Errors ----------

export function errorText(e: unknown): string {
  if (e instanceof ConvexError) return typeof e.data === "string" ? e.data : "Something went wrong";
  if (e instanceof Error && /network|fetch|connection/i.test(e.message)) return "Connection problem. Retrying…";
  return "Something went wrong. Try again.";
}

export const ROOM_CODE_RE = /^[A-Z]{4}$/;
