import { parseTrackId, type MagicSeed, type QueueContinuationSeed, type YtSong } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, LibraryStoreError, SongRow } from "../library/LibraryStore.ts";
import { queuedYtSong, type QueueTrack } from "./queueTracks.ts";

interface ContinuationInput {
  readonly seed: MagicSeed;
  readonly songs: readonly SongRow[];
  readonly streamed: readonly YtSong[];
}

/** Reads only the original list, or the last song; queue context survives a restart. */
export const readQueueContinuationSeed = (
  source: QueueContinuationSeed,
  store: Pick<LibraryStore["Service"], "getAlbum" | "getArtist" | "getPlaylist" | "songsByIds">,
  tracks: ReadonlyMap<string, QueueTrack>,
): Effect.Effect<ContinuationInput | null, LibraryStoreError> =>
  Effect.gen(function* () {
    const id = Number(source.id);
    if (source.kind === "album") {
      const album = yield* store.getAlbum(id);
      return album === null
        ? null
        : {
            seed: { ...source, title: album.album.title },
            songs: album.tracks,
            streamed: [],
          };
    }
    if (source.kind === "artist") {
      const artist = yield* store.getArtist(id);
      return artist === null
        ? null
        : {
            seed: { ...source, title: artist.artist.name },
            songs: artist.songs,
            streamed: [],
          };
    }
    if (source.kind === "playlist") {
      const playlist = yield* store.getPlaylist(id);
      return playlist === null
        ? null
        : {
            seed: { ...source, title: playlist.playlist.name },
            songs: playlist.items.flatMap((item) =>
              item.source === "library" ? [item.track] : [],
            ),
            streamed: playlist.items.flatMap((item) =>
              item.source === "stream" ? [item.song] : [],
            ),
          };
    }
    const ref = parseTrackId(source.id);
    if (ref?.kind === "library") {
      const songs = yield* store.songsByIds([ref.id]);
      const song = songs[0];
      return song === undefined
        ? null
        : { seed: { ...source, title: song.title }, songs, streamed: [] };
    }
    const track = tracks.get(source.id);
    const song = track === undefined ? null : queuedYtSong(track);
    return song === null
      ? null
      : { seed: { ...source, title: song.title }, songs: [], streamed: [song] };
  });
