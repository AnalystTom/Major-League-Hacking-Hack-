import { parseSignup } from "./signup.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function joinWaitlist(request, env) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ error: "Send requests as application/json." }, 415);
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > 32_000) return json({ error: "That request is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Send a JSON body with an email field." }, 400);
  }

  const parsed = parseSignup(body);
  if (!parsed.ok) {
    // Honeypot hits get a success-shaped reply so bots learn nothing.
    return parsed.status === 202 ? json({ joined: true }, 200) : json({ error: parsed.error }, parsed.status);
  }

  const { email, agent, sources } = parsed.value;
  const result = await env.DB.prepare(
    "INSERT INTO waitlist (email, agent, sources) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING"
  )
    .bind(email, agent, JSON.stringify(sources))
    .run();

  return json({ joined: true, alreadyJoined: result.meta.changes === 0 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/waitlist") {
      try {
        return await joinWaitlist(request, env);
      } catch {
        console.error("waitlist insert failed");
        return json({ error: "The waitlist is unavailable right now. Try again in a minute." }, 503);
      }
    }
    if (["/start", "/start.html", "/app", "/app.html"].includes(url.pathname.replace(/\/$/, ""))) {
      return Response.redirect(new URL("/#join", url), 302);
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
      return json({ error: "Resurface is in early access. Join the waitlist to hear when it opens." }, 503);
    }
    return env.ASSETS.fetch(request);
  },
};
