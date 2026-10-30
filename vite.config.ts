/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockConvex } from "./scripts/mock-convex-plugin";

export default defineConfig({
  // mockConvex: dev-server-only offline backend (see scripts/mock-convex-plugin.ts).
  plugins: [react(), mockConvex()],
  server: { host: true },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    server: { deps: { inline: ["convex-test"] } },
  },
});
