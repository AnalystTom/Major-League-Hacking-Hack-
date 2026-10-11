import type pg from "pg";

// A hosted database (TigerData) only accepts TLS, and node-postgres connects without it unless the URL says
// sslmode=…, so a URL pasted without it failed every connection. Local databases keep plain connections.
export function poolConfig(url: string): pg.PoolConfig {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const local = ["localhost", "127.0.0.1", "::1", ""].includes(host);
  return {
    connectionString: url,
    ...(local || /[?&]sslmode=/.test(url) ? {} : { ssl: true }),
    // Fail a connect after 10 s instead of waiting forever, and keep idle sockets alive, so a lost database
    // shows up as "processing failed: <reason>" on /health and the next sweep retries, rather than a silent stall.
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  };
}

