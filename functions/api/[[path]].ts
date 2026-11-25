import { handleApi, type Env } from "../../src/api.ts";

/**
 * Pages Functions entry point for every /api/* route.
 *
 * The routing lives in handleApi, exactly as it does for the Worker in
 * src/index.ts, so both deployment targets share one implementation and one
 * set of tests. Pages serves ./public itself, so env.ASSETS is absent here.
 */
export const onRequest: PagesFunction<Env> = (ctx) =>
  handleApi(ctx.request, ctx.env, new URL(ctx.request.url));
