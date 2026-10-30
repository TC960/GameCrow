import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import "../ui/kit/kit.css";
import "./app.css";
import { App } from "./App";
import { registerServiceWorker } from "./pwa";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = url ? new ConvexReactClient(url) : null;

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

registerServiceWorker();
