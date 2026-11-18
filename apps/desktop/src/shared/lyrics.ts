import type { Lyrics } from "@wave/core";

/**
 * What the Lyrics view shows for a song (`window.wave.lyrics.song`): its lyrics, `none` for
 * "No lyrics", or `failed` when a source couldn't be reached (Try again asks once more).
 */
export type SongLyrics = Lyrics | { readonly kind: "failed" };
