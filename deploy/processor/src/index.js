// The processor (server/) runs in a Cloudflare Container that sleeps when it has nothing to do. This Worker
// gives it a stable HTTPS address for the web Worker's PROCESSOR_URL, passes it its keys, and wakes it once
// a day so its sweeps retry anything an import left behind. Requests need the processor's bearer token.

import { Container, getContainer } from "@cloudflare/containers";

// Worker secrets and vars the processor reads from process.env.
const ENV_NAMES = [
  "GEMINI_API_KEY", "OPENAI_API_KEY", "INGEST_TOKEN", "DATABASE_URL",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET",
  "GEMINI_MODEL", "OPENAI_MODEL", "GEMINI_TTS_MODEL", "GEMINI_TTS_VOICE",
  "WINDOW_SECONDS", "DIGESTION_REQUEST", "SWEEP_INTERVAL_MS", "WEB_ORIGINS",
  "TWITTERAPI_IO_KEY", "OPENAI_MAX_OUTPUT_TOKENS", "DAILY_VIDEO_LIMIT", "MONTHLY_VIDEO_LIMIT",
];

// However busy it says it is, a container is stopped after this long awake, so a stuck job can't run up
// the bill. Work it was doing is reclaimed and redone on the next wake.
const MAX_AWAKE_MS = 2 * 60 * 60 * 1000;

// Only a hash of the settings is kept, never the values.
async function settingsHash(vars) {
  const data = new TextEncoder().encode(JSON.stringify(Object.entries(vars).sort()));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class Processor extends Container {
  defaultPort = 3000;
  // Checked this long after the last request; see onActivityExpired.
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = Object.fromEntries(ENV_NAMES.filter((name) => env[name]).map((name) => [name, String(env[name])]));
  }

  // A container keeps the settings it started with, so once a secret or var changes, restart it on the next
  // request, as long as it isn't mid-job (otherwise it carries on and the next request checks again).
  async fetch(request) {
    if ((await this.ctx.storage.get("settingsHash")) !== (await settingsHash(this.envVars))) {
      const { status } = await this.getState();
      if ((status === "running" || status === "healthy") && !(await this.busy())) {
        await this.stop();
        for (let i = 0; i < 20 && !["stopped", "stopped_with_code"].includes((await this.getState()).status); i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }
    return super.fetch(request);
  }

  async onStart() {
    await this.ctx.storage.put({ awakeSince: Date.now(), settingsHash: await settingsHash(this.envVars) });
  }

  // Imports run for many minutes without any request reaching the container, so an idle timer alone would
  // stop it mid-job. Ask the processor first, and keep it awake only while it has work in progress.
  async onActivityExpired() {
    const awakeSince = (await this.ctx.storage.get("awakeSince")) ?? Date.now();
    if (Date.now() - awakeSince < MAX_AWAKE_MS && (await this.busy())) return this.renewActivityTimeout();
    await this.stop();
  }

  async busy() {
    try {
      const health = await (await this.containerFetch("http://processor/health")).json();
      return Number(health.busy) > 0;
    } catch {
      return false;
    }
  }
}

// Only callers holding the processor's token may wake it: anyone else could keep it awake and run up the bill.
async function authorized(request, env) {
  const header = request.headers.get("authorization") ?? "";
  if (!env.INGEST_TOKEN || !header.startsWith("Bearer ")) return false;
  const sent = new TextEncoder().encode(header.slice("Bearer ".length));
  const token = new TextEncoder().encode(env.INGEST_TOKEN);
  return sent.byteLength === token.byteLength && crypto.subtle.timingSafeEqual(sent, token);
}

// The web Worker gives the processor 8 s to answer, and a sleeping container can take longer than that to
// start. Past this point, answer 202 and let the request finish in the background: the units are already
// saved, and the processor's first sweep, a second after it starts, picks them up either way.
const ANSWER_WITHIN_MS = 6000;

// The only routes callers need: the web Worker's processing and handoff requests, and a health check.
// Anything else (such as the processor's dev import route, which skips the processing limits) never
// reaches the container.
const ROUTES = new Set(["GET /health", "POST /api/ingest/process", "POST /api/ingest/handoff"]);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!ROUTES.has(`${request.method} ${pathname}`)) return new Response("Not found", { status: 404 });
    if (!(await authorized(request, env))) return new Response("Unauthorized", { status: 401 });

    // Read the body first: once the early 202 below has gone out, the incoming request can't be read any more,
    // and a slow container would get a request without its unit ids.
    const body = request.method === "GET" ? undefined : await request.arrayBuffer();
    const forward = new Request(request.url, { method: request.method, headers: request.headers, body });
    const reply = getContainer(env.PROCESSOR).fetch(forward)
      .catch(() => new Response("The processor didn't start.", { status: 502 }));
    ctx.waitUntil(reply);
    const late = new Promise((resolve) => setTimeout(() => resolve(null), ANSWER_WITHIN_MS));
    return (await Promise.race([reply, late])) ?? Response.json({ accepted: true, starting: true }, { status: 202 });
  },

  // A health check starts the container if it's asleep; it then sleeps again once its sweeps find nothing to do.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(getContainer(env.PROCESSOR).fetch(new Request("http://processor/health")));
  },
};
