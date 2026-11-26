import { handleApi, json, type Env } from "./api.ts";
import { ensureSchema } from "./db.ts";
import { importStep } from "./import/eu.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "Method not allowed" }, 405);
    return env.ASSETS!.fetch(req);
  },

  /**
   * Fills in the EU rules a few windows at a time. The endpoint that did this
   * is closed to writes, and a cron run needs no token to expose.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      await importStep(env.DB);
    })());
  },
} satisfies ExportedHandler<Env>;
