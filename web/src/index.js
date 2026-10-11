import { connect } from "./db.js";
import { readFeed } from "./feed.js";
import { createUnits, parseImport, parseUnitIds, readUnits } from "./imports.js";
import { serveMedia } from "./media.js";
import { requestProcessing } from "./processor.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const UNAVAILABLE = "Processing isn't connected right now. Try again in a minute.";

// POST /api/imports: store the links as units, then ask the processor to start on the new ones.
async function startImport(request, env, sql) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body with a links field." }, 400);
  }
  const parsed = parseImport(body);
  if (!parsed.ok) {
    // Honeypot hits get a success-shaped reply so bots learn nothing.
    if (parsed.status === 202) return json({ units: [], processor: "not_needed" }, 200);
    return json({ error: parsed.error, invalid: parsed.invalid }, parsed.status);
  }

  const units = await createUnits(sql, parsed.value.links);
  const processor = await requestProcessing(
    env,
    units.filter((u) => u.status === "pending").map((u) => u.id)
  );
  return json({ units: await readUnits(sql, units.map((u) => u.id)), processor }, 201);
}

async function api(request, env, url, sql) {
  if (url.pathname === "/api/imports") {
    if (request.method === "POST") return startImport(request, env, sql);
    if (request.method === "GET") {
      const ids = parseUnitIds(url.searchParams.get("units"));
      if (!ids) return json({ error: "Pass units as comma-separated ids." }, 400);
      return json({ units: await readUnits(sql, ids) });
    }
    return json({ error: "Use GET or POST." }, 405);
  }
  if (url.pathname === "/api/feed") {
    if (request.method !== "GET") return json({ error: "Use GET." }, 405);
    const raw = url.searchParams.get("units");
    const ids = raw === null ? null : parseUnitIds(raw);
    if (raw !== null && !ids) return json({ error: "Pass units as comma-separated ids." }, 400);
    return json({ items: await readFeed(sql, ids) });
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/media/")) {
      let key;
      try {
        key = decodeURIComponent(url.pathname.slice("/media/".length));
      } catch {
        return new Response("Not found.", { status: 404 });
      }
      return serveMedia(request, env, key);
    }

    if (url.pathname.startsWith("/api/")) {
      const sql = connect(env);
      if (!sql) return json({ error: UNAVAILABLE }, 503);
      try {
        return await api(request, env, url, sql);
      } catch (err) {
        console.error("api request failed", url.pathname, err);
        return json({ error: UNAVAILABLE }, 503);
      } finally {
        ctx.waitUntil(sql.end({ timeout: 5 }));
      }
    }

    return env.ASSETS.fetch(request);
  },
};
