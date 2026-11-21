/**
 * The kind of shuffle a queue command uses (docs/spec.md, story 25a): the one chosen, with what
 * it orders the songs by, read from the Library only when the command shuffles (Core's
 * `shuffleReads`). Smart Shuffle goes by the songs' all-time counted plays; Even Shuffle by
 * their artists, genres and albums, a streamed song's from what YT Music says of it.
 */
import {
  REAL_SHUFFLE,
  parseTrackId,
  shuffleReads,
  type QueueCommand,
  type QueueState,
  type Shuffle,
  type ShuffleKind,
  type YtAlbumSong,
} from "@wave/core";

import type { LibraryDatabase } from "./db/database.ts";
import { songCountedPlays } from "./db/playTotals.ts";
import { shuffleSongs } from "./db/shuffleSongs.ts";

export interface QueueShuffleDeps {
  readonly db: LibraryDatabase;
  /** The kind chosen now. */
  readonly kind: () => ShuffleKind;
  /** A YT Music song's details, by video id, as the playback session takes them. */
  readonly streamed?: (videoId: string) => YtAlbumSong | undefined;
}

/** The playback session's `shuffle`: what [command] shuffles [state]'s queue by. */
export const queueShuffle =
  (deps: QueueShuffleDeps) =>
  (state: QueueState, command: QueueCommand): Shuffle => {
    const reads = shuffleReads(deps.kind(), state, command);
    if (reads.kind === "real") return REAL_SHUFFLE;
    if (reads.kind === "smart") {
      return { kind: "smart", plays: songCountedPlays(deps.db, reads.trackIds) };
    }
    const songs = shuffleSongs(deps.db, reads.trackIds);
    for (const trackId of reads.trackIds) {
      const ref = parseTrackId(trackId);
      const song = ref?.kind === "yt" ? deps.streamed?.(ref.videoId) : undefined;
      if (song === undefined) continue;
      songs.set(trackId, { artist: song.artists[0] ?? null, genre: null, album: song.album });
    }
    return { kind: "even", songs };
  };
