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
  await capture("scan");
  await expect(page.locator('[data-count="skills"]')).toHaveText("2");
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
