// Canonical source identity also collapses historical extractor rows without deleting them.
import { parseYouTubeLink } from "./youtube.js";
import { parseXLink } from "./xpost.js";
import { parseSubstackLink } from "./substack.js";

export function sourceKey(url, startSeconds) {
  for (const parse of [parseYouTubeLink, parseXLink, parseSubstackLink]) {
    const result = parse(url);
    if (result.ok) return JSON.stringify([result.value.source_url, startSeconds === undefined ? result.value.start_seconds : startSeconds]);
  }
  return JSON.stringify([url, startSeconds ?? null]);
}

export function dedupeContent(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const sources = (row.source_units?.length ? row.source_units : [row]).filter((s) => s.source_url);
    if (!sources.length) return true;
    const key = JSON.stringify([...new Set(sources.map((s) => sourceKey(s.source_url, s.start_seconds)))].sort());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
