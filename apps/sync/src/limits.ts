/**
 * What one Wave account may hold and send (docs/spec.md, "Wave account and
 * sync": anyone with a Google account can sign in, so each account is
 * limited instead). Going past one answers 413 (or 429 for the rate) with
 * `{ "error": "limit", "limit": "<name>" }`.
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
  /** Requests one session may make per minute. */
  maxRequestsPerMinute: 120,
  /**
   * `POST /v1/session` attempts per minute from one address (before the ID
   * token is checked), and sign-ins per minute to one Google account.
   */
  maxSignInsPerMinute: 10,
} as const;

export type SyncLimits = { readonly [K in keyof typeof SYNC_LIMITS]: number };

export type SyncLimitName = keyof SyncLimits;
