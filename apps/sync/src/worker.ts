/**
 * The Cloudflare Worker: builds the sync service from the Worker's secrets
 * and vars (see README.md), never from the repo.
 */

import { createClient } from "@libsql/client/web";
import { googleKeys } from "./google.ts";
import { type RateLimiter, createSyncService, serviceMemory } from "./service.ts";

export interface Env {
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  /** Wave's web OAuth client id, which ID tokens' audience must be. */
  readonly GOOGLE_CLIENT_ID?: string;
  /** Emails that may sign in, separated by commas. Unset lets any Google account in. */
  readonly ALLOWED_EMAILS?: string;
  /** Base64 of the 32-byte AES-GCM key the Soulseek accounts' passwords are kept under. */
  readonly SOULSEEK_KEY?: string;
  /** The `[[ratelimits]]` bindings in `wrangler.toml`. */
  readonly ADDRESS_LIMITER?: RateLimiter;
  readonly FAILED_LOOKUP_LIMITER?: RateLimiter;
}

// Kept for the isolate's life, so a sign-in doesn't fetch Google's keys each time.
const keys = googleKeys((input, init) => fetch(input, init), Date.now);
// Kept for the isolate's life too: the addresses held back and the refusal counts.
const memory = serviceMemory();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken, GOOGLE_CLIENT_ID } = env;
    if (url === undefined || GOOGLE_CLIENT_ID === undefined) {
      console.error("sync service: TURSO_DATABASE_URL or GOOGLE_CLIENT_ID isn't set");
      return Response.json({ error: "internal" }, { status: 500 });
    }
    const { ADDRESS_LIMITER: addressLimiter, FAILED_LOOKUP_LIMITER: failedLookupLimiter } = env;
    if (addressLimiter === undefined || failedLookupLimiter === undefined) {
      console.error("sync service: the ratelimits bindings in wrangler.toml are missing");
      return Response.json({ error: "internal" }, { status: 500 });
    }
    const service = createSyncService({
      db: createClient({ url, ...(authToken === undefined ? {} : { authToken }) }),
      addressLimiter,
      failedLookupLimiter,
      googleClientId: GOOGLE_CLIENT_ID,
      googleKeys: keys,
      memory,
      ...(env.ALLOWED_EMAILS === undefined ? {} : { allowedEmails: env.ALLOWED_EMAILS }),
      ...(env.SOULSEEK_KEY === undefined ? {} : { soulseekKey: env.SOULSEEK_KEY }),
    });
    return service(request);
  },
};
