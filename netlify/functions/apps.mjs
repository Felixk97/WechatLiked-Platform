import { getStore } from "@netlify/blobs";
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { syntaxOk } from "../lib/net.mjs";
import { readJson } from "../lib/body.mjs";

// Env var needed on this site: ADMIN_PASSWORD
const store = () => getStore({ name: "launcher", consistency: "strong" });
const SECRET = () => process.env.ADMIN_PASSWORD || "";
const same = (a, b) => { a = Buffer.from(a); b = Buffer.from(b); return a.length === b.length && timingSafeEqual(a, b); };
const cookie = (v, age) => `admin=${v}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${age}`;
const sessionKey = token => "session-" + createHash("sha256").update(token).digest("hex");
const sessionToken = req => (req.headers.get("cookie") || "").match(/(?:^|;\s*)admin=([a-f0-9]{64})(?:;|$)/)?.[1];
const MAX_FAILS = 5, WINDOW = 15 * 60 * 1000;
async function isAdmin(req) {
  if (!SECRET()) return false;
  const token = sessionToken(req);
  if (!token) return false;
  const record = await store().get(sessionKey(token), { type: "json" });
  return !!record && record.exp > Date.now();
}
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

const httpsOnly = (u) => { try { const x = new URL(String(u).trim()); return syntaxOk(x) ? x.href : null; } catch { return null; } };

// CSRF defence on top of SameSite=Strict: custom header (forces a CORS preflight) + matching Origin
function trustedRequest(req) {
  if (req.headers.get("x-requested-with") !== "launcher") return false;
  const o = req.headers.get("origin");
  if (!o) return false;
  try { const origin = new URL(o), target = new URL(req.url);
    return origin.protocol === "https:" && origin.origin === target.origin; } catch { return false; }
}

// Housekeeping on each successful login: drop expired sessions and stale lockout records
async function purgeStale() {
  try {
    const now = Date.now();
    for (const b of (await store().list({ prefix: "session-" })).blobs.slice(0, 50)) {
      const r = await store().get(b.key, { type: "json" });
      if (!r || r.exp <= now) await store().delete(b.key);
    }
    for (const b of (await store().list({ prefix: "rl-" })).blobs.slice(0, 50)) {
      const r = await store().get(b.key, { type: "json" });
      if (!r || (!(r.until > now) && now - r.first > WINDOW)) await store().delete(b.key);
    }
  } catch { /* housekeeping must never block a login */ }
}

export default async (req, context) => {
  if (req.method === "GET") {
    const admin = await isAdmin(req);
    const all = (await store().get("apps", { type: "json" })) || [];
    return json({ admin, apps: admin ? all : all.filter((a) => !a.hidden) });
  }

  if (req.method !== "GET" && !trustedRequest(req)) return json({ error: "Forbidden" }, 403);

  let body;
  try { body = await readJson(req, 3000000); }
  catch (e) { return json({ error: e.tooLarge ? "Request too large" : "Bad request" }, e.tooLarge ? 413 : 400); }

  if (req.method === "POST") {
    if (body.action === "logout") {
      const token = sessionToken(req);
      if (token) await store().delete(sessionKey(token));
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    if (body.action !== "login") return json({ error: "Unknown action" }, 400);

    // Per-client attempt limit: 5 wrong passwords, then locked for 15 minutes
    const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
    const key = "rl-" + ip.replace(/[^a-z0-9.:-]/gi, "_");
    const rec = (await store().get(key, { type: "json" })) || { n: 0, first: Date.now() };
    if (rec.until > Date.now()) return json({ error: "Too many attempts. Try again later." }, 429);

    if (SECRET() && same(String(body.password || ""), SECRET())) {
      await store().delete(key);
      await purgeStale();
      const token = randomBytes(32).toString("hex");
      await store().setJSON(sessionKey(token), { exp: Date.now() + 8 * 36e5 });
      return json({ ok: true }, 200, { "Set-Cookie": cookie(token, 28800) });
    }
    if (Date.now() - rec.first > WINDOW) { rec.n = 0; rec.first = Date.now(); delete rec.until; }
    rec.n++;
    if (rec.n >= MAX_FAILS) rec.until = Date.now() + WINDOW;
    await store().setJSON(key, rec);
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Wrong password" }, 401);
  }

  if (req.method === "PUT") {
    if (!(await isAdmin(req))) return json({ error: "Session expired, please log in again" }, 401);
    if (!Array.isArray(body.apps) || body.apps.length > 100) return json({ error: "Bad list" }, 400);
    const seen = new Set();
    const ids = new Set();
    const clean = [];
    for (const a of body.apps) {
      const url = a && httpsOnly(a.url);
      if (!url || url.length > 500) return json({ error: "Invalid app URL" }, 400);
      if (seen.has(url.replace(/\/$/, "").toLowerCase())) return json({ error: "Duplicate app URL" }, 400);
      seen.add(url.replace(/\/$/, "").toLowerCase());
      const ic = String(a.icon || "");
      const id = String(a.id || randomBytes(12).toString("hex")).slice(0, 60);
      if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ids.has(id)) return json({ error: "Invalid or duplicate app ID" }, 400);
      ids.add(id);
      if (ic.startsWith("data:") && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(ic) || ic.length > 30000)) return json({ error: "Invalid app icon" }, 400);
      clean.push({
        id,
        name: String(a.name || "App").slice(0, 60),
        category: String(a.category || "").slice(0, 30),
        folder: String(a.folder || "").slice(0, 40),
        description: String(a.description || "").slice(0, 160),
        icon: /^data:image\/(png|jpeg|webp);base64,/i.test(ic) ? ic : ic.slice(0, 8),
        url: url.slice(0, 500),
        mode: a.mode === "tab" ? "tab" : "frame",
        hidden: !!a.hidden,
      });
    }
    await store().setJSON("apps", clean);
    return json({ ok: true, apps: clean });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/apps" };
