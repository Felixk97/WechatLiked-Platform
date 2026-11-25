import { getStore } from "@netlify/blobs";
import { syntaxOk, resolvePublic, pinnedProbe, embedVerdict } from "../lib/net.mjs";

// Server-side reachability check for visible apps only (any public https site, custom domains included).
// States: up, auth (needs login or redirects), down, unchecked. Redirects are NOT followed.
// The connection goes to the validated IP, so the address can't change between check and request.
const CONCURRENCY = 5, PER_REQUEST_MS = 4000, TOTAL_MS = 8000;

async function check(a, origin) {
  let u;
  try { u = new URL(a.url); } catch { return "down"; }
  if (!syntaxOk(u)) return { s: "unchecked", e: "unknown" };
  const addr = await resolvePublic(u);
  if (!addr) return { s: "down", e: "unknown" };
  const { code, xfo, csp } = await pinnedProbe(u, addr, PER_REQUEST_MS);
  const e = code ? embedVerdict(xfo, csp, origin) : "unknown";
  if (code === 0 || code === 404 || code === 410 || code >= 500) return { s: "down", e };
  if (code === 401 || code === 403 || (code >= 300 && code < 400)) return { s: "auth", e };
  return { s: "up", e };
}

export default async (req) => {
  const origin = new URL(req.url).origin;
  const apps = ((await getStore({ name: "launcher", consistency: "strong" }).get("apps", { type: "json" })) || [])
    .filter((a) => !a.hidden).slice(0, 100);
  const out = Object.fromEntries(apps.map((a) => [a.id, "unchecked"])), embed = {}, queue = [...apps], deadline = Date.now() + TOTAL_MS;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let a; Date.now() < deadline && (a = queue.shift());) { const r = await check(a, origin); out[a.id] = r.s; embed[a.id] = r.e; }
  }));
  return new Response(JSON.stringify({ ...out, _embed: embed }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
};

export const config = { path: "/api/status" };
