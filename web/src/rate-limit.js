export const requestIp = (request) => request.headers.get("cf-connecting-ip") ?? "local";

// All configured limiters use a 60-second window; wait a full window before retrying.
export async function rateLimit(limiter, key, message = "Too many attempts. Wait a minute and try again.") {
  try {
    const result = await limiter.limit({ key });
    if (result.success === true) return null;
    if (result.success === false) {
      return Response.json({ error: message }, {
        status: 429,
        headers: { "retry-after": "60", "cache-control": "no-store" },
      });
    }
  } catch {
    // A missing or failing binding must never authorize a write.
  }
  return Response.json({ error: "Abuse protection is unavailable. Try again in a minute." }, {
    status: 503,
    headers: { "retry-after": "60", "cache-control": "no-store" },
  });
}
