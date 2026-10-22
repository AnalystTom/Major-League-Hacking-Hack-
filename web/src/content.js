// Canonical source identity also collapses historical extractor rows without deleting them.
import { parseYouTubeLink } from "./youtube.js";
import { parseXLink } from "./xpost.js";
import { parseSubstackLink } from "./substack.js";

export function sourceKey(url) {
  for (const parse of [parseYouTubeLink, parseXLink, parseSubstackLink]) {
    const result = parse(url);
    if (result.ok) return result.value.source_url;
  }
  return url;
}

export function dedupeContent(rows) {
  const seenSources = new Set(), seenIds = new Set(), seenMedia = new Set();
  return rows.filter((row) => {
    const sources = (row.source_urls?.length ? row.source_urls : [row.source_url]).filter(Boolean).map(sourceKey);
    if (seenIds.has(row.artifact_id ?? row.id) || (row.media_ref && seenMedia.has(row.media_ref)) || sources.some((s) => seenSources.has(s))) return false;
    seenIds.add(row.artifact_id ?? row.id);
    if (row.media_ref) seenMedia.add(row.media_ref);
    sources.forEach((s) => seenSources.add(s));
    return true;
  });
}
