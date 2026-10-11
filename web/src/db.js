// TigerData connection. Prefers a Hyperdrive binding (pooled, for production) and falls back to the
// DATABASE_URL secret (local dev via .dev.vars, or a direct connection).

import postgres from "postgres";

export function connect(env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return null;
  // One connection per request; fetch_types off skips a catalogue round trip on every connect.
  return postgres(url, { max: 1, fetch_types: false, connect_timeout: 10 });
}
