import { join } from "node:path";
import { test, expect } from "@playwright/test";

test.use({ video: "on" });

test("stubbed X onboarding, scan, pick skills, persistence and explicit video opt-in", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const capture = async (name) => {
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(`SYNTHETIC X FIXTURE — ${name}`, {
      path,
      contentType: "image/png",
    });
  };
  await page.addInitScript(() => {
    window.seenStages = new Set();
    new MutationObserver(() => {
      for (const stage of document.querySelectorAll(".unit-stage"))
        window.seenStages.add(stage.textContent);
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await page.goto("/start");
  await page.getByRole("link", { name: "Continue with X" }).click();
  await expect(
    page.getByRole("heading", { name: "Local X authorization fixture" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Authorize fixture bookmarks" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(
    page.locator('[data-first-units] [data-moving="true"]').first(),
  ).toBeVisible();
  await expect(
    page.locator("[data-first-units] .unit-scan").first(),
  ).toBeVisible();
  const card = page.locator("[data-first]");
  const scanBox = await card.boundingBox();
  expect(scanBox.y).toBeLessThan(140);
  expect(scanBox.width).toBeGreaterThan(700);
  expect(scanBox.height).toBeLessThan(650);
  await capture("scan");
  const writing = page
    .locator("[data-first-units] li")
    .filter({ hasText: "Writing your skill" })
    .first();
  await expect(writing).toBeVisible();
  await expect(writing.locator('.unit-scan [data-current="true"]')).toHaveText(
    "Digest",
  );
  await capture("writing-skill");
  await expect(page.locator('[data-count="skills"]')).toHaveText("2");
  await expect(page.locator("[data-first-title]")).toHaveText(
    "Your skills are ready",
  );
  await expect(page.locator("[data-x-note]")).not.toContainText(
    "Processing started",
  );
  await capture("ready");
  expect(await page.evaluate(() => [...window.seenStages])).not.toContain(
    "Rendering the short",
  );
  await page.locator('[data-open-skills="skills"]').click();
  const keeps = page.getByRole("checkbox", { name: /^Keep / });
  await expect(keeps).toHaveCount(2);
  const video = page.getByRole("button", {
    name: "Make my video",
    exact: true,
  });
  await expect(video).toHaveCount(2);
  await keeps.nth(1).uncheck();
  await capture("pick-skills");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/skills/choices") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Keep selected", exact: true })
    .click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().generateVideos).toBe(false);
  expect(
    response
      .request()
      .postDataJSON()
      .choices.map((c) => c.keep),
  ).toEqual([true, false]);
  await expect(
    page.getByRole("button", { name: "Copy SKILL.md", exact: true }),
  ).toHaveCount(1);
  await page.reload();
  await page.locator('[data-open-skills="skills"]').click();
  await expect(keeps.nth(0)).toBeChecked();
  await expect(keeps).toHaveCount(1);
  await expect(video).toHaveCount(1);
  await page
    .getByRole("button", { name: "Show SKILL.md", exact: true })
    .first()
    .click();
  await expect(page.locator(".skill-md:visible")).toContainText(
    "https://x.com/i/status/",
  );
  await capture("kept-source-linked-skill");
  const optIn = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/skills/choices") &&
      r.request().method() === "POST",
  );
  await video.click();
  const requested = await optIn;
  expect(requested.ok()).toBe(true);
  expect(requested.request().postDataJSON().generateVideos).toBe(true);
  await expect(page.locator("[data-video-status]")).toContainText(
    "Your video is queued",
  );
  await expect(video).toHaveCount(0);
  await capture("explicit-video-request");
  await page.goto("/available");
  await expect(page.locator("[data-skills] .skill")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a new account reaches the paste action without a tall blank frame", async ({
  page,
}, info) => {
  await page.route("**/api/x", (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
  const response = await page.request.post("/api/auth/signup", {
    data: {
      email: `ui-layout-${Date.now()}@example.test`,
      password: "isolated-fixture-password",
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/app");
  await expect(page.locator("[data-paste-fallback]")).toHaveAttribute(
    "open",
    "",
  );
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const card = await page.locator("[data-first]").boundingBox();
    const button = await page
      .locator('[data-add] button[type="submit"]')
      .boundingBox();
    expect(card.y).toBeLessThan(140);
    expect(button.y + button.height).toBeLessThan(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    const path = info.outputPath(`empty-${viewport.width}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(`SYNTHETIC X FIXTURE — empty ${viewport.width}`, {
      path,
      contentType: "image/png",
    });
  }
  await page
    .locator("[data-add] textarea")
    .fill("https://x.com/i/status/1234567890123456789");
  await page.locator('[data-add] button[type="submit"]').click();
  await expect(page.locator('[data-count="skills"]')).toHaveText("1");
  await expect(page.locator("[data-first-note]")).toHaveText("");
});

test("a new account deletes itself from the app and cannot sign in again", async ({
  page,
}, info) => {
  const email = `delete-${Date.now()}@example.test`;
  const password = "isolated-fixture-password";
  const signup = await page.request.post("/api/auth/signup", {
    data: { email, password },
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/app");
  await page.locator("[data-open-delete]").click();
  await expect(page.locator("[data-delete-sheet]")).toBeVisible();
  const path = info.outputPath("delete-account-confirm.png");
  await page.screenshot({ path, fullPage: true });
  await info.attach("SYNTHETIC FIXTURE — delete account confirmation", {
    path,
    contentType: "image/png",
  });
  await page.locator("[data-confirm-delete]").click();
  await page.waitForURL((url) => url.pathname === "/");
  const me = await page.request.get("/api/me");
  expect(await me.json()).toEqual({ user: null });
  const login = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(login.status()).toBe(401);
});

test.describe("video limit messages", () => {
  test("daily cap, one account slot, failure and existing video", async ({
    page,
  }, info) => {
    const capture = async (name) => {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        const path = info.outputPath(`${name}-${viewport.width}.png`);
        await page.screenshot({ path, fullPage: true });
        await info.attach(`Isolated API fixture — ${name} ${viewport.width}`, {
          path,
          contentType: "image/png",
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(viewport.width);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    };
    const state = async (value) => {
      const response = await page.request.post("/__fixture/video", {
        data: { state: value },
      });
      expect(response.ok()).toBe(true);
    };
    const signup = await page.request.post("/api/auth/signup", {
      data: {
        email: `video-limits-${Date.now()}@example.test`,
        password: "isolated-fixture-password",
      },
    });
    expect(signup.ok()).toBe(true);
    await state("prepare");
    if (process.env.UI_REFERENCE_DIR) {
      await page.route("**/skills.js", (route) =>
        route.fulfill({
          path: join(process.env.UI_REFERENCE_DIR, "skills.js"),
          contentType: "text/javascript",
        }),
      );
      await page.route("**/app", (route) =>
        route.fulfill({
          path: join(process.env.UI_REFERENCE_DIR, "app.html"),
          contentType: "text/html",
        }),
      );
      await page.goto("/app");
      await page.locator('[data-open-skills="skills"]').click();
      await expect(
        page.getByRole("checkbox", {
          name: "Request videos for selected skills",
        }),
      ).toBeVisible();
      await capture("reference-main-skills");
      await page.unroute("**/skills.js");
      await page.unroute("**/app");
    }
    await page.goto("/app");
    await page.locator('[data-open-skills="skills"]').click();
    await expect(
      page.getByRole("button", { name: "Make my video", exact: true }),
    ).toHaveCount(2);
    await capture("video-choice");
    await state("daily-limit");
    try {
      await page
        .getByRole("button", { name: "Make my video", exact: true })
        .first()
        .click();
      await expect(page.locator("[data-video-status]")).toContainText(
        "daily video limit",
      );
      await expect(page.locator("[data-video-status]")).toContainText("UTC");
      await capture("daily-limit");
    } finally {
      await state("reset-budget");
    }
    await page
      .getByRole("button", { name: "Make my video", exact: true })
      .first()
      .click();
    await expect(page.locator("[data-video-status]")).toContainText(
      "Your video is queued",
    );
    await state("failed");
    await page.reload();
    await page.locator('[data-open-skills="skills"]').click();
    await expect(page.locator("[data-video-status]")).toContainText(
      "Your video couldn't be made",
    );
    await expect(
      page.getByRole("button", { name: "Make my video", exact: true }),
    ).toHaveCount(0);
    await capture("generation-failed");
    await state("ready");
    await page.reload();
    await page.locator('[data-open-skills="skills"]').click();
    await expect(page.locator("[data-video-status]")).toContainText(
      "You've already made your video",
    );
    const link = page.getByRole("link", { name: "Watch your video" });
    await expect(link).toHaveAttribute(
      "href",
      "/media/videos/fixture/short.mp4",
    );
    expect((await page.request.get(await link.getAttribute("href"))).ok()).toBe(
      true,
    );
    await capture("existing-video");
  });
});

test("every page loads under the content security policy without violations", async ({
  page,
}) => {
  const violations = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(error.message));
  for (const path of [
    "/",
    "/start",
    "/app",
    "/available",
    "/privacy",
    "/terms",
  ]) {
    const response = await page.goto(path, { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-security-policy"], path).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
    expect(response.headers()["referrer-policy"], path).toBe(
      "strict-origin-when-cross-origin",
    );
  }
  expect(violations).toEqual([]);
});

test("an unsupported link's error wraps inside the card on a phone", async ({
  page,
}) => {
  await page.route("**/api/x", (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
  const response = await page.request.post("/api/auth/signup", {
    data: {
      email: `wrap-${Date.now()}@example.test`,
      password: "isolated-fixture-password",
    },
  });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page
    .locator("[data-add] textarea")
    .fill(
      "https://newsletter.pragmaticengineer.com/p/how-anthropic-built-artifacts",
    );
  await page.locator('[data-add] button[type="submit"]').click();
  const status = page.locator("[data-add] .form-status");
  await expect(status).toContainText(
    "Only YouTube videos and X posts are supported",
  );
  const card = await page.locator("[data-first]").boundingBox();
  const message = await status.boundingBox();
  expect(message.x + message.width).toBeLessThanOrEqual(card.x + card.width);
  expect(
    await status.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`a pasted Substack link is refused up front and the hint no longer names Substack at ${viewport.width}`, async ({
    page,
  }, info) => {
    await page.route("**/api/x", (route) =>
      route.fulfill({ json: { available: false, connected: false } }),
    );
    const response = await page.request.post("/api/auth/signup", {
      data: {
        email: `substack-${viewport.width}-${Date.now()}@example.test`,
        password: "isolated-fixture-password",
      },
    });
    expect(response.ok()).toBe(true);
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await expect(page.locator("body")).not.toContainText("Substack");
    const form = page.locator("[data-add]");
    await expect(form.locator("label")).toContainText(
      "YouTube or X post links",
    );
    await form
      .locator("textarea")
      .fill("https://newsletter.substack.com/p/evals-first");
    await form.locator('button[type="submit"]').click();
    const status = form.locator(".form-status");
    await expect(status).toContainText("Substack links are not supported yet");
    await expect(page.locator("body")).not.toContainText(
      "Couldn't read this source",
    );
    const units = await page.request.get("/api/skills");
    expect(units.ok()).toBe(true);
    expect(JSON.stringify(await units.json())).not.toContain("substack.com");
    await page.screenshot({
      path: info.outputPath(`substack-${viewport.width}.png`),
    });
  });
}

test("an unknown address shows the not-found page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("href", "/");
});

test("the /available links appear only when the public catalogue has content", async ({
  page,
}, info) => {
  const response = await page.request.post("/api/auth/signup", {
    data: {
      email: `catalogue-${Date.now()}@example.test`,
      password: "isolated-fixture-password",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const isPublicCatalogue = (url) =>
    url.searchParams.get("scope") === "public" &&
    ["/api/feed", "/api/skills"].includes(url.pathname);
  for (const [state, catalogue, visible] of [
    ["empty", { items: [], skills: [] }, false],
    ["non-empty", { items: [], skills: [{ id: "public-skill" }] }, true],
  ]) {
    await page.unroute(isPublicCatalogue);
    await page.route(isPublicCatalogue, (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/feed")
          ? { items: catalogue.items }
          : { skills: catalogue.skills },
      }),
    );
    for (const [path, name] of [
      ["/app", "View available reels & Skills"],
      ["/no-such-page", "Public reels & skills"],
    ]) {
      const checked = page.waitForResponse((r) =>
        r.url().endsWith("/api/skills?scope=public"),
      );
      await page.goto(path);
      await checked;
      const link = page.getByRole("link", { name });
      if (visible) {
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", "/available");
      } else {
        await expect(link).toBeHidden();
      }
      const shot = info.outputPath(`${state}${path.replaceAll("/", "-")}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await info.attach(`${state} catalogue ${path}`, {
        path: shot,
        contentType: "image/png",
      });
    }
  }
});
