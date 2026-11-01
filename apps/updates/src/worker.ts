/** The Cloudflare Worker: the update service over the R2 bucket bound in wrangler.toml. */

import { type UpdateStorage, createUpdateService } from "./service.ts";

export interface Env {
  readonly UPDATES: UpdateStorage;
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> =>
    createUpdateService(env.UPDATES).fetch(request),
};
