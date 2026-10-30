/**
 * DEV ONLY. The real Convex functions in convex/*.ts running in-process on convex-test's in-memory
 * database, so `npm run dev` works without a Convex deployment. Loaded by scripts/mock-convex-plugin.ts
 * with Vite's ssrLoadModule; never imported by the app bundle.
 *
 * Scheduled functions (bot moves, timeouts) fire on real timers, exactly like a deployment.
 * State lives in memory: restarting the dev server (or editing server code) clears every room.
 */
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { convexToJson, jsonToConvex, type JSONValue, type Value } from "convex/values";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/!(*.test).*s");
const t = convexTest(schema, modules);

export type Kind = "query" | "mutation" | "action";
export type Reply = { ok: true; value: JSONValue } | { ok: false; message: string; data?: JSONValue };

/** Only public functions are callable, like a real deployment (internal ones run via the scheduler). */
async function assertPublic(kind: Kind, name: string) {
  const [path, fn = "default"] = name.split(":");
  const load = modules[`../convex/${path}.ts`];
  const exported = load ? ((await load()) as Record<string, Record<string, unknown> | undefined>)[fn] : undefined;
  const flag = { query: "isQuery", mutation: "isMutation", action: "isAction" }[kind];
  if (!exported?.isPublic || !exported[flag]) throw new Error(`Could not find public ${kind} "${name}"`);
}

export async function call(kind: Kind, name: string, args: JSONValue): Promise<Reply> {
  try {
    await assertPublic(kind, name);
    const parsed = jsonToConvex(args ?? {}) as Record<string, Value>;
    // Names come from the client at runtime, so the typed convex-test API is bypassed on purpose.
    const run = t[kind] as (ref: unknown, args: Record<string, Value>) => Promise<unknown>;
    const value = await run(makeFunctionReference(name), parsed);
    return { ok: true, value: convexToJson((value ?? null) as Value) };
  } catch (e) {
    const err = e as { name?: string; message?: string; data?: Value };
    if (err?.name === "ConvexError" && "data" in err) {
      return { ok: false, message: err.message ?? "ConvexError", data: convexToJson(err.data ?? null) };
    }
    console.error(`[mock-convex] ${kind} ${name} failed:`, e);
    return { ok: false, message: err?.message ?? String(e) };
  }
}
