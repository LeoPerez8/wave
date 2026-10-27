import type { SpotifyAccountFailure } from "@wave/core";
import * as Effect from "effect/Effect";

import { WaveSpotify, spotifyErrorCode, type SpotifyErrorCode } from "@/native/waveSpotify";

import type { Spotify } from "./Spotify";
import { SpotifyError } from "./SpotifyError";

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

/** The account over the native `WaveSpotify` module (`Spotify`'s layer builds it on first use). */
export const makeSpotify = (): Spotify["Service"] => ({
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
