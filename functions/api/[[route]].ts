import type { Env } from '../../worker/env';
import { handleApi } from '../../worker/router';

/**
 * Everything under /api/ lands here. Cloudflare Pages requires the entry point
 * to live in `functions/`, so this file stays a one-liner and the API itself
 * lives in `worker/` where it can be read as ordinary modules.
 */
export const onRequest: PagesFunction<Env> = (context) =>
  handleApi(context.request, context.env);
