// Reads a JSON body while counting bytes, and stops as soon as the limit is exceeded
// (memory never holds more than limit + one chunk). Throws an Error with .tooLarge for oversize bodies.
export async function readJson(req, max) {
  const tooLarge = () => Object.assign(new Error("Request too large"), { tooLarge: true });
  if (Number(req.headers.get("content-length") || 0) > max) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Empty body");
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw tooLarge(); }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Not an object");
  return body;
}
