import { parseSignup } from "./signup.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function joinWaitlist(request, env) {
  let body;
  try {
    body = await request.json();
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

  const row = await env.DB.prepare("SELECT id FROM waitlist WHERE email = ?").bind(email).first();
  return json({ joined: true, alreadyJoined: result.meta.changes === 0, position: row?.id ?? null });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/waitlist") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      try {
        return await joinWaitlist(request, env);
      } catch (err) {
        console.error("waitlist insert failed", err);
        return json({ error: "The waitlist is unavailable right now. Try again in a minute." }, 503);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
