/**
 * The Cloudflare Worker: builds the sync service from the Worker's secrets
 * and vars (see README.md), never from the repo.
 */

import { createClient } from "@libsql/client/web";
import { googleKeys } from "./google.ts";
import type { Upstream } from "./proxy.ts";
import {
  type ProviderAccess,
  type RateLimiter,
  createSyncService,
  serviceMemory,
} from "./service.ts";

export interface Env {
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  /** Wave's web OAuth client id, which ID tokens' audience must be. */
  readonly GOOGLE_CLIENT_ID?: string;
  /** Emails that may sign in, separated by commas. Unset lets any Google account in. */
  readonly ALLOWED_EMAILS?: string;
  /**
   * Base64 of the 32-byte AES-GCM keys the Soulseek accounts' passwords are kept under:
   * `SOULSEEK_KEY` is version 1, `SOULSEEK_KEY_<n>` version n, and the highest is current.
   */
  readonly SOULSEEK_KEY?: string;
  readonly [soulseekKey: `SOULSEEK_KEY_${string}`]: string | undefined;
  /** Genius's client access token, which only the Worker holds (the Genius routes). */
  readonly GENIUS_ACCESS_TOKEN?: string;
  /** Ticketmaster Discovery's API key, which only the Worker holds (the Ticketmaster routes). */
  readonly TICKETMASTER_API_KEY?: string;
  /** The `[[ratelimits]]` bindings in `wrangler.toml`. */
  readonly ADDRESS_LIMITER?: RateLimiter;
  readonly FAILED_LOOKUP_LIMITER?: RateLimiter;
  readonly GENIUS_LIMITER?: RateLimiter;
  readonly TICKETMASTER_LIMITER?: RateLimiter;
}

/** The Worker's Soulseek keys, by secret name. */
const soulseekKeys = (env: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        (entry[0] === "SOULSEEK_KEY" || entry[0].startsWith("SOULSEEK_KEY_")) &&
        typeof entry[1] === "string",
    ),
  );

// Kept for the isolate's life, so a sign-in doesn't fetch Google's keys each time.
const keys = googleKeys((input, init) => fetch(input, init), Date.now);
// Kept for the isolate's life too: the addresses held back and the refusal counts.
const memory = serviceMemory();

/** Cloudflare's cache for this Worker (`caches.default`, which the DOM's types don't know). */
const cloudflareCache = (): Cache =>
  (globalThis as unknown as { readonly caches: { readonly default: Cache } }).caches.default;

/** The providers' requests go out with the Worker's `fetch`, their answers into Cloudflare's cache. */
const upstream: Upstream = {
  fetch: (url, init) => fetch(url, init),
  cache: {
    match: (key) => cloudflareCache().match(key),
    put: (key, response) => cloudflareCache().put(key, response),
  },
};

/** A provider, when the Worker has its secret and its limiter; its routes answer 503 otherwise. */
const provider = (
  secret: string | undefined,
  limiter: RateLimiter | undefined,
): ProviderAccess | undefined => {
  const token = secret?.trim();
  if (token === undefined || token === "" || limiter === undefined) return undefined;
  return { token, limiter };
};

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
    const geniusAccess = provider(env.GENIUS_ACCESS_TOKEN, env.GENIUS_LIMITER);
    const ticketmasterAccess = provider(env.TICKETMASTER_API_KEY, env.TICKETMASTER_LIMITER);
    const service = createSyncService({
      db: createClient({ url, ...(authToken === undefined ? {} : { authToken }) }),
      addressLimiter,
      failedLookupLimiter,
      googleClientId: GOOGLE_CLIENT_ID,
      googleKeys: keys,
      memory,
      upstream,
      ...(geniusAccess === undefined ? {} : { genius: geniusAccess }),
      ...(ticketmasterAccess === undefined ? {} : { ticketmaster: ticketmasterAccess }),
      ...(env.ALLOWED_EMAILS === undefined ? {} : { allowedEmails: env.ALLOWED_EMAILS }),
      soulseekKeys: soulseekKeys(env),
    });
    return service(request);
  },
};
