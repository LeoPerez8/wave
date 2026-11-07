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
