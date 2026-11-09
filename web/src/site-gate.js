import { createHash, timingSafeEqual } from "node:crypto";

export function constantTimeEqual(actual, expected) {
  // Fixed-size digests let the native constant-time comparison handle unequal lengths.
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function siteGate(request, env) {
  if (!env.SITE_GATE_USER || !env.SITE_GATE_PASSWORD) return null;

  const match = /^Basic\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (match) {
    try {
      const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0));
      const credentials = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (constantTimeEqual(credentials, `${env.SITE_GATE_USER}:${env.SITE_GATE_PASSWORD}`)) return null;
    } catch {
      // Malformed Basic credentials receive the same challenge as missing credentials.
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Resurface", charset="UTF-8"',
      "cache-control": "no-store",
    },
  });
}
