import { database } from "./database.js";
import { media } from "./media.js";
import { tts } from "./tts.js";
import { logFailure } from "./log.js";
import { Container, getContainer } from "@cloudflare/containers";

const ENV_NAMES = [
  "GEMINI_API_KEY", "OPENAI_API_KEY", "INGEST_TOKEN", "D1_URL",
  "GEMINI_MODEL", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT", "SCRIPT_REASONING_EFFORT", "JUDGE_REASONING_EFFORT", "GEMINI_TTS_MODEL", "GEMINI_TTS_VOICE",
  "WINDOW_SECONDS", "DIGESTION_REQUEST", "SWEEP_INTERVAL_MS", "WEB_ORIGINS",
  "TWITTERAPI_IO_KEY", "NIMBLE_API_KEY", "OPENAI_MAX_OUTPUT_TOKENS", "DAILY_VIDEO_LIMIT", "MONTHLY_VIDEO_LIMIT", "RENDER_STYLE", "SHORTS",
];

const BRIDGE_TOKENS = { D1_TOKEN: "D1_BRIDGE_TOKEN", MEDIA_TOKEN: "MEDIA_UPLOAD_TOKEN", TTS_TOKEN: "TTS_BRIDGE_TOKEN" };

const MAX_AWAKE_MS = 2 * 60 * 60 * 1000;
const BUSY_CHECK_MS = 3000;

const settingsFrom = (env) => Object.fromEntries([
  ...ENV_NAMES.filter((name) => env[name]).map((name) => [name, String(env[name])]),
  ...Object.entries(BRIDGE_TOKENS).filter(([, secret]) => env[secret]).map(([name, secret]) => [name, String(env[secret])]),
]);

async function settingsHash(vars) {
  const data = new TextEncoder().encode(JSON.stringify(Object.entries(vars).sort()));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class Processor extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = settingsFrom(env);
  }

  async useSettings(vars) {
    this.envVars = vars;
  }

  async settingsStatus(sent) {
    const short = async (vars) => (await settingsHash(vars)).slice(0, 12);
    return {
      sent: await short(sent),
      held: await short(this.envVars),
      started_with: ((await this.ctx.storage.get("appliedSettings")) ?? "none").slice(0, 12),
      container: (await this.getState()).status,
      running: Boolean(this.ctx.container?.running),
    };
  }

  async fetch(request) {
    const wanted = await settingsHash(this.envVars);
    if (this.ctx.container?.running) {
      if ((await this.ctx.storage.get("appliedSettings")) === wanted || (await this.busy())) return super.fetch(request);
      await this.stop();
      for (let i = 0; i < 20 && this.ctx.container?.running; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    await this.ctx.storage.put("appliedSettings", wanted);
    return super.fetch(request);
  }

  async onStart() {
    await this.ctx.storage.put("awakeSince", Date.now());
  }

  async onActivityExpired() {
    const awakeSince = (await this.ctx.storage.get("awakeSince")) ?? Date.now();
    if (Date.now() - awakeSince < MAX_AWAKE_MS && (await this.busy())) return this.renewActivityTimeout();
    await this.stop();
  }

  async busy() {
    try {
      const answer = this.containerFetch("http://processor/health").then((res) => res.json());
      const late = new Promise((resolve) => setTimeout(() => resolve(null), BUSY_CHECK_MS));
      const health = await Promise.race([answer, late]);
      return Number(health?.busy) > 0;
    } catch {
      return false;
    }
  }
}

async function applySettings(processor, env) {
  try {
    await processor.useSettings(settingsFrom(env));
  } catch (error) {
    console.warn(`processor settings not applied: ${error?.message ?? error}`);
  }
}

async function authorized(request, secret) {
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const sent = new TextEncoder().encode(header.slice("Bearer ".length));
  const token = new TextEncoder().encode(secret);
  return sent.byteLength === token.byteLength && crypto.subtle.timingSafeEqual(sent, token);
}

const ANSWER_WITHIN_MS = 6000;

const ROUTES = new Map([
  ["GET /health", "INGEST_TOKEN"],
  ["POST /api/ingest/process", "INGEST_TOKEN"],
  ["POST /api/ingest/handoff", "INGEST_TOKEN"],
  ["GET /settings-status", "INGEST_TOKEN"],
  ["POST /internal/d1", "D1_BRIDGE_TOKEN"],
  ["PUT /internal/media", "MEDIA_UPLOAD_TOKEN"],
  ["DELETE /internal/media", "MEDIA_UPLOAD_TOKEN"],
  ["POST /internal/tts", "TTS_BRIDGE_TOKEN"],
]);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const secret = ROUTES.get(`${request.method} ${pathname}`);
    if (!secret) return new Response("Not found", { status: 404 });
    if (!(await authorized(request, env[secret]))) return new Response("Unauthorized", { status: 401 });

    if (pathname === "/internal/d1") return database(request, env);
    if (pathname === "/internal/media") return media(request, env);
    if (pathname === "/internal/tts") return tts(request, env);

    const body = request.method === "GET" ? undefined : await request.arrayBuffer();
    const forward = new Request(request.url, { method: request.method, headers: request.headers, body });
    const processor = getContainer(env.PROCESSOR);
    await applySettings(processor, env);
    if (pathname === "/settings-status") {
      try {
        return Response.json(await processor.settingsStatus(settingsFrom(env)));
      } catch (error) {
        return Response.json({ error: String(error?.message ?? error) }, { status: 500 });
      }
    }
    const reply = processor.fetch(forward)
      .catch((error) => {
        logFailure("processor container start failed", error);
        return new Response("The processor didn't start.", { status: 502 });
      });
    ctx.waitUntil(reply);
    const late = new Promise((resolve) => setTimeout(() => resolve(null), ANSWER_WITHIN_MS));
    return (await Promise.race([reply, late])) ?? Response.json({ accepted: true, starting: true }, { status: 202 });
  },

  async scheduled(_event, env, ctx) {
    const processor = getContainer(env.PROCESSOR);
    ctx.waitUntil(applySettings(processor, env).then(() => processor.fetch(new Request("http://processor/health"))));
  },
};
