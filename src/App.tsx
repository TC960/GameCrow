import { lazy, Suspense } from "react";
import { ToastProvider } from "../ui/kit";
import { useKeyboardAwareHeight } from "../ui/kit/device";
import { usePath } from "./lib";
import { Home } from "./screens/Home";
import { Room } from "./screens/Room";

// Dev-only: the sandbox bundles game rules, which must never ship to production clients.
const Sandbox = import.meta.env.DEV ? lazy(() => import("./sandbox/Sandbox")) : null;

export function App({ online }: { online: boolean }) {
  useKeyboardAwareHeight();
  const path = usePath();
  const room = path.match(/^\/r\/([A-Za-z]{4})\/?$/);
  const sandbox = path.match(/^\/sandbox(?:\/([\w-]+))?\/?$/);

  let screen;
  if (sandbox && Sandbox) {
    screen = (
      <Suspense fallback={null}>
        <Sandbox gameId={sandbox[1]} />
      </Suspense>
    );
  } else if (!online) {
    screen = <NotConfigured />;
  } else if (room) {
    screen = <Room code={room[1].toUpperCase()} />;
  } else {
    screen = <Home />;
  }
  return (
    <ToastProvider>
      <div className="gc-app">{screen}</div>
    </ToastProvider>
  );
}

function NotConfigured() {
  return (
    <div className="gc-scroll">
      <div className="gc-stack gc-center" style={{ marginTop: "15vh" }}>
        <img className="gc-hero-logo" src="/icons/icon.svg" alt="" />
        <h1 className="gc-h1">GameCrow</h1>
        <p className="gc-muted">
          The game server isn't configured for this build (VITE_CONVEX_URL is missing).
          {import.meta.env.DEV && " Run `npx convex dev`, or open the sandbox to try games locally."}
        </p>
        {import.meta.env.DEV && (
          <a className="gc-btn gc-btn--primary" href="/sandbox">
            Open sandbox
          </a>
        )}
      </div>
    </div>
  );
}
