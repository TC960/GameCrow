/**
 * DEV ONLY Vite plugin: an offline stand-in for the Convex deployment.
 *
 * `npm run dev` without VITE_CONVEX_URL makes src/main.tsx use src/dev/MockConvexClient.ts, which calls
 *   POST /__mock/call     { kind: "query" | "mutation" | "action", name: "rooms:lobby", args }  -> Reply
 *   POST /__mock/queries  { queries: [{ name, args }] }                                        -> Reply[]
 * Both run the real convex/*.ts functions through scripts/mock-convex-backend.ts (convex-test, in memory).
 * `apply: "serve"` keeps it out of production builds.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { JSONValue } from "convex/values";

type Backend = typeof import("./mock-convex-backend");

const BACKEND = "/scripts/mock-convex-backend.ts";
const MAX_BODY = 1_000_000;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

export function mockConvex(): Plugin {
  let backend: Promise<Backend> | null = null;
  let server: ViteDevServer;
  const load = () => {
    if (!backend) {
      backend = server.ssrLoadModule(BACKEND) as Promise<Backend>;
      backend.then(
        () => server.config.logger.info("[mock-convex] in-memory backend ready (convex-test)", { timestamp: true }),
        (e) => {
          backend = null;
          server.config.logger.error(`[mock-convex] failed to load backend: ${e}`);
        },
      );
    }
    return backend;
  };

  return {
    name: "gamecrow-mock-convex",
    apply: "serve",
    configureServer(s) {
      server = s;
      const roots = ["convex", "engine", "games"].map((d) => path.join(s.config.root, d) + path.sep);
      // Server code changed: start a fresh backend on the next request (in-memory rooms are lost).
      s.watcher.on("change", (file) => {
        if (!backend || !roots.some((r) => file.startsWith(r))) return;
        const ssrGraph = s.environments.ssr.moduleGraph;
        if (!ssrGraph.getModulesByFile(file)?.size) return;
        ssrGraph.invalidateAll();
        backend = null;
        s.config.logger.warn(`[mock-convex] ${path.relative(s.config.root, file)} changed: backend restarted, rooms cleared`, {
          timestamp: true,
        });
      });

      s.middlewares.use("/__mock", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const body = (await readJson(req)) as Record<string, unknown>;
          const { call } = await load();
          if (req.url === "/call") {
            const { kind, name, args } = body as { kind: "query" | "mutation" | "action"; name: string; args: JSONValue };
            if (!["query", "mutation", "action"].includes(kind) || typeof name !== "string") return send(res, 400, { error: "bad request" });
            return send(res, 200, await call(kind, name, args));
          }
          if (req.url === "/queries") {
            const queries = (body.queries ?? []) as { name: string; args: JSONValue }[];
            // Sequential on purpose: convex-test runs one transaction at a time anyway.
            const out = [];
            for (const q of queries) out.push(await call("query", q.name, q.args));
            return send(res, 200, out);
          }
          return next();
        } catch (e) {
          send(res, 500, { error: String(e) });
        }
      });
    },
  };
}
