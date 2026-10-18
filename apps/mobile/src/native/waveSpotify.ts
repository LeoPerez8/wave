import type {
  SpotifyAccountAnswer,
  SpotifyAccountFailure,
  SpotifySession,
  SpotifySignInFailure,
} from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/**
 * The codes a Spotify request rejects with: no network, Spotify failed or
 * answered something unreadable, no session Spotify accepts, or Spotify
 * changed its web player so Wave needs an update.
 */
export type SpotifyErrorCode =
  | "ERR_SPOTIFY_OFFLINE"
  | "ERR_SPOTIFY_FAILED"
  | "ERR_SPOTIFY_SIGNED_OUT"
  | "ERR_SPOTIFY_CHANGED";

/**
 * The Spotify account's native module (`modules/wave-native`, package
 * `spotify`). It keeps the session (the `sp_dc` cookie, in no-backup storage)
 * and the tokens it buys natively; JS only learns whose account it is.
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
}

export const WaveSpotify = requireNativeModule<WaveSpotifyModule>("WaveSpotify");

/** The reason a Spotify request failed, from its rejection. */
export const spotifyErrorCode = (error: unknown): SpotifyErrorCode => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_SPOTIFY_OFFLINE" ||
    code === "ERR_SPOTIFY_SIGNED_OUT" ||
    code === "ERR_SPOTIFY_CHANGED"
    ? code
    : "ERR_SPOTIFY_FAILED";
};

/** Why a query as the account didn't answer, as Core's library reads take it. */
const ACCOUNT_FAILURES: Record<SpotifyErrorCode, SpotifyAccountFailure> = {
  ERR_SPOTIFY_OFFLINE: "offline",
  ERR_SPOTIFY_FAILED: "failed",
  ERR_SPOTIFY_SIGNED_OUT: "signedOut",
  ERR_SPOTIFY_CHANGED: "changed",
};

/** [query]'s `data`, read from its JSON, or why it didn't answer (Core's `SpotifyAccountAnswer`). */
export const askSpotifyAccount = async (
  query: () => Promise<string>,
): Promise<SpotifyAccountAnswer> => {
  let json: string;
  try {
    json = await query();
  } catch (error) {
    return { ok: false, reason: ACCOUNT_FAILURES[spotifyErrorCode(error)] };
  }
  try {
    return { ok: true, data: JSON.parse(json) as unknown };
  } catch {
    return { ok: false, reason: "failed" };
  }
};

/** Why a sign-in didn't work, as Settings says it. */
export const spotifySignInFailure = (error: unknown): SpotifySignInFailure => {
  switch (spotifyErrorCode(error)) {
    case "ERR_SPOTIFY_OFFLINE":
      return "offline";
    case "ERR_SPOTIFY_CHANGED":
      return "changed";
    default:
      return "failed";
  }
};
