import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { readJson } from "../lib/body.mjs";
import { clean, merge, fromLegacy, empty } from "../lib/merge.mjs";

const store = () => getStore({ name: "launcher-sync", consistency: "strong" });
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (request) => {
  if (request.method !== "POST") return reply({ error: "POST required" }, 405);
  const origin = request.headers.get("origin");
  if (request.headers.get("x-requested-with") !== "launcher" || !origin || origin !== new URL(request.url).origin)
    return reply({ error: "Forbidden" }, 403);

  let body;
  try { body = await readJson(request, 60000); }
  catch (e) { return reply({ error: e.tooLarge ? "Too large" : "Invalid JSON" }, e.tooLarge ? 413 : 400); }

  const code = String(body.code || "");
  if (code.length < 20 || code.length > 128) return reply({ error: "Use a sync key of at least 20 characters" }, 400);
  if (body.action !== "sync") return reply({ error: "Unknown action" }, 400);
  const incoming = clean(body.data);
  if (!incoming) return reply({ error: "Invalid sync data" }, 400);

  const key = "sync-" + createHash("sha256").update(code).digest("hex");
  const stored = await store().get(key, { type: "json" });
  const current = !stored ? empty() : Array.isArray(stored.favs) ? fromLegacy(stored) : (clean(stored) || empty());
  // Merging is order-independent, so if two devices race and one write is lost, the next sync restores it.
  const merged = merge(current, incoming);
  await store().setJSON(key, { ...merged, v: 2, updatedAt: new Date().toISOString() });
  return reply({ data: merged });
};

export const config = { path: "/api/sync" };
