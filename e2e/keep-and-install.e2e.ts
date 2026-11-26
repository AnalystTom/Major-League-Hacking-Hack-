import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("a user keeps a skill and sees its SKILL.md with the source link", async ({
  app,
  agent,
  browser,
}) => {
  await app.open("/start");
  await agent.act(
    "continue with X, then authorize the fixture bookmarks on the local X authorization fixture page",
  );
  await expect(browser.locator('[data-count="skills"]')).toHaveText("2", {
    timeout: 90_000,
  });
  await agent.act(
    "open the Skills list, keep only the first skill, press Keep selected, then press Show SKILL.md on the kept skill",
  );
  await expect(browser.locator(".skill-md:visible")).toContainText(
    "https://x.com/i/status/",
  );
});
