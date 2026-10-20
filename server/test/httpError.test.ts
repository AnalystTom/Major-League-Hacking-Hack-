import test from "node:test";
import assert from "node:assert/strict";
import { httpError } from "../src/httpError.js";

test("provider errors show their JSON message on one line, or the raw body", () => {
  const google = JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, null, 2);
  assert.equal(httpError("Gemini", 400, google), "Gemini HTTP 400: API key not valid. Please pass a valid API key.");
  assert.equal(httpError("OpenAI", 429, '{"error":{"message":"Rate limit\\nreached"}}'), "OpenAI HTTP 429: Rate limit reached");
  assert.equal(httpError("TTS", 502, "<html>Bad gateway</html>"), "TTS HTTP 502: <html>Bad gateway</html>");
  assert.equal(httpError("X", 500, "a".repeat(400)).length, "X HTTP 500: ".length + 300);
});
