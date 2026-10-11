/** The video's actual title from YouTube's public oEmbed endpoint, or null. A missing title never fails a unit. */
export async function fetchTitle(sourceUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const title = ((await res.json()) as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}
