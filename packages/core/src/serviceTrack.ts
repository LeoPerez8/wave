/**
 * A song as a streaming service other than YouTube Music describes it
 * (Spotify's playlists and track pages, Deezer's API), and how reading one
 * from a service goes: what imports, shares and song links match against
 * YouTube Music and the Library.
 */

/** A song as a service lists it: in a playlist, on its track page or in its API. */
export interface ServiceTrack {
  readonly title: string;
  /** Every credited artist, in the service's order; none for a local file without one. */
  readonly artists: readonly string[];
  /** Its album, when the service gives it (Spotify's `fetchPlaylist` and Deezer do, Spotify's embed pages don't). */
  readonly album: string | null;
  readonly durationMs: number | null;
  /** Its album's cover, when the service gives one. */
  readonly artworkUrl?: string | null;
}

/**
 * Why a service's page wasn't read: the service has no such public track or
 * playlist, it couldn't be reached, or it answered with something else
 * (cancelled too).
 */
export type TrackReadFailure = "missing" | "unreachable" | "failed";

/** A track read from its service (Spotify's embed page, Deezer's API), or why it wasn't. */
export type TrackRead =
  | { readonly ok: true; readonly song: ServiceTrack }
  | { readonly ok: false; readonly reason: TrackReadFailure };
