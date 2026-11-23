import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

// Env var needed on this site: ADMIN_PASSWORD
const store = () => getStore("launcher");

function isAdmin(req) {
  const given = Buffer.from(req.headers.get("x-admin-password") || "");
  const real = Buffer.from(process.env.ADMIN_PASSWORD || "");
  return real.length > 0 && given.length === real.length && timingSafeEqual(given, real);
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (req) => {
  const admin = isAdmin(req);

  if (req.method === "GET") {
    const all = (await store().get("apps", { type: "json" })) || [];
    return json({ admin, apps: admin ? all : all.filter((a) => !a.hidden) });
  }

  if (req.method === "PUT") {
    if (!admin) return json({ error: "Wrong admin password" }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    if (!Array.isArray(body.apps) || body.apps.length > 100) return json({ error: "Bad list" }, 400);
    const clean = body.apps
      .filter((a) => a && /^https?:\/\//i.test(String(a.url || "")))
      .map((a) => ({
        id: String(a.id || crypto.randomUUID()).slice(0, 60),
        name: String(a.name || "App").slice(0, 60),
        icon: String(a.icon || "").slice(0, 8),
        url: String(a.url).slice(0, 500),
        hidden: !!a.hidden,
      }));
    await store().setJSON("apps", clean);
    return json({ ok: true, apps: clean });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/apps" };
