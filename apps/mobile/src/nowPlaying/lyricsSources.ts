import {
  lookupFailureLine,
  ytMusicFoundLyrics,
  type FoundLyrics,
  type LyricsAnswer,
  type LyricsSearchSong,
  type LyricsSource,
  type LookupService,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { searchLrclibLyrics } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { WaveYtDownloads } from "@/native/waveYtDownloads";

/** How long YT Music's lyrics may take before they count as failed (LRCLIB's search has its own limit). */
const YT_MUSIC_TIMEOUT = "30 seconds";

/** A source's request, settled: what it found, or that it failed, logged with the service and why. */
const settle = (
  service: LookupService,
  effect: Effect.Effect<FoundLyrics | null, unknown>,
): Effect.Effect<LyricsAnswer> =>
  effect.pipe(
    Effect.match({
      onSuccess: (lyrics): LyricsAnswer => ({ ok: true, lyrics }),
      onFailure: (cause): LyricsAnswer => {
        console.warn(`[wave] ${lookupFailureLine("lyrics search", service, cause)}`);
        return { ok: false };
      },
    }),
  );

/** YT Music's lyrics for [videoId]: its watch page says where they are, if anywhere. */
const ytMusicLyrics = (videoId: string) =>
  Effect.gen(function* () {
    const watch = yield* Effect.tryPromise(() => WaveYtDownloads.watchSong(videoId));
    if (watch.lyricsBrowseId === null) return null;
    const browseId = watch.lyricsBrowseId;
    return ytMusicFoundLyrics(yield* Effect.tryPromise(() => WaveYtDownloads.lyrics(browseId)));
  }).pipe(Effect.timeout(YT_MUSIC_TIMEOUT));

const NOTHING: LyricsAnswer = { ok: true, lyrics: null };

/**
 * Asks [source] for [song]'s lyrics, for the Lyrics view's searches (a
 * non-D song's and a Library song's alike). Never fails: a failure is an
 * answer.
 */
export const askLyrics = (source: LyricsSource, song: LyricsSearchSong): Promise<LyricsAnswer> => {
  if (source === "lrclib") {
    return song.lookup === null
      ? Promise.resolve(NOTHING)
      : appRuntime.runPromise(settle("LRCLIB", searchLrclibLyrics(song.lookup)));
  }
  return song.videoId === null
    ? Promise.resolve(NOTHING)
    : appRuntime.runPromise(settle("YT Music", ytMusicLyrics(song.videoId)));
};
