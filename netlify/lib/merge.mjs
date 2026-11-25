// Sync data is built so that merging is safe in any order, any number of times:
//   favs:  { appId: [0|1, timestamp] }        newest change wins
//   uses:  { deviceId: { appId: count } }     each device owns its counters; merge takes the max per counter
//   prefs: { name: [value, timestamp] }       newest change wins
const ID = (s) => /^[a-zA-Z0-9_-]{1,60}$/.test(s) && s !== "__proto__";
export const PREFS = ["layout", "cards", "wallpaper", "theme", "maxTabs"];
const num = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const plain = (o) => o && typeof o === "object" && !Array.isArray(o);
export const empty = () => ({ favs: {}, uses: {}, prefs: {} });

export function clean(d) {
  if (!plain(d)) return null;
  const out = empty(), cap = Date.now() + 60000; // future timestamps can't win forever
  const f = d.favs ?? {}, u = d.uses ?? {}, p = d.prefs ?? {};
  if (!plain(f) || !plain(u) || !plain(p) || Object.keys(f).length > 100 || Object.keys(u).length > 10) return null;
  for (const [id, v] of Object.entries(f)) {
    if (!ID(id) || !Array.isArray(v) || (v[0] !== 0 && v[0] !== 1) || !num(v[1], 1e15)) return null;
    out.favs[id] = [v[0], Math.min(v[1], cap)];
  }
  for (const [dev, m] of Object.entries(u)) {
    if (!ID(dev) || !plain(m) || Object.keys(m).length > 100) return null;
    out.uses[dev] = {};
    for (const [id, n] of Object.entries(m)) { if (!ID(id) || !num(n, 1e8)) return null; out.uses[dev][id] = n; }
  }
  for (const k of PREFS) {
    const v = p[k]; if (v === undefined) continue;
    if (!Array.isArray(v) || typeof v[0] !== "string" || v[0].length > 40 || !num(v[1], 1e15)) return null;
    out.prefs[k] = [v[0], Math.min(v[1], cap)];
  }
  return out;
}

// Data saved by the older manual-sync version
export function fromLegacy(s) {
  const favs = {}; for (const id of (s.favs || []).slice(0, 100)) if (typeof id === "string" && ID(id)) favs[id] = [1, 1];
  const prefs = {}; for (const k of PREFS) if (typeof s.prefs?.[k] === "string") prefs[k] = [s.prefs[k].slice(0, 40), 1];
  return clean({ favs, uses: {}, prefs }) || empty();
}

const newer = (cur, c) => !cur || c[1] > cur[1] || (c[1] === cur[1] && String(c[0]) > String(cur[0]));

export function merge(a, b) {
  const out = empty();
  for (const src of [a.favs, b.favs]) for (const [id, c] of Object.entries(src)) if (newer(out.favs[id], c)) out.favs[id] = c;
  for (const src of [a.prefs, b.prefs]) for (const [k, c] of Object.entries(src)) if (newer(out.prefs[k], c)) out.prefs[k] = c;
  for (const src of [a.uses, b.uses]) for (const [dev, m] of Object.entries(src)) {
    out.uses[dev] ??= {};
    for (const [id, n] of Object.entries(m)) out.uses[dev][id] = Math.max(out.uses[dev][id] || 0, n);
  }
  const total = (m) => Object.values(m).reduce((s, n) => s + n, 0);
  const keep = Object.entries(out.uses).sort((x, y) => total(y[1]) - total(x[1])).slice(0, 10); // at most 10 devices
  out.uses = Object.fromEntries(keep);
  return out;
}
