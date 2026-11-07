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
  /**
   * Requests one account may send the Genius routes per minute, counted
   * before the cache. A song the Lyrics view hasn't seen costs a search, the
   * song and a page of referents per 50 annotated fragments (up to 20).
   * `GENIUS_LIMITER` in `wrangler.toml` holds the same number.
   */
  maxGeniusRequestsPerMinute: 30,
  /**
   * Requests one account may make Genius answer in a UTC day: only those the
   * cache doesn't answer count. Genius allows the Worker's token 10,000 a
   * day, shared by every account.
   */
  maxGeniusRequestsPerDay: 1_000,
  /**
   * Requests one account may send the Ticketmaster routes per minute, counted
   * before the cache. A show check starts its calls at least 250 ms apart, so
   * at most 240 a minute. `TICKETMASTER_LIMITER` in `wrangler.toml` holds the
   * same number.
   */
  maxTicketmasterRequestsPerMinute: 300,
  /**
   * Requests one account may make Ticketmaster answer in a UTC day: only
   * those the cache doesn't answer count. A shows-level follow costs an
   * attraction search once and an events call every 12 hours, so this fits
   * `maxFollows` of them. Ticketmaster allows the Worker's key 5,000 a day in
   * all, shared by every account.
   */
  maxTicketmasterRequestsPerDay: 15_000,
} as const;

export type SyncLimits = { readonly [K in keyof typeof SYNC_LIMITS]: number };

export type SyncLimitName = keyof SyncLimits;
