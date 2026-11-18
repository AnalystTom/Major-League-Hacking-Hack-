import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, request } from "@playwright/test";

const env = process.env;
const LIVE_SITE = "https://resurface.thomasmann2001.workers.dev";
const X_AUTHORIZE = "https://x.com/i/oauth2/authorize";
const X_SCOPES = [
  "tweet.read",
  "users.read",
  "bookmark.read",
  "offline.access",
];
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);
const SECURITY_HEADERS = {
  "content-security-policy": /frame-ancestors 'none'/,
  "x-frame-options": /^DENY$/,
  "x-content-type-options": /^nosniff$/,
  "referrer-policy": /\S/,
};

const base = new URL(env.SMOKE_BASE_URL ?? LIVE_SITE).origin;
const evidence = resolve(
  env.SMOKE_EVIDENCE_DIR ?? join("test-results", `live-smoke-${Date.now()}`),
);
const importLink = env.SMOKE_IMPORT_URL;
const importTimeout = Number(env.SMOKE_IMPORT_TIMEOUT_MS ?? 600_000);
const loadXConsent = env.SMOKE_LOAD_X_CONSENT === "1";

const operatorHeaders =
  env.SMOKE_ACCESS_CLIENT_ID && env.SMOKE_ACCESS_CLIENT_SECRET
    ? {
        "cf-access-client-id": env.SMOKE_ACCESS_CLIENT_ID,
        "cf-access-client-secret": env.SMOKE_ACCESS_CLIENT_SECRET,
      }
    : {};
const operatorCredentials =
  env.SMOKE_GATE_USER && env.SMOKE_GATE_PASSWORD
    ? {
        username: env.SMOKE_GATE_USER,
        password: env.SMOKE_GATE_PASSWORD,
        origin: base,
        send: "always",
      }
    : undefined;

async function siteOnlyAccess(context) {
  if (!Object.keys(operatorHeaders).length) return;
  await context.route(
    (url) => url.origin === base,
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), ...operatorHeaders },
      }),
  );
}

const appGet = (page, path, options = {}) =>
  page.request.get(path, { ...options, headers: operatorHeaders });

function throwawayAccount() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return {
    email: `resurface-smoke+${stamp}-${randomBytes(3).toString("hex")}@example.com`,
    password: randomBytes(18).toString("base64url"),
  };
}

const results = [];
async function check(name, run) {
  const started = Date.now();
  try {
    const detail = (await run()) ?? "";
    results.push({ name, ok: true, detail, ms: Date.now() - started });
    console.log(`PASS  ${name}${detail ? ` - ${detail}` : ""}`);
    return true;
  } catch (error) {
    const detail = error.message.split("\n")[0];
    results.push({ name, ok: false, detail, ms: Date.now() - started });
    console.log(`FAIL  ${name} - ${detail}`);
    return false;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function describeGate(response) {
  const location = response.headers()["location"] ?? "";
  if (/cloudflareaccess\.com/.test(location)) return "Cloudflare Access login";
  if (/^Basic/i.test(response.headers()["www-authenticate"] ?? ""))
    return "in-app Basic site gate";
  return `HTTP ${response.status()}`;
}

async function publicPage(anonymous, path, heading) {
  const response = await anonymous.get(path, { maxRedirects: 0 });
  expect(response.status() === 200, `${path}: ${describeGate(response)}`);
  expect(
    (await response.text()).includes(heading),
    `${path}: page has no "${heading}" text`,
  );
  return "200 without operator access";
}

async function publicChecks(anonymous) {
  await check("privacy policy is public", () =>
    publicPage(anonymous, "/privacy", "Privacy"),
  );
  await check("terms are public", () =>
    publicPage(anonymous, "/terms", "Terms"),
  );
  await check("X callback reaches the app", async () => {
    const response = await anonymous.get("/api/auth/x/callback", {
      maxRedirects: 0,
    });
    const location = response.headers()["location"] ?? "";
    expect(
      response.status() === 303 && location.startsWith("/start?x="),
      `expected the app's 303 to /start?x=..., got ${describeGate(response)} ${location.slice(0, 80)}`,
    );
    return `303 ${location}`;
  });
  await check("landing page is public", async () => {
    const response = await anonymous.get("/", { maxRedirects: 0 });
    expect(response.status() === 200, describeGate(response));
    return "200";
  });
}

async function apiBoundaryChecks(operator) {
  await check("signed-out session is anonymous", async () => {
    const response = await operator.get("/api/me", { maxRedirects: 0 });
    expect(response.ok(), `/api/me ${describeGate(response)}`);
    const body = await response.json();
    expect(body.user === null, `/api/me returned ${JSON.stringify(body)}`);
    return "/api/me user=null";
  });
  await check("private API refuses signed-out requests", async () => {
    const response = await operator.get("/api/imports", { maxRedirects: 0 });
    expect(response.status() === 401, `/api/imports ${describeGate(response)}`);
    const body = await response.json();
    expect(body.error, "401 without an application error message");
    return `401 ${body.error}`;
  });
  await check("pages send security headers", async () => {
    const response = await operator.get("/start", { maxRedirects: 0 });
    expect(response.ok(), `/start ${describeGate(response)}`);
    const missing = Object.entries(SECURITY_HEADERS)
      .filter(([name, value]) => !value.test(response.headers()[name] ?? ""))
      .map(([name]) => name);
    expect(missing.length === 0, `missing or wrong: ${missing.join(", ")}`);
    return Object.keys(SECURITY_HEADERS).join(", ");
  });
  await check("X sign-in is configured", async () => {
    const response = await operator.get("/api/x", { maxRedirects: 0 });
    expect(response.ok(), `/api/x ${describeGate(response)}`);
    const body = await response.json();
    expect(
      body.available === true,
      "X sign-in is unavailable (X_CLIENT_ID/X_CLIENT_SECRET/X_CALLBACK_URL/X_READS_ENABLED)",
    );
    return "available=true";
  });
}

function authorizeTargetAllowed(target) {
  if (`${target.origin}${target.pathname}` === X_AUTHORIZE) return true;
  return (
    LOOPBACK.has(new URL(base).hostname) &&
    target.protocol === "http:" &&
    LOOPBACK.has(target.hostname)
  );
}

function checkAuthorizeRequest(href) {
  const target = new URL(href);
  const params = target.searchParams;
  expect(authorizeTargetAllowed(target), `unexpected authorize URL ${href}`);
  expect(params.get("response_type") === "code", "response_type is not code");
  expect(params.get("client_id"), "client_id is empty");
  expect(
    params.get("redirect_uri") === `${base}/api/auth/x/callback`,
    `redirect_uri is ${params.get("redirect_uri")}`,
  );
  const scopes = (params.get("scope") ?? "").split(" ").sort();
  expect(
    scopes.join(" ") === [...X_SCOPES].sort().join(" "),
    `scope is "${params.get("scope")}", expected exactly ${X_SCOPES.join(" ")}`,
  );
  expect(params.get("code_challenge_method") === "S256", "PKCE is not S256");
  expect(params.get("code_challenge") && params.get("state"), "no PKCE/state");
  return `${target.origin}${target.pathname} client_id=${params.get("client_id")}`;
}

async function screenshot(page, name) {
  await page.screenshot({
    path: join(evidence, `${name}.png`),
    fullPage: true,
  });
}

async function openOnSite(page, path) {
  await page.goto(path);
  const landed = new URL(page.url());
  expect(landed.origin === base, `redirected to ${landed.origin}`);
}

async function signedInEmail(page) {
  const me = await appGet(page, "/api/me");
  return (await me.json()).user?.email ?? null;
}

async function xConsentJourney(context) {
  const page = await context.newPage();
  const link = page.getByRole("link", { name: "Continue with X" });
  try {
    const offered = await check(
      "start page offers Continue with X",
      async () => {
        await openOnSite(page, "/start");
        await link.waitFor({ timeout: 15_000 });
        await screenshot(page, "01-start");
        return `href=${await link.getAttribute("href")}`;
      },
    );
    if (!offered) return;
    await check("Continue with X sends PKCE authorization to X", async () => {
      const start = await appGet(page, await link.getAttribute("href"), {
        maxRedirects: 0,
      });
      const location = start.headers()["location"] ?? "";
      expect(
        start.status() === 303 && location,
        `X start returned ${describeGate(start)} ${location}`,
      );
      const detail = checkAuthorizeRequest(location);
      if (loadXConsent) {
        await page.goto(location);
        await page.waitForLoadState("networkidle").catch(() => null);
        await screenshot(page, "02-x-consent");
      }
      return detail;
    });
  } finally {
    await page.close();
  }
}

async function signUpJourney(context, account) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      errors.push(message.text());
  });
  const signedUp = await check("new user signs up with email", async () => {
    await openOnSite(page, "/start");
    await page.locator("[data-email-fallback] summary").click();
    const form = page.locator('[data-form="signup"]');
    await form.getByLabel("Email").fill(account.email);
    await form.getByLabel("Password").fill(account.password);
    await form.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app$/, { timeout: 30_000 });
    await page.locator("[data-first]").waitFor();
    await screenshot(page, "03-app-first-run");
    expect(
      (await signedInEmail(page)) === account.email,
      "signed-in user is not the new account",
    );
    return account.email;
  });
  if (!signedUp) return page.close();
  await check("new account starts empty", async () => {
    const skills = await (await appGet(page, "/api/skills")).json();
    const units = await (await appGet(page, "/api/imports")).json();
    expect(
      skills.skills.length === 0 && units.units.length === 0,
      "new account already has skills or imports",
    );
    await page
      .locator("[data-first-title]")
      .filter({ hasText: /\S/ })
      .waitFor();
    return `"${await page.locator("[data-first-title]").textContent()}"`;
  });
  await check("sign out ends the session", async () => {
    await page.locator("[data-signout]").click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
    expect((await signedInEmail(page)) === null, "still signed in");
    return "/api/me user=null";
  });
  await check("returning user signs in with email", async () => {
    await openOnSite(page, "/start#signin");
    const form = page.locator('[data-form="login"]');
    await form.waitFor({ state: "visible" });
    await form.getByLabel("Email").fill(account.email);
    await form.getByLabel("Password").fill(account.password);
    await form.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/, { timeout: 30_000 });
    expect(
      (await signedInEmail(page)) === account.email,
      "signed-in user is not the account",
    );
    return "back on /app";
  });
  if (importLink) await importJourney(page);
  await check(
    "no page errors or CSP violations during the journey",
    async () => {
      expect(errors.length === 0, errors.join(" | "));
      return "0";
    },
  );
  await page.close();
}

async function readySkills(page) {
  const { skills } = await (await appGet(page, "/api/skills")).json();
  return skills.filter((skill) => skill.status === "ready");
}

async function importJourney(page) {
  const imported = await check("pasted link is imported", async () => {
    const form = page.locator("[data-add]:visible");
    if (!(await form.locator("[data-paste-fallback]").getAttribute("open")))
      await form.locator("[data-paste-fallback] summary").click();
    await form.locator("textarea").fill(importLink);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/imports") && r.request().method() === "POST",
    );
    await form.locator('button[type="submit"]').click();
    const result = await response;
    expect(result.status() === 201, `POST /api/imports ${result.status()}`);
    const { processor } = await result.json();
    expect(processor === "requested", `processor=${processor}`);
    return `processor=${processor}`;
  });
  if (!imported) return;
  const generated = await check(
    "skill is generated from the link",
    async () => {
      const deadline = Date.now() + importTimeout;
      while (Date.now() < deadline) {
        const ready = await readySkills(page);
        if (ready.length) return `${ready.length} ready: ${ready[0].name}`;
        await page.waitForTimeout(10_000);
      }
      await screenshot(page, "04-import-timeout");
      throw new Error(`no ready skill within ${importTimeout / 1000}s`);
    },
  );
  if (!generated) return;
  await check("user keeps the skill and can install SKILL.md", async () => {
    await page.reload();
    await page.locator('[data-open-skills="skills"]').click();
    const keep = page.getByRole("checkbox", { name: /^Keep / }).first();
    await keep.check();
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/skills/choices") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Keep selected", exact: true })
      .click();
    const response = await saved;
    expect(response.ok(), `POST /api/skills/choices ${response.status()}`);
    expect(
      response.request().postDataJSON().generateVideos === false,
      "keeping a skill requested a video",
    );
    await page
      .getByRole("button", { name: "Show SKILL.md", exact: true })
      .first()
      .click();
    const markdown = await page
      .locator(".skill-md:visible")
      .first()
      .textContent();
    expect(/^---\nname: /m.test(markdown), "SKILL.md has no front matter");
    await page
      .getByRole("button", { name: "Download", exact: true })
      .first()
      .waitFor();
    await screenshot(page, "05-kept-skill");
    return markdown.split("\n").find((line) => line.startsWith("name: "));
  });
}

async function main() {
  await mkdir(evidence, { recursive: true });
  console.log(`Resurface smoke against ${base}`);
  console.log(`Evidence: ${evidence}`);
  const anonymous = await request.newContext({ baseURL: base });
  const operator = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: operatorHeaders,
    httpCredentials: operatorCredentials,
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1280, height: 900 },
    httpCredentials: operatorCredentials,
  });
  await siteOnlyAccess(context);
  try {
    await publicChecks(anonymous);
    await apiBoundaryChecks(operator);
    await xConsentJourney(context);
    await signUpJourney(context, throwawayAccount());
  } finally {
    await context.close();
    await browser.close();
    await anonymous.dispose();
    await operator.dispose();
  }
  const failed = results.filter((result) => !result.ok);
  await writeFile(
    join(evidence, "report.json"),
    `${JSON.stringify({ base, at: new Date().toISOString(), importLink: importLink ?? null, results }, null, 2)}\n`,
  );
  console.log(
    `${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

await main();
