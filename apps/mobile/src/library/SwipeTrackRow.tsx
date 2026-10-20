import type { ComponentProps } from "react";

import { TrackRow } from "@/catalog/TrackRow";
import { useSongSummarySwipe, useSongSwipe } from "@/playback/rowSwipe";

import type { SongRow, SongSummary } from "./LibraryStore";

/**
 * A Library [song]'s row in a list of songs: a `TrackRow` that swipes to run
 * its menu's entries (right Add to Queue, left Delete, or Remove from Library
 * for a missing song; `useSongSwipe`).
 */
export function SwipeTrackRow({
  song,
  ...row
}: Omit<ComponentProps<typeof TrackRow>, "swipe"> & { song: SongRow }) {
  const swipe = useSongSwipe(song);
  return <TrackRow {...row} swipe={swipe} />;
}

/**
 * A row of Library › Songs, which holds only what it shows ([summary]): it
 * swipes as `SwipeTrackRow` does, reading the song when a swipe runs
 * (`useSongSummarySwipe`).
 */
export function SwipeSummaryRow({
  summary,
  ...row
}: Omit<ComponentProps<typeof TrackRow>, "swipe"> & { summary: SongSummary }) {
  const swipe = useSongSummarySwipe(summary);
  return <TrackRow {...row} swipe={swipe} />;
}
