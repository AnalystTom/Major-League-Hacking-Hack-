import { test, expect } from "@playwright/test";

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
  const video = page.getByRole("checkbox", {
    name: "Request videos for selected skills",
  });
  await expect(video).not.toBeChecked();
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
  await expect(video).not.toBeChecked();
  await page
    .getByRole("button", { name: "Show SKILL.md", exact: true })
    .first()
    .click();
  await expect(page.locator(".skill-md:visible")).toContainText(
    "https://x.com/i/status/",
  );
  await capture("kept-source-linked-skill");
  await video.check();
  const optIn = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/skills/choices") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Keep selected", exact: true })
    .click();
  const requested = await optIn;
  expect(requested.ok()).toBe(true);
  expect(requested.request().postDataJSON().generateVideos).toBe(true);
  await expect(page.locator("[data-skills-status]")).toContainText(
    "Videos requested",
  );
  await expect(page.getByText("Video requested", { exact: true })).toHaveCount(
    1,
  );
  await capture("explicit-video-request");
  await page.goto("/available");
  await expect(page.locator("[data-skills] .skill")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a new account reaches the paste action without a tall blank frame, and SHORTS off hides video requests", async ({
  page,
}, info) => {
  await page.route("**/api/x", (route) =>
    route.fulfill({ json: { available: false, connected: false } }),
  );
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({ json: { shorts: false } }),
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
  await page.locator('[data-open-skills="skills"]').click();
  await expect(
    page.getByRole("checkbox", { name: "Request videos for selected skills" }),
  ).toHaveCount(0);
  await expect(page.locator("[data-skills-hint]")).toHaveText(
    "Choose the skills to keep.",
  );
  const path = info.outputPath("shorts-off-mobile.png");
  await page.screenshot({ path, fullPage: true });
  await info.attach("SYNTHETIC X FIXTURE — SHORTS off", {
    path,
    contentType: "image/png",
  });
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/skills/choices") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Keep selected", exact: true })
    .click();
  expect((await saved).request().postDataJSON().generateVideos).toBe(false);
});
