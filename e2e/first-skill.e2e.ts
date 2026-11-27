import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("a new user signs up with X and sees two skills ready", async ({
  app,
  agent,
  browser,
}) => {
  await app.open("/start");
  await agent.act(
    "continue with X, then authorize the fixture bookmarks on the local X authorization fixture page",
  );
  await expect(browser).toHaveURL(/\/app/);
  await expect(browser.locator('[data-count="skills"]')).toHaveText("2", {
    timeout: 90_000,
  });
  await expect(browser.locator("[data-first-title]")).toHaveText(
    "Your skills are ready",
  );
});
