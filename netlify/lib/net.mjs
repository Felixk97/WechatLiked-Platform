import { lookup } from "node:dns/promises";
import net from "node:net";
import https from "node:https";

const BAD_NAMES = /(^|\.)(localhost|local|internal|localdomain|lan|home|corp)$/i;

export function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || /^(fc|fd|fe[89ab])/.test(l) || l.startsWith("::ffff:");
  }
  return true;
}

// Shape check: public-looking https URL on the default port, no credentials, no IP literals
export function syntaxOk(u) {
  const h = u.hostname.replace(/^\[|\]$/g, "");
  return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
    h.includes(".") && !net.isIP(h) && !BAD_NAMES.test(h);
}

// DNS check: every address the name resolves to must be public
export async function publicHost(u) {
  try {
    const r = await lookup(u.hostname, { all: true });
    return r.length > 0 && r.every((x) => !privateIp(x.address));
  } catch { return false; }
}

// Only check Netlify-managed hostnames. Custom domains remain usable as apps,
// but are not fetched by the server-side availability checker. This prevents
// user-controlled DNS from redirecting server requests to internal services.
export function statusHostAllowed(u) {
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  return syntaxOk(u) && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.netlify\.app$/.test(host);
}

// Resolve a hostname and return one address, but only if EVERY address is public.
export async function resolvePublic(u) {
  try {
    const r = await lookup(u.hostname, { all: true });
    return r.length > 0 && r.every((x) => !privateIp(x.address)) ? r[0] : null;
  } catch { return null; }
}

// HTTPS GET status code, connecting to the already-validated IP (no second DNS lookup, so DNS
// rebinding can't swap in an internal address). TLS still validates the certificate for the hostname.
// Redirects are not followed. Resolves 0 on timeout or any error.
export function pinnedProbe(u, addr, timeoutMs = 4000, port = 443) {
  const none = { code: 0, xfo: "", csp: "" };
  return new Promise((resolve) => {
    const req = https.request({
      host: addr.address, family: addr.family, port, method: "GET",
      path: (u.pathname || "/") + (u.search || ""), servername: u.hostname, timeout: timeoutMs,
      headers: { Host: u.hostname, "User-Agent": "MyAppsStatus/1.0", Accept: "*/*" },
    }, (res) => {
      resolve({ code: res.statusCode, xfo: String(res.headers["x-frame-options"] || ""), csp: String(res.headers["content-security-policy"] || "") });
      res.destroy();
    });
    req.on("timeout", () => { req.destroy(); resolve(none); });
    req.on("error", () => resolve(none));
    req.end();
  });
}

export const pinnedStatus = async (...args) => (await pinnedProbe(...args)).code;

// Can this site be shown inside the launcher? Reads the same headers a browser would enforce.
export function embedVerdict(xfo, csp, origin) {
  if (/\b(deny|sameorigin)\b/i.test(xfo || "")) return "blocked";
  let host = ""; try { host = new URL(origin).hostname.toLowerCase(); } catch {}
  const dirs = String(csp || "").split(",").flatMap((p) => p.split(";")).map((s) => s.trim()).filter((s) => /^frame-ancestors(\s|$)/i.test(s));
  for (const d of dirs) {
    const src = d.split(/\s+/).slice(1).map((s) => s.toLowerCase());
    const ok = src.includes("*") || src.includes("https:") || src.includes(origin.toLowerCase()) ||
      src.some((s) => s.startsWith("*.") && host.endsWith(s.slice(1))) || src.includes(host);
    if (!ok) return "blocked";
  }
  return "ok";
}
