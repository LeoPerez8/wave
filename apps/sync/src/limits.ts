/**
 * What one Wave account may hold and send (docs/spec.md, "Wave account and
 * sync": anyone with a Google account can sign in, so each account is
 * limited instead). Going past one answers 413 (429 for a rate, 403 for
 * `maxAccounts`) with `{ "error": "limit", "limit": "<name>" }`.
 *
 * Starting values, chosen so a 50,000-song Library with 200,000 plays fits
 * with room to grow. Row counts leave tombstones out.
 */
export const SYNC_LIMITS = {
  /** The largest request body, in bytes. A first push of a large history goes in batches under it. */
  maxBodyBytes: 2 * 1024 * 1024,
  maxSongs: 100_000,
  maxPlaylists: 5_000,
  maxPlaylistEntries: 250_000,
  maxFavorites: 100_000,
  maxPreferences: 200,
  maxPlays: 1_000_000,
  maxFollows: 5_000,
  maxHiddenReleases: 50_000,
  maxNotifiedShows: 50_000,
  maxDismissedSuggestions: 50_000,
  /** Requests one session may make per minute. */
  maxRequestsPerMinute: 120,
  /**
   * `POST /v1/session` attempts per minute from one address (before the ID
   * token is checked), and sign-ins per minute to one Google account.
   */
  maxSignInsPerMinute: 10,
  /**
   * Requests per minute from one address to any route, counted before the
   * database. Sized for a carrier that puts many phones behind one address.
   * `ADDRESS_LIMITER` in `wrangler.toml` holds the same number.
   */
  maxRequestsPerAddressPerMinute: 600,
  /**
   * Failed session lookups per minute from one address. Past it, the address
   * runs no session lookup for `failedLookupBlockSeconds`.
   * `FAILED_LOOKUP_LIMITER` in `wrangler.toml` holds the same number.
   */
  maxFailedLookupsPerAddressPerMinute: 20,
  failedLookupBlockSeconds: 300,
  /**
   * Wave accounts the service holds, and new ones it makes in any 24 hours.
   * Checked only when a sign-in would make an account: existing accounts
   * always sign in.
   */
  maxAccounts: 100,
  maxNewAccountsPerDay: 10,
} as const;

export type SyncLimits = { readonly [K in keyof typeof SYNC_LIMITS]: number };

export type SyncLimitName = keyof SyncLimits;

/**
 * Where the hourly usage watch (src/usage.ts) warns, set below the free plans' limits so the
 * owner hears before a limit stops the sync. Each warns at most once a period.
 */
export const USAGE_WARNINGS = {
  /** Requests to every Worker on the account since midnight UTC. Workers Free stops at 100,000. */
  workerRequestsPerDay: 70_000,
  /** Turso rows read this billing cycle, 50% of the Free plan's 500 million. */
  tursoRowsReadPerMonth: 250_000_000,
  /** Turso rows written this billing cycle, 50% of the Free plan's 10 million. */
  tursoRowsWrittenPerMonth: 5_000_000,
  /** Turso storage in bytes, 50% of the Free plan's 5 GB. */
  tursoStorageBytes: 2_500_000_000,
} as const;

export type UsageWarnings = { readonly [K in keyof typeof USAGE_WARNINGS]: number };
