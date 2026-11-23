import { test, expect } from "@playwright/test";

const LARGE_BUTTON = {
  font: "Funnel Display",
  weight: "700",
  size: "19px",
  padding: "18px 26px",
};

const SMALL_BUTTON = {
  font: "Funnel Display",
  weight: "700",
  size: "15px",
  padding: "11px 16px",
};

const readLook = (node) => {
  const style = getComputedStyle(node);
  return {
    color: style.color,
    fill: style.backgroundColor,
    radius: style.borderTopLeftRadius,
    font: style.fontFamily.split(",")[0].replaceAll('"', ""),
    weight: style.fontWeight,
    size: style.fontSize,
    padding: `${style.paddingTop} ${style.paddingRight}`,
  };
};

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
      const transparent = /^rgba\([^)]*,\s*0\)$/;
      let surface = node;
      while (
        transparent.test(getComputedStyle(surface).backgroundColor) &&
        surface.parentElement
      ) {
        surface = surface.parentElement;
      }
      const [hi, lo] = [
        luminance(channels(getComputedStyle(node).color)),
        luminance(channels(getComputedStyle(surface).backgroundColor)),
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
  const look = (selector) => page.locator(selector).first().evaluate(readLook);
  const primary = await look("button.btn[type=submit]");
  expect(primary).toMatchObject(LARGE_BUTTON);
  await page.getByRole("link", { name: "Continue with X" }).click();
  await page.getByRole("link", { name: "Authorize fixture bookmarks" }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.locator('[data-count="skills"]')).toHaveText("2");

  const add = await look("[data-open-add]");
  const signOut = await look("[data-signout]");
  const del = await look("[data-open-delete]");
  const skills = await look('[data-open-skills="skills"]');

  for (const button of [add, signOut, del, skills]) {
    expect(button).toMatchObject(SMALL_BUTTON);
    expect(["12px", "999px"]).toContain(button.radius);
  }
  expect(skills.radius).toBe("999px");

  await page.locator('[data-open-skills="skills"]').click();
  const sheetActions = [];
  for (const button of await page
    .locator("[data-skills-sheet] .skill button")
    .all()) {
    sheetActions.push({
      text: (await button.textContent()).trim(),
      ...(await button.evaluate(readLook)),
    });
  }
  expect(sheetActions.map((action) => action.text)).toEqual(
    expect.arrayContaining(["Show SKILL.md"]),
  );
  for (const action of sheetActions) {
    expect(action).toMatchObject(SMALL_BUTTON);
    expect(["12px", "999px"]).toContain(action.radius);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-skills-sheet]")).not.toHaveAttribute("open");
  expect(signOut.fill).toBe("rgba(0, 0, 0, 0)");
  expect(add.fill).not.toBe(signOut.fill);
  expect(del.color).not.toBe(signOut.color);
  expect(await contrast(page, "[data-open-delete]")).toBeGreaterThan(4.5);

  await page.locator("[data-open-delete]").click();
  const confirm = await look("[data-confirm-delete]");
  expect(confirm).toMatchObject(SMALL_BUTTON);
  expect(confirm.fill).toBe("rgba(0, 0, 0, 0)");
  expect(await contrast(page, "[data-confirm-delete]")).toBeGreaterThan(4.5);

  const radii = await page.evaluate(() =>
    [...document.querySelectorAll(".btn")].map(
      (node) => getComputedStyle(node).borderTopLeftRadius,
    ),
  );
  for (const radius of radii) expect(["12px", "999px"]).toContain(radius);
});
