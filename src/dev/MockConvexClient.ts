/**
 * DEV ONLY: a stand-in for ConvexReactClient that talks to the in-memory backend served by
 * scripts/mock-convex-plugin.ts (the real convex/*.ts functions on convex-test).
 *
 * It implements what ConvexProvider / useQuery / useMutation / useAction use. "Live" queries are
 * polled: every active query is re-fetched after each mutation and every POLL_MS (bots and timers
 * change state server-side), and listeners only fire when a result actually changed.
 * src/main.tsx loads this with a dynamic import inside `import.meta.env.DEV`, so it never ships.
 */
import type { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError, convexToJson, jsonToConvex, type JSONValue, type Value } from "convex/values";

const POLL_MS = 700;

type Reply = { ok: true; value: JSONValue } | { ok: false; message: string; data?: JSONValue };

interface Entry {
  name: string;
  args: JSONValue;
  /** JSON text of the last result, to skip no-op updates. */
  raw?: string;
  value?: unknown;
  error?: Error;
  listeners: Set<() => void>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Mock backend ${url} failed: ${res.status} (network)`);
  return (await res.json()) as T;
}

function unwrap(reply: Reply): unknown {
  if (reply.ok) return jsonToConvex(reply.value);
  if (reply.data !== undefined) throw new ConvexError(jsonToConvex(reply.data) as Value);
  throw new Error(`[mock] ${reply.message}`);
}

const keyOf = (name: string, args: JSONValue) => `${name}|${JSON.stringify(args)}`;

export class MockConvexClient {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor() {
    console.info("[GameCrow] Offline mock backend (dev only): convex/*.ts run in the Vite dev server, in memory.");
  }

  private entry(query: FunctionReference<"query">, args?: Record<string, Value>) {
    const name = getFunctionName(query);
    const json = convexToJson((args ?? {}) as Value);
    const key = keyOf(name, json);
    let e = this.entries.get(key);
    if (!e) {
      e = { name, args: json, listeners: new Set() };
      this.entries.set(key, e);
    }
    return { key, e };
  }

  watchQuery(query: FunctionReference<"query">, args?: Record<string, Value>) {
    return {
      onUpdate: (callback: () => void) => {
        const { key, e } = this.entry(query, args);
        e.listeners.add(callback);
        this.ensurePolling();
        if (e.raw === undefined && !e.error) void this.refresh();
        return () => {
          e.listeners.delete(callback);
          // Keep results briefly like the real client, so remounts don't flash "loading".
          if (e.listeners.size === 0) setTimeout(() => e.listeners.size === 0 && this.entries.delete(key), 5000);
        };
      },
      localQueryResult: () => {
        const e = this.entries.get(keyOf(getFunctionName(query), convexToJson((args ?? {}) as Value)));
        if (e?.error) throw e.error;
        return e?.value;
      },
      localQueryLogs: () => undefined,
      journal: () => undefined,
    };
  }

  watchPaginatedQuery(): never {
    throw new Error("Paginated queries aren't supported by the mock backend");
  }

  prewarmQuery() {}

  /** Re-fetch every watched query (coalesced: at most one batch in flight plus one queued). */
  private refresh(): Promise<void> {
    if (this.inflight) {
      // A batch that started earlier may predate the caller's mutation: queue one more after it.
      return (this.queued ??= this.inflight.then(() => {
        this.queued = null;
        return this.refresh();
      }));
    }
    const run = async () => {
      const list = [...this.entries.values()].filter((e) => e.listeners.size > 0);
      if (!list.length) return;
      let replies: Reply[];
      try {
        replies = await post<Reply[]>("/__mock/queries", { queries: list.map((e) => ({ name: e.name, args: e.args })) });
      } catch {
        return; // dev server restarting; the next poll retries
      }
      replies.forEach((reply, i) => {
        const e = list[i];
        const raw = JSON.stringify(reply);
        if (raw === e.raw) return;
        e.raw = raw;
        try {
          e.value = unwrap(reply);
          e.error = undefined;
        } catch (err) {
          e.error = err as Error;
        }
        for (const l of [...e.listeners]) l();
      });
    };
    this.inflight = run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private ensurePolling() {
    this.timer ??= setInterval(() => {
      if (document.visibilityState === "visible") void this.refresh();
    }, POLL_MS);
  }

  private async call(kind: "query" | "mutation" | "action", ref: FunctionReference<typeof kind>, args?: Record<string, Value>) {
    const reply = await post<Reply>("/__mock/call", { kind, name: getFunctionName(ref), args: convexToJson((args ?? {}) as Value) });
    return unwrap(reply);
  }

  async mutation(ref: FunctionReference<"mutation">, args?: Record<string, Value>) {
    try {
      return await this.call("mutation", ref, args);
    } finally {
      await this.refresh(); // like Convex: queries reflect the mutation by the time it resolves
    }
  }

  action(ref: FunctionReference<"action">, args?: Record<string, Value>) {
    return this.call("action", ref, args).finally(() => this.refresh());
  }

  query(ref: FunctionReference<"query">, args?: Record<string, Value>) {
    return this.call("query", ref, args);
  }

  connectionState() {
    return { hasInflightRequests: !!this.inflight, isWebSocketConnected: true, timeOfOldestInflightRequest: null };
  }
  subscribeToConnectionState() {
    return () => {};
  }
  setAuth() {}
  clearAuth() {}
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** For ConvexProvider's prop type. */
  asReactClient(): ConvexReactClient {
    return this as unknown as ConvexReactClient;
  }
}
