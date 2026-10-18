import type { SpotifyAccountFailure, SpotifySession, SpotifySignInFailure } from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WaveSpotify, spotifyErrorCode, type SpotifyErrorCode } from "@/native/waveSpotify";

/**
 * A Spotify request that didn't get an answer: no network, Spotify failed or
 * answered something unreadable, no session Spotify accepts, or Spotify
 * changed its web player so Wave needs an update (Core's `SpotifyAccountFailure`).
 */
export class SpotifyError extends Data.TaggedError("SpotifyError")<{
  readonly reason: SpotifyAccountFailure;
}> {
  /** Why a sign-in that failed so didn't work: Spotify not taking the session is its not confirming it. */
  get signInFailure(): SpotifySignInFailure {
    return this.reason === "signedOut" ? "failed" : this.reason;
  }
}

const REASONS: Record<SpotifyErrorCode, SpotifyAccountFailure> = {
  ERR_SPOTIFY_OFFLINE: "offline",
  ERR_SPOTIFY_FAILED: "failed",
  ERR_SPOTIFY_SIGNED_OUT: "signedOut",
  ERR_SPOTIFY_CHANGED: "changed",
};

const fromNative = (error: unknown): SpotifyError =>
  new SpotifyError({ reason: REASONS[spotifyErrorCode(error)] });

const request = <A>(send: () => Promise<A>): Effect.Effect<A, SpotifyError> =>
  Effect.tryPromise({ try: send, catch: fromNative });

/** The `data` a query resolved as JSON, parsed; an answer that isn't JSON fails. */
const data = (query: () => Promise<string>): Effect.Effect<unknown, SpotifyError> =>
  request(query).pipe(
    Effect.flatMap((json) =>
      Effect.try({
        try: (): unknown => JSON.parse(json),
        catch: () => new SpotifyError({ reason: "failed" }),
      }),
    ),
  );

/**
 * The signed-in Spotify account as a typed service, over the native
 * `WaveSpotify` module (which keeps the session and its tokens): Settings ›
 * Accounts, From Spotify and sharing a playlist on Spotify go through it.
 * Reads give the query's `data` for Core to read (`readSpotifyLibrary`,
 * `readSpotifyAccountPlaylist`, `spotifyShareMatch`, …).
 */
export class Spotify extends Context.Service<
  Spotify,
  {
    /** The saved session, without asking Spotify. */
    readonly session: Effect.Effect<SpotifySession, SpotifyError>;
    /** The session after asking Spotify whose it is; as it was when there's no answer. */
    readonly checkSession: Effect.Effect<SpotifySession, SpotifyError>;
    /** Opens Spotify's sign-in page: the signed-in session, or null when the owner backs out. */
    readonly signIn: Effect.Effect<SpotifySession | null, SpotifyError>;
    /** Forgets the session and the sign-in page's cookies and storage. */
    readonly signOut: Effect.Effect<SpotifySession, SpotifyError>;
    /** A `libraryV3` page of the account's library (playlists, Liked Songs) from [offset]. */
    readonly library: (offset: number) => Effect.Effect<unknown, SpotifyError>;
    /** A `fetchLibraryTracks` page of Liked Songs from [offset]. */
    readonly likedSongs: (offset: number) => Effect.Effect<unknown, SpotifyError>;
    /** A `fetchPlaylist` page of the playlist [uri] from [offset], as the account reads it. */
    readonly playlist: (uri: string, offset: number) => Effect.Effect<unknown, SpotifyError>;
    /** A `searchTracks` answer for [term]. */
    readonly searchTracks: (term: string) => Effect.Effect<unknown, SpotifyError>;
    /** Makes a public playlist [name] in the account's library: its URI. */
    readonly createPlaylist: (name: string) => Effect.Effect<string, SpotifyError>;
    /** Shows the playlist [uri] on the profile and lets anyone with its link open it. */
    readonly makePlaylistPublic: (uri: string) => Effect.Effect<void, SpotifyError>;
    readonly renamePlaylist: (uri: string, name: string) => Effect.Effect<void, SpotifyError>;
    /** Adds [trackUris] at the end of the playlist [uri], in order. */
    readonly addToPlaylist: (
      uri: string,
      trackUris: readonly string[],
    ) => Effect.Effect<void, SpotifyError>;
    /** Takes the entries [uids] out of the playlist [uri]. */
    readonly removeFromPlaylist: (
      uri: string,
      uids: readonly string[],
    ) => Effect.Effect<void, SpotifyError>;
    /** Moves the entry [uid] right before the entry [before], or to the end for null. */
    readonly movePlaylistEntry: (
      uri: string,
      uid: string,
      before: string | null,
    ) => Effect.Effect<void, SpotifyError>;
  }
>()("@wave/mobile/spotify/Spotify") {}

export const layer = Layer.succeed(Spotify, {
  session: request(() => WaveSpotify.session()),
  checkSession: request(() => WaveSpotify.checkSession()),
  signIn: request(() => WaveSpotify.signIn()),
  signOut: request(() => WaveSpotify.signOut()),
  library: (offset) => data(() => WaveSpotify.library(offset)),
  likedSongs: (offset) => data(() => WaveSpotify.likedSongs(offset)),
  playlist: (uri, offset) => data(() => WaveSpotify.playlist(uri, offset)),
  searchTracks: (term) => data(() => WaveSpotify.searchTracks(term)),
  createPlaylist: (name) => request(() => WaveSpotify.createPlaylist(name)),
  makePlaylistPublic: (uri) => request(() => WaveSpotify.makePlaylistPublic(uri)),
  renamePlaylist: (uri, name) => request(() => WaveSpotify.renamePlaylist(uri, name)),
  addToPlaylist: (uri, trackUris) => request(() => WaveSpotify.addToPlaylist(uri, trackUris)),
  removeFromPlaylist: (uri, uids) => request(() => WaveSpotify.removeFromPlaylist(uri, uids)),
  movePlaylistEntry: (uri, uid, before) =>
    request(() => WaveSpotify.movePlaylistEntry(uri, uid, before)),
});
