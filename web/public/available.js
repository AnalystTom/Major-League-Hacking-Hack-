import { api } from "./api.js";
import { createReel } from "./reel.js";
import { createSkills } from "./skills.js";
const $ = (s) => document.querySelector(s);
const reel = createReel($("[data-reel]"));
const skills = createSkills({ skillsList: $("[data-skills]"), picker: $("[data-agent]"), skillsStatus: $("[data-skills-status]") });
const status = $("[data-catalogue-status]");
Promise.allSettled([api("/api/feed?scope=public"), api("/api/skills?scope=public")]).then(([reels, list]) => {
  const errors = [];
  if (reels.status === "fulfilled") {
    reel.render(reels.value.items);
    $("[data-reels-empty]").hidden = reel.count > 0;
  } else errors.push(`Couldn't load public reels. ${reels.reason.message}`);
  if (list.status === "fulfilled") {
    skills.update(list.value.skills);
    $("[data-skills-empty]").hidden = list.value.skills.length > 0;
  } else errors.push(`Couldn't load public skills. ${list.reason.message}`);
  status.textContent = errors.join(" ");
});
