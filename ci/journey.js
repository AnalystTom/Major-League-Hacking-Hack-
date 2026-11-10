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
  await expect(page.locator('[data-count="skills"]')).toHaveText("2");
  await expect(page.locator("[data-first-title]")).toHaveText(
    "Your skills are ready",
  );
  await expect(page.locator("[data-x-note]")).not.toContainText(
    "Processing started",
  );
  await capture("ready");
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
