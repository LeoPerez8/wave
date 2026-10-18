import type { SpotifySession } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/**
 * The codes a Spotify request rejects with: no network, Spotify failed or
 * answered something unreadable, no session Spotify accepts, or Spotify
 * changed its web player so Wave needs an update.
 */
export type SpotifyErrorCode =
  "ERR_SPOTIFY_OFFLINE" | "ERR_SPOTIFY_FAILED" | "ERR_SPOTIFY_SIGNED_OUT" | "ERR_SPOTIFY_CHANGED";

/**
 * The Spotify account's native module (`modules/wave-native`, package
 * `spotify`). It keeps the session (the `sp_dc` cookie, in no-backup storage)
 * and the tokens it buys natively; JS only learns whose account it is. The
 * app asks it through the `Spotify` service (`spotify/Spotify.ts`).
 */
declare class WaveSpotifyModule extends NativeModule<{
  /** The session changed natively: Spotify stopped accepting it during a request, say. */
  onSessionChanged: (session: SpotifySession) => void;
}> {
  /** The saved session, without asking Spotify. */
  session(): Promise<SpotifySession>;
  /** The session after asking Spotify whose it is; as it was when there's no answer. */
  checkSession(): Promise<SpotifySession>;
  /**
   * Opens Spotify's sign-in page over Wave. Resolves the signed-in session, or
   * null when the owner backs out; rejects with an `ERR_SPOTIFY_*` code when
   * Spotify doesn't confirm the account.
   */
  signIn(): Promise<SpotifySession | null>;
  /** Forgets the session and clears the sign-in web view's cookies and storage. */
  signOut(): Promise<SpotifySession>;
  /**
   * A page of the account's library (`libraryV3`: playlists, folders
   * flattened, Liked Songs) from [offset], as the query's `data` in JSON
   * (Core's `readSpotifyLibrary` reads it).
   */
  library(offset: number): Promise<string>;
  /** A page of Liked Songs (`fetchLibraryTracks`, 50 a page) from [offset], as the query's `data` in JSON. */
  likedSongs(offset: number): Promise<string>;
  /**
   * A page of the playlist [uri] (`spotify:playlist:<id>`; `fetchPlaylist`,
   * 500 a page) from [offset], as the account reads it, as the query's
   * `data` in JSON.
   */
  playlist(uri: string, offset: number): Promise<string>;

  // Sharing a playlist (docs/spec.md, "Sharing playlists"). It reads the
  // playlist and the library back with `playlist` and `library` above; a
  // search resolves its GraphQL `data` as JSON, for Core to read (`spotifyShare.ts`).

  /** A `searchTracks` for [term]. */
  searchTracks(term: string): Promise<string>;
  /** Makes a public playlist [name] in the account's library, anyone with its link can open: its URI. */
  createPlaylist(name: string): Promise<string>;
  /** Shows the playlist [uri] on the profile and lets anyone with its link open it. */
  makePlaylistPublic(uri: string): Promise<void>;
  renamePlaylist(uri: string, name: string): Promise<void>;
  /** Adds [trackUris] at the end of the playlist [uri], in order. */
  addToPlaylist(uri: string, trackUris: readonly string[]): Promise<void>;
  /** Takes the entries [uids] out of the playlist [uri]. */
  removeFromPlaylist(uri: string, uids: readonly string[]): Promise<void>;
  /** Moves the entry [uid] right before the entry [before], or to the end for null. */
  movePlaylistEntry(uri: string, uid: string, before: string | null): Promise<void>;
}

export const WaveSpotify = requireNativeModule<WaveSpotifyModule>("WaveSpotify");

/** The reason a Spotify request failed, from its rejection (the `Spotify` service's `SpotifyError`). */
export const spotifyErrorCode = (error: unknown): SpotifyErrorCode => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_SPOTIFY_OFFLINE" ||
    code === "ERR_SPOTIFY_SIGNED_OUT" ||
    code === "ERR_SPOTIFY_CHANGED"
    ? code
    : "ERR_SPOTIFY_FAILED";
};
