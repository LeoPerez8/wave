import { songRowPresentation, type SongRowPresentation } from "@/songs/songListModel";

import type { SyntheticTrack } from "./syntheticLibrary";

/**
 * A synthetic song as the song row shows it. It goes as a song with no file
 * and no Library id (no downloaded mark), titled and credited as it is.
 * [card]: a song card's row, as Search lists it (play disc, "Song · ").
 */
export const syntheticSongRow = (
  { track, state, favorite }: SyntheticTrack,
  card = false,
): SongRowPresentation =>
  songRowPresentation(
    {
      kind: "history",
      id: track.id,
      title: track.title,
      artist: track.artist,
      durationMs: track.durationMs,
    },
    {
      playing: state === "playing",
      fileNotFound: state === "fileNotFound",
      starred: favorite,
      ...(card ? { leading: { kind: "playDisc" }, kindLine: true } : {}),
    },
    track.id,
  );
