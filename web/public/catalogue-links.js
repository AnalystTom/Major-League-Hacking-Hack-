import { api } from "./api.js";

export async function hasPublicCatalogue(load = api) {
  const [reels, skills] = await Promise.allSettled([load("/api/feed?scope=public"), load("/api/skills?scope=public")]);
  return (reels.status === "fulfilled" && reels.value.items?.length > 0)
    || (skills.status === "fulfilled" && skills.value.skills?.length > 0);
}

export async function showCatalogueLinks(root, load = api) {
  const visible = await hasPublicCatalogue(load);
  for (const link of root.querySelectorAll("[data-catalogue-link]")) link.hidden = !visible;
  return visible;
}
