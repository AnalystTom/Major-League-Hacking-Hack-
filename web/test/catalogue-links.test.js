import test from "node:test";
import assert from "node:assert/strict";
import { hasPublicCatalogue, showCatalogueLinks } from "../public/catalogue-links.js";

const catalogue = ({ items = [], skills = [], fail = [] } = {}) => async (path) => {
  if (fail.some((prefix) => path.startsWith(prefix))) throw new Error("down");
  if (path === "/api/feed?scope=public") return { items };
  if (path === "/api/skills?scope=public") return { skills };
  throw new Error(`unexpected ${path}`);
};

const pageWithLinks = (count) => {
  const links = Array.from({ length: count }, () => ({ hidden: true }));
  return { links, querySelectorAll: (selector) => (selector === "[data-catalogue-link]" ? links : []) };
};

test("an empty public catalogue keeps every catalogue link hidden", async () => {
  const page = pageWithLinks(2);
  assert.equal(await showCatalogueLinks(page, catalogue()), false);
  assert.deepEqual(page.links.map((link) => link.hidden), [true, true]);
});

test("public reels or public skills reveal the catalogue links", async () => {
  for (const content of [{ items: [{ id: "r1" }] }, { skills: [{ id: "s1" }] }]) {
    const page = pageWithLinks(2);
    assert.equal(await showCatalogueLinks(page, catalogue(content)), true);
    assert.deepEqual(page.links.map((link) => link.hidden), [false, false]);
  }
});

test("one failed catalogue call still reveals links when the other has content, and hides them otherwise", async () => {
  assert.equal(await hasPublicCatalogue(catalogue({ skills: [{ id: "s1" }], fail: ["/api/feed"] })), true);
  assert.equal(await hasPublicCatalogue(catalogue({ items: [{ id: "r1" }], fail: ["/api/skills"] })), true);
  assert.equal(await hasPublicCatalogue(catalogue({ fail: ["/api/feed", "/api/skills"] })), false);
});
