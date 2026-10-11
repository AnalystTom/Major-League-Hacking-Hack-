// Which output failures are worth another attempt. A retry repays for the script or skill call, so failures that
// can't change by trying again settle at once: the provider refused the request itself (4xx other than 408 and
// 429), a quota or prepaid credit is used up, or the processor is missing configuration. Network errors, timeouts,
// 5xx, a short-lived 429, and a model reply that failed validation (the next reply may well pass) are retried.

const HTTP = /\b(?:OpenAI|TTS|Gemini|twitterapi\.io|Digestion|R2 upload of \S+ failed:) HTTP (\d{3})\b/;
const EXHAUSTED = /per ?day|daily|free ?tier|quota|credits? (?:are |is )?depleted|prepayment|billing/i;

export function isPermanentFailure(message: string): boolean {
  if (/isn't configured|is not configured/.test(message)) return true;
  const status = Number(HTTP.exec(message)?.[1]);
  if (!status) return false;
  if (status === 429) return EXHAUSTED.test(message);
  if (status === 408) return false;
  return status >= 400 && status < 500;
}
