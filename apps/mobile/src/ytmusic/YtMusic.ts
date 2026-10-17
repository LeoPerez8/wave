import {
  readYtPlaylist,
  type YtArtistAlbum,
  type YtArtistCandidate,
  type YtLibraryFailure,
  type YtLibraryPlaylist,
  type YtPlaylistReadOptions,
  type YtQuietReason,
  type YtSession,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { IndexedArtwork } from "@/library/LibraryStore";
import { toIndexedArtwork } from "@/library/LibraryScan";
import type { NativeYtAlbum } from "@/native/waveYtDownloads";
import {
  WaveYtMusic,
  ytErrorCode,
  type NativeYtArtistPage,
  type NativeYtPlaylist,
  type NativeYtRadioPage,
  type NativeYtSearchPage,
  type NativeYtSong,
} from "@/native/waveYtMusic";

import { readYtAlbum } from "./albumPages";

/**
 * A YT Music request that didn't get an answer: no network, YouTube failed
 * or answered with something unreadable, or YT Music is off in Settings.
 */
export class YtMusicError extends Data.TaggedError("YtMusicError")<{
  readonly reason: YtQuietReason | "disabled";
}> {}

const fromNative = (error: unknown): YtMusicError => {
  const code = ytErrorCode(error);
  return new YtMusicError({
    reason:
      code === "ERR_YT_OFFLINE" ? "offline" : code === "ERR_YT_DISABLED" ? "disabled" : "failed",
  });
};

/**
 * The account's library wasn't read: YT Music's reasons, or no session
 * YouTube accepts (Core's `YtLibraryFailure`).
 */
export class YtLibraryError extends Data.TaggedError("YtLibraryError")<{
  readonly reason: YtLibraryFailure;
}> {}

const libraryFailure = (error: unknown): YtLibraryError =>
  new YtLibraryError({
    reason: ytErrorCode(error) === "ERR_YT_SIGNED_OUT" ? "signedOut" : fromNative(error).reason,
  });

/**
 * YouTube Music as a typed service, over the native `WaveYtMusic` module.
 * Search, playback (#109), downloads (#110), artist, album and playlist pages and
 * Home's Discover mixes go through it.
 * Playing itself is the native player's: it streams the queue's `yt:` items.
 */
export class YtMusic extends Context.Service<
  YtMusic,
  {
    /** Songs on YT Music for [query]. */
    readonly searchSongs: (query: string) => Effect.Effect<NativeYtSearchPage, YtMusicError>;
    /** Artists on YT Music named like [query]. */
    readonly searchArtists: (
      query: string,
    ) => Effect.Effect<readonly YtArtistCandidate[], YtMusicError>;
    /** Albums, singles and EPs on YT Music for [query]. */
    readonly searchAlbums: (query: string) => Effect.Effect<readonly YtArtistAlbum[], YtMusicError>;
    /** The artist page [browseId] (`UC…`): their top songs, albums, singles and songs playlist. */
    readonly artist: (browseId: string) => Effect.Effect<NativeYtArtistPage, YtMusicError>;
    /** The album page [browseId] (`MPREb_…`) and its tracklist. */
    readonly album: (browseId: string) => Effect.Effect<NativeYtAlbum, YtMusicError>;
    /**
     * The playlist [playlistId] and all its songs, page after page, up to
     * 5,000, or every one with `uncapped` (Core's `readYtPlaylist`); fails if
     * any page fails. `onPage` hears it grow, for a screen that shows each
     * page as it comes.
     */
    readonly playlist: (
      playlistId: string,
      options?: YtPlaylistReadOptions<NativeYtSong>,
    ) => Effect.Effect<NativeYtPlaylist, YtMusicError>;
    /**
     * The playlists in the signed-in account's library, in YouTube Music's
     * order. Fails as `signedOut` without a session YouTube accepts.
     */
    readonly libraryPlaylists: Effect.Effect<readonly YtLibraryPlaylist[], YtLibraryError>;
    /**
     * The first page of a radio: the song [videoId]'s, or the artist's whose
     * page is [browseId]. Needs no sign-in.
     */
    readonly radio: (
      seed: { readonly videoId: string } | { readonly browseId: string },
    ) => Effect.Effect<NativeYtRadioPage, YtMusicError>;
    /** The radio page a radio page's [continuation] leads to. */
    readonly radioMore: (continuation: string) => Effect.Effect<NativeYtRadioPage, YtMusicError>;
    /** Caches a song's cover from [url] beside the Library's artwork, with its palette. */
    readonly cacheArtwork: (url: string) => Effect.Effect<IndexedArtwork, YtMusicError>;
    /** The saved YouTube session (whose account, never its cookie), without asking YouTube. */
    readonly session: Effect.Effect<YtSession>;
    /** The session after asking YouTube whose it is; as it was when there's no answer. */
    readonly checkSession: Effect.Effect<YtSession>;
    /**
     * Opens Google's sign-in page: the signed-in session, or null when the
     * owner backs out. Every YT Music request goes out as the account after.
     */
    readonly signIn: Effect.Effect<YtSession | null, YtMusicError>;
    /** Forgets the session and the sign-in page's cookies; requests go out signed out. */
    readonly signOut: Effect.Effect<YtSession>;
  }
>()("@wave/mobile/ytmusic/YtMusic") {}

// Reading, checking or forgetting the session doesn't fail (no answer leaves it
// as it was), so a rejection there is a defect.
export const layer = Layer.succeed(YtMusic, {
  searchSongs: (query) =>
    Effect.tryPromise({ try: () => WaveYtMusic.searchSongs(query), catch: fromNative }),
  searchArtists: (query) =>
    Effect.tryPromise({ try: () => WaveYtMusic.searchArtists(query), catch: fromNative }),
  searchAlbums: (query) =>
    Effect.tryPromise({ try: () => WaveYtMusic.searchAlbums(query), catch: fromNative }),
  artist: (browseId) =>
    Effect.tryPromise({ try: () => WaveYtMusic.artist(browseId), catch: fromNative }),
  // Album pages are read by the downloads module (a download's tags come from them), once a session.
  album: (browseId) => Effect.tryPromise({ try: () => readYtAlbum(browseId), catch: fromNative }),
  playlist: (playlistId, options = {}) =>
    Effect.tryPromise({
      try: (signal) =>
        readYtPlaylist(
          () => WaveYtMusic.playlist(playlistId),
          (continuation) => WaveYtMusic.playlistMore(continuation),
          { ...options, signal: options.signal ?? signal },
        ),
      catch: fromNative,
    }),
  libraryPlaylists: Effect.tryPromise({
    try: () => WaveYtMusic.libraryPlaylists(),
    catch: libraryFailure,
  }),
  radio: (seed) =>
    Effect.tryPromise({
      try: () =>
        "videoId" in seed
          ? WaveYtMusic.songRadio(seed.videoId)
          : WaveYtMusic.artistRadio(seed.browseId),
      catch: fromNative,
    }),
  radioMore: (continuation) =>
    Effect.tryPromise({ try: () => WaveYtMusic.radioMore(continuation), catch: fromNative }),
  cacheArtwork: (url) =>
    Effect.tryPromise({ try: () => WaveYtMusic.cacheArtwork(url), catch: fromNative }).pipe(
      Effect.map(toIndexedArtwork),
    ),
  session: Effect.promise(() => WaveYtMusic.session()),
  checkSession: Effect.promise(() => WaveYtMusic.checkSession()),
  signIn: Effect.tryPromise({ try: () => WaveYtMusic.signIn(), catch: fromNative }),
  signOut: Effect.promise(() => WaveYtMusic.signOut()),
});
