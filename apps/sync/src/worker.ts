/**
 * The Cloudflare Worker: builds the sync service from the Worker's secrets
 * and vars (see README.md), never from the repo.
 */

import { createClient } from "@libsql/client/web";
import { googleKeys } from "./google.ts";
import { createSyncService } from "./service.ts";

export interface Env {
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  /** Wave's web OAuth client id, which ID tokens' audience must be. */
  readonly GOOGLE_CLIENT_ID?: string;
  /** Emails that may sign in, separated by commas. Unset lets any Google account in. */
  readonly ALLOWED_EMAILS?: string;
}

// Kept for the isolate's life, so a sign-in doesn't fetch Google's keys each time.
const keys = googleKeys((input, init) => fetch(input, init), Date.now);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken, GOOGLE_CLIENT_ID } = env;
    if (url === undefined || GOOGLE_CLIENT_ID === undefined) {
      console.error("sync service: TURSO_DATABASE_URL or GOOGLE_CLIENT_ID isn't set");
      return Response.json({ error: "internal" }, { status: 500 });
    }
    const service = createSyncService({
      db: createClient({ url, ...(authToken === undefined ? {} : { authToken }) }),
      googleClientId: GOOGLE_CLIENT_ID,
      googleKeys: keys,
      ...(env.ALLOWED_EMAILS === undefined ? {} : { allowedEmails: env.ALLOWED_EMAILS }),
    });
    return service(request);
  },
};
