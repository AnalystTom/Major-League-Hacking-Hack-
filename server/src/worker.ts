// Cloudflare Workers entry point: `npm run deploy` publishes this.

import { createApp, parseOrigins } from "./app.js";

type Env = { WEB_ORIGINS?: string };

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    app ??= createApp({ webOrigins: parseOrigins(env.WEB_ORIGINS) });
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
