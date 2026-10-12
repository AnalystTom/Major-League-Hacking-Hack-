// Rendered shorts live in the R2 bucket bound as MEDIA. D1 stores references like
// "r2:videos/<artifact>/<version>/short.mp4"; the page only ever sees the same-origin /media/ URL.

const KEY = /^(videos|captions|posters)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const TYPES = { mp4: "video/mp4", webm: "video/webm", vtt: "text/vtt; charset=utf-8", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export const isMediaKey = (key) => KEY.test(key) && !key.split("/").includes("..");

/** A stored reference as a URL the browser can play, or null when it can't be served safely. */
export function resolveMediaRef(ref) {
  if (typeof ref !== "string") return null;
  if (ref.startsWith("r2:")) {
    const key = ref.slice(3);
    return isMediaKey(key) ? `/media/${key}` : null;
  }
  return /^https:\/\//.test(ref) ? ref : null;
}

/**
 * The byte slice a Range header asks for, as { offset, length }; null for no (or an unsupported
 * multi-part) range, and "unsatisfiable" when it starts past the end. Parsed here rather than by R2
 * so the Content-Range we send always matches the bytes we return.
 */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Math.min(Number(m[2]), size);
    return suffix === 0 ? "unsatisfiable" : { offset: size - suffix, length: suffix };
  }
  const offset = Number(m[1]);
  if (offset >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return end < offset ? null : { offset, length: end - offset + 1 };
}

/** Streams an object with Range support, which Safari needs before it will play a video. */
export async function serveMedia(request, env, key) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Use GET.", { status: 405 });
  if (!isMediaKey(key)) return new Response("Not found.", { status: 404 });
  if (!env.MEDIA) return new Response("Media storage isn't connected.", { status: 503 });

  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found.", { status: 404 });
  const range = parseRange(request.headers.get("range"), head.size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${head.size}` } });
  }
  const object = request.method === "HEAD" ? head : await env.MEDIA.get(key, range ? { range } : {});
  if (!object) return new Response("Not found.", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", TYPES[key.split(".").pop()] ?? "application/octet-stream");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=3600");

  if (request.method === "HEAD") {
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }
  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}
