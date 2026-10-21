import { isTextTranscript, type IngestedUnit } from "../types.js";

export { SYSTEM_PROMPT, DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from "./contract.js";

/** The short handle the model sees for the i-th unit; mapped back to the real id before validation. */
export const unitRef = (i: number) => `u${i + 1}`;

export function buildUserMessage(units: IngestedUnit[], request: string, fewShot: unknown[] = []): string {
  return JSON.stringify({
    categorization_request: request,
    reviewed_examples: fewShot,
    units: units.map((u, i) => ({
      ref: unitRef(i), source_url: u.sourceUrl, title: u.title, content_type: u.contentType ?? "youtube_video",
      overview: u.transcript?.overview,
      ...(isTextTranscript(u.transcript) ? { sections: u.transcript.sections } : { evidence_items: u.transcript?.evidence_items }),
    })),
  }, null, 2);
}
