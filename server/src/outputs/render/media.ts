// Where rendered files go: the R2 bucket the web Worker serves /media/ from. Every upload is read back before
// the processor stores its reference, so a video result never points at a missing file.

import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./ffmpeg.js";

/** How a stored file is referenced in D1 (media_ref, caption_ref, narration_ref); the web Worker resolves it. */
export const r2Ref = (key: string) => `r2:${key}`;

export interface MediaStore {
  /** Uploads a local file under key and checks it's there with the same size. Returns `r2:<key>`. */
  put(key: string, file: string, contentType: string): Promise<string>;
}

/** R2 through the processor Worker's /internal/media bridge, which holds the R2 binding; the container only has its bearer token. */
export class WorkerMedia implements MediaStore {
  constructor(private o: { url: string; token: string; fetchImpl?: typeof fetch }) {}
  async put(key: string, file: string, contentType: string) {
    const body = await readFile(file);
    const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url}?key=${encodeURIComponent(key)}`, {
      method: "PUT", headers: { authorization: `Bearer ${this.o.token}`, "content-type": contentType }, body, signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`R2 upload of ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    if ((await res.json() as { size?: number }).size !== body.length) throw new Error(`R2 has no complete copy of ${key} after upload`);
    return r2Ref(key);
  }
}

/**
 * Local development: writes into the web Worker's local R2 simulation with `wrangler r2 object put --local`,
 * the same store `npm run dev` in web/ serves /media/ from. MEDIA_LOCAL_WEB_DIR points at web/; set
 * MEDIA_LOCAL_PERSIST_TO when that dev server runs with --persist-to.
 */
export class WranglerLocalMedia implements MediaStore {
  constructor(private o: { webDir: string; bucket: string; persistTo?: string }) {}
  private wrangler(args: string[]) {
    const persist = this.o.persistTo ? ["--persist-to", this.o.persistTo] : [];
    return run(join(this.o.webDir, "node_modules", ".bin", "wrangler"), [...args, "--local", ...persist], { cwd: this.o.webDir, timeoutMs: 120_000 });
  }
  async put(key: string, file: string, contentType: string) {
    await this.wrangler(["r2", "object", "put", `${this.o.bucket}/${key}`, "--file", file, "--content-type", contentType]);
    const dir = await mkdtemp(join(tmpdir(), "resurface-verify-"));
    try {
      const copy = join(dir, "copy");
      await this.wrangler(["r2", "object", "get", `${this.o.bucket}/${key}`, "--file", copy]);
      if ((await stat(copy)).size !== (await stat(file)).size) throw new Error(`local R2 copy of ${key} doesn't match the upload`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return r2Ref(key);
  }
}

export function mediaFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStore | null {
  const bucket = env.R2_BUCKET ?? "resurface-media";
  if (env.MEDIA_LOCAL_WEB_DIR) return new WranglerLocalMedia({ webDir: env.MEDIA_LOCAL_WEB_DIR, bucket, persistTo: env.MEDIA_LOCAL_PERSIST_TO });
  if (env.D1_URL && env.D1_TOKEN) return new WorkerMedia({ url: new URL("/internal/media", env.D1_URL).href, token: env.D1_TOKEN });
  return null;
}
