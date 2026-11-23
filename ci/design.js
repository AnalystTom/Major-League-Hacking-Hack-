import { test, expect } from "@playwright/test";

const contrast = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const channels = (value) =>
        value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number);
      const luminance = ([r, g, b]) =>
        [r, g, b]
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const style = getComputedStyle(node);
      const [hi, lo] = [
        luminance(channels(style.color)),
        luminance(channels(style.backgroundColor)),
      ].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });

for (const scheme of ["light", "dark"]) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test("the palette query, stored palette and picker no longer change the theme", async ({
      page,
    }) => {
      await page.goto("/start");
      const accent = () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue(
            "--accent",
          ),
        );
      const baseline = await accent();
      await page.evaluate(() =>
        localStorage.setItem("resurface-palette", "cobalt"),
      );
      for (const query of ["?palette=cobalt", "?palette=violet&pick"]) {
        await page.goto(`/${query}`);
        expect(await accent()).toBe(baseline);
        expect(
          await page.evaluate(() => document.documentElement.dataset.palette),
        ).toBeUndefined();
        await expect(page.locator("[data-palette-picker]")).toHaveCount(0);
      }
      const script = await page.request.get("/palette.js");
      expect(script.status()).toBe(404);
    });

    test("the primary button meets 4.5:1 for small text", async ({ page }) => {
      await page.goto("/start");
      expect(await contrast(page, "button.btn[type=submit]")).toBeGreaterThan(
        4.5,
      );
    });

    test("the pressed reel sound button keeps the primary look at 4.5:1", async ({
      page,
    }) => {
      await page.route("**/api/feed?scope=public", (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: "reel-1",
                version: 1,
                name: "Fixture reel",
                video: {
                  url: "/hero-v7.mp4",
                  captions_url: null,
                  subtitles_burned: true,
                },
              },
            ],
          },
        }),
      );
      await page.route("**/api/skills?scope=public", (route) =>
        route.fulfill({ json: { skills: [] } }),
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/available");
      const sound = page.locator("[data-sound]");
      await sound.click();
      await expect(sound).toHaveAttribute("aria-pressed", "true");
      expect(await contrast(page, "[data-sound]")).toBeGreaterThan(4.5);
    });
  });
}

test("every button is one family: variants, one radius scale, danger for Delete account", async ({
  page,
}) => {
  await page.goto("/start");
  await page.getByRole("link", { name: "Continue with X" }).click();
  await page.getByRole("link", { name: "Authorize fixture bookmarks" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.locator('[data-count="skills"]')).toHaveText("2");

  const look = (selector) =>
    page.locator(selector).evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        family: node.classList.contains("btn"),
        color: style.color,
        fill: style.backgroundColor,
        radius: style.borderTopLeftRadius,
      };
    });
  const add = await look("[data-open-add]");
  const signOut = await look("[data-signout]");
  const del = await look("[data-open-delete]");
  const skills = await look('[data-open-skills="skills"]');

  for (const button of [add, signOut, del, skills]) {
    expect(button.family).toBe(true);
    expect(["12px", "999px"]).toContain(button.radius);
  }
  expect(skills.radius).toBe("999px");

  await page.locator('[data-open-skills="skills"]').click();
  const sheetActions = await page
    .locator("[data-skills-sheet] .skill button")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent.trim(),
        family: node.classList.contains("btn"),
        radius: getComputedStyle(node).borderTopLeftRadius,
      })),
    );
  expect(sheetActions.map((action) => action.text)).toEqual(
    expect.arrayContaining(["Show SKILL.md"]),
  );
  for (const action of sheetActions) {
    expect(action.family).toBe(true);
    expect(["12px", "999px"]).toContain(action.radius);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-skills-sheet]")).not.toHaveAttribute("open");
  expect(signOut.fill).toBe("rgba(0, 0, 0, 0)");
  expect(add.fill).not.toBe(signOut.fill);
  expect(del.color).not.toBe(signOut.color);
  const dangerColor = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue("--late-on-night"),
  );
  expect(dangerColor.trim()).toBe("#f39a91");
  expect(del.color).toBe("rgb(243, 154, 145)");

  await page.locator("[data-open-delete]").click();
  const confirm = await look("[data-confirm-delete]");
  expect(confirm.color).toBe("rgb(243, 154, 145)");
  expect(confirm.fill).toBe("rgba(0, 0, 0, 0)");

  const radii = await page.evaluate(() =>
    [...document.querySelectorAll(".btn")].map(
      (node) => getComputedStyle(node).borderTopLeftRadius,
    ),
  );
  for (const radius of radii) expect(["12px", "999px"]).toContain(radius);
});
