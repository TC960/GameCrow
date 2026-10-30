import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "../ui/kit/kit.css";
import "./app.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

function render(convex: ConvexReactClient | null) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {convex ? (
        <ConvexProvider client={convex}>
          <App online />
        </ConvexProvider>
      ) : (
        <App online={false} />
      )}
    </StrictMode>,
  );
}

if (url && !(import.meta.env.DEV && import.meta.env.VITE_MOCK_CONVEX === "1")) {
  render(new ConvexReactClient(url));
} else if (import.meta.env.DEV) {
  // Dev without a deployment: the real convex/*.ts functions run in the Vite dev server
  // (scripts/mock-convex-plugin.ts). Dead code in production builds.
  import("./dev/MockConvexClient").then(({ MockConvexClient }) => render(new MockConvexClient().asReactClient()));
} else {
  render(null);
}

registerServiceWorker();
