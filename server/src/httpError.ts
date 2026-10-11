/** "<label> HTTP <status>: <message>", using the provider's JSON error message when the body has one. */
export function httpError(label: string, status: number, body: string): string {
  let detail = body;
  try {
    const message = JSON.parse(body)?.error?.message;
    if (typeof message === "string" && message.trim()) detail = message;
  } catch {}
  return `${label} HTTP ${status}: ${detail.replace(/\s+/g, " ").trim().slice(0, 300)}`;
}
