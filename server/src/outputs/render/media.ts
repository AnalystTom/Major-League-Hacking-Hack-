// Where rendered files go: the R2 bucket the web Worker serves /media/ from. Every upload is read back before
// the processor stores its reference, so a video result never points at a missing file.

import { AwsClient } from "aws4fetch";
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

/** R2 through its S3 API: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET. */
export class R2Media implements MediaStore {
  private client: AwsClient;
  constructor(private o: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; fetchImpl?: typeof fetch }) {
    this.client = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, service: "s3", region: "auto" });
  }
  async put(key: string, file: string, contentType: string) {
    const url = `https://${this.o.accountId}.r2.cloudflarestorage.com/${this.o.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const body = await readFile(file);
    const signed = (init: RequestInit) => this.client.sign(url, init).then((req) => (this.o.fetchImpl ?? fetch)(req));
    const put = await signed({ method: "PUT", body, headers: { "content-type": contentType } });
    if (!put.ok) throw new Error(`R2 upload of ${key} failed: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`);
    const head = await signed({ method: "HEAD" });
    if (!head.ok || Number(head.headers.get("content-length")) !== body.length) throw new Error(`R2 has no complete copy of ${key} after upload`);
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
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return new R2Media({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket });
  }
  if (env.MEDIA_LOCAL_WEB_DIR) return new WranglerLocalMedia({ webDir: env.MEDIA_LOCAL_WEB_DIR, bucket, persistTo: env.MEDIA_LOCAL_PERSIST_TO });
  return null;
}
