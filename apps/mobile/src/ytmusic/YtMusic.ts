import type {
  YtArtistAlbum,
  YtArtistCandidate,
  YtHome,
  YtQuietReason,
  YtSession,
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
 * YouTube Music as a typed service, over the native `WaveYtMusic` module.
 * Search, playback (#109), downloads (#110) and Discover (#111) go through it.
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
    /** The artist page [browseId] (`UC…`): their top songs, albums and singles. */
    readonly artist: (browseId: string) => Effect.Effect<NativeYtArtistPage, YtMusicError>;
    /** The account's recommendations: YouTube Music's home shelves. */
    readonly home: Effect.Effect<YtHome<NativeYtSong>, YtMusicError>;
    /** The album page [browseId] (`MPREb_…`) and its tracklist. */
    readonly album: (browseId: string) => Effect.Effect<NativeYtAlbum, YtMusicError>;
    /** The playlist [playlistId] and all its songs, up to 5,000; fails if any page fails. */
    readonly playlist: (playlistId: string) => Effect.Effect<NativeYtPlaylist, YtMusicError>;
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
  home: Effect.tryPromise({ try: () => WaveYtMusic.home(), catch: fromNative }).pipe(
    Effect.map((shelves) => ({ shelves })),
  ),
  // Album pages are read by the downloads module (a download's tags come from them), once a session.
  album: (browseId) => Effect.tryPromise({ try: () => readYtAlbum(browseId), catch: fromNative }),
  playlist: (playlistId) =>
    Effect.tryPromise({ try: () => WaveYtMusic.playlist(playlistId), catch: fromNative }),
  cacheArtwork: (url) =>
    Effect.tryPromise({ try: () => WaveYtMusic.cacheArtwork(url), catch: fromNative }).pipe(
      Effect.map(toIndexedArtwork),
    ),
  session: Effect.promise(() => WaveYtMusic.session()),
  checkSession: Effect.promise(() => WaveYtMusic.checkSession()),
  signIn: Effect.tryPromise({ try: () => WaveYtMusic.signIn(), catch: fromNative }),
  signOut: Effect.promise(() => WaveYtMusic.signOut()),
});
