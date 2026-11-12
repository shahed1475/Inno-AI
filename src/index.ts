import { handleApi, json, type Env } from "./api.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "Method not allowed" }, 405);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
