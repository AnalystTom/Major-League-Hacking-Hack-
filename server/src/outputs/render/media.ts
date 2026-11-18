import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./ffmpeg.js";
import { recordError } from "../../activity.js";

export const r2Ref = (key: string) => `r2:${key}`;

export interface MediaStore {
  put(key: string, file: string, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export async function discardMedia(media: MediaStore, refs: string[]) {
  await Promise.all(refs.map(async (ref) => {
    try {
      await media.delete(ref.slice("r2:".length));
    } catch (e) {
      recordError(`couldn't remove ${ref}`, e);
    }
  }));
}

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
  async delete(key: string) {
    const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url}?key=${encodeURIComponent(key)}`, {
      method: "DELETE", headers: { authorization: `Bearer ${this.o.token}` }, signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`R2 delete of ${key} failed: HTTP ${res.status}`);
  }
}

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
  async delete(key: string) {
    await this.wrangler(["r2", "object", "delete", `${this.o.bucket}/${key}`]);
  }
}

export function mediaFromEnv(env: NodeJS.ProcessEnv = process.env): MediaStore | null {
  const bucket = env.R2_BUCKET ?? "resurface-media";
  if (env.MEDIA_LOCAL_WEB_DIR) return new WranglerLocalMedia({ webDir: env.MEDIA_LOCAL_WEB_DIR, bucket, persistTo: env.MEDIA_LOCAL_PERSIST_TO });
  if (env.D1_URL && env.MEDIA_TOKEN) return new WorkerMedia({ url: new URL("/internal/media", env.D1_URL).href, token: env.MEDIA_TOKEN });
  return null;
}
