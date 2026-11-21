/**
 * Settings › Disliked songs (docs/spec.md, Dislike): every disliked song, the
 * newest first, each with a way to remove its dislike. The app reads the
 * dislikes it keeps and draws these rows.
 */

import type { DislikedSong, DislikedSongs } from "./dislikes.ts";
import { joinArtists } from "./ytMusic.ts";

/** A disliked song as the page lists it. */
export interface DislikedSongRow {
  /** Its `dislikeKey`: what removing its dislike forgets. */
  readonly key: string;
  readonly title: string;
  /** Its artists as one credit; empty when it was listed with none. */
  readonly artist: string;
}

/**
 * The page's rows: [songs] (the dislikes as they were read) that [disliked]
 * still holds, the newest first, a Library song and a YT Music song alike. A
 * song whose dislike was removed since the read leaves at once; songs disliked
 * at the same moment keep the order they were read in.
 */
export const dislikedSongRows = (
  songs: readonly DislikedSong[],
  disliked: DislikedSongs,
): DislikedSongRow[] =>
  songs
    .filter((song) => disliked.has(song.key))
    .map((song, index) => ({ song, index }))
    .sort((a, b) => b.song.dislikedAt - a.song.dislikedAt || a.index - b.index)
    .map(({ song }) => ({ key: song.key, title: song.title, artist: joinArtists(song.artists) }));
