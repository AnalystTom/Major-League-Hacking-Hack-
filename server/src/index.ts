// Node entry point: `npm run dev` locally, or `npm run build && npm start` on any Node host.

import { serve } from "@hono/node-server";
import { createApp, parseOrigins } from "./app.js";

const app = createApp({ webOrigins: parseOrigins(process.env.WEB_ORIGINS) });
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Resurface API on http://localhost:${info.port}`);
});
