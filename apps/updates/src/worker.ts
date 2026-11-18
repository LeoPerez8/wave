/**
 * The Cloudflare Worker: the update service over the R2 bucket bound in wrangler.toml, counting
 * each address's answers in the `RequestCounts` Durable Object declared beside it.
 */

import { type CountNamespace, RequestCounts, durableCounter } from "./limits.ts";
import { type UpdateStorage, createUpdateService } from "./service.ts";

export interface Env {
  readonly UPDATES: UpdateStorage;
  readonly REQUEST_COUNTS: CountNamespace;
  readonly UPDATE_PASS_PUBLIC_KEYS?: string;
  readonly REQUIRE_UPDATE_PASS?: string;
}

// One per isolate, so the refusals it remembers carry from one request to the next.
let service: ReturnType<typeof createUpdateService> | undefined;

export default {
  fetch: (request: Request, env: Env): Promise<Response> => {
    service ??= createUpdateService(env.UPDATES, {
      counter: durableCounter(env.REQUEST_COUNTS),
      ...(env.UPDATE_PASS_PUBLIC_KEYS === undefined
        ? {}
        : { updatePassPublicKeys: env.UPDATE_PASS_PUBLIC_KEYS }),
      requireUpdatePass: env.REQUIRE_UPDATE_PASS === "true",
    });
    return service.fetch(request);
  },
};

export { RequestCounts };
