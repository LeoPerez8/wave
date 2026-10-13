import { makeExternalStore } from "@/lib/externalStore";

/**
 * Bumped whenever Wave writes a song's lyrics (into its tags or a sidecar
 * `.lrc`), with the path, so an open Lyrics view reads them again at once.
 */
export const lyricsEdits = makeExternalStore<{
  readonly path: string | null;
  readonly count: number;
}>({ path: null, count: 0 });

/** The lyrics of the file at [path] changed on disk. */
export const lyricsWritten = (path: string): void =>
  lyricsEdits.update(({ count }) => ({ path, count: count + 1 }));
