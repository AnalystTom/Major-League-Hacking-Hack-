// Validates a waitlist submission. Kept free of Worker APIs so it can be unit tested with node --test.

export const AGENTS = ["claude-code", "codex", "cursor", "hermes", "other"];
export const SOURCES = ["x-bookmarks", "youtube", "github-stars", "newsletters", "read-later"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseSignup(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Send a JSON body with an email field." };
  }
  // Honeypot: real visitors never see or fill the "company" field.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return { ok: false, status: 202, error: "ignored" };
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, status: 400, error: "Enter an email address like you@example.com." };
  }

  const agent = AGENTS.includes(body.agent) ? body.agent : null;
  const sources = Array.isArray(body.sources)
    ? [...new Set(body.sources.filter((s) => SOURCES.includes(s)))]
    : [];

  return { ok: true, value: { email, agent, sources } };
}
