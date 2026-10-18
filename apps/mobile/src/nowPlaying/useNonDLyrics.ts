import {
  nonDLyrics,
  nonDLyricsSong,
  ytMusicFoundLyrics,
  type FoundLyrics,
  type LyricsAnswer,
  type LyricsSearchSong,
  type LyricsSource,
  type Lyrics,
  type NonDLyrics,
  type NonDSongDetails,
  type SavedLyrics,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { searchLrclibLyrics } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { WaveYtDownloads } from "@/native/waveYtDownloads";
import { queueTracks, type QueueTrack } from "@/playback/queueTracks";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { useYtMusicEnabled } from "@/settings/ytMusic";

/**
 * The Lyrics view for a non-D song (docs/spec.md, "Lyrics online"): what
 * shows while it searches and once it's done. Core's `nonDLyrics` decides
 * the order, what's saved and when a miss is searched again; this asks the
 * sources and keeps what Core says to.
 */
export type NonDLyricsShown =
  /** Searching: a skeleton of lyric lines. */
  | { readonly kind: "searching" }
  | { readonly kind: "lyrics"; readonly lyrics: Lyrics }
  /** "No lyrics found" (remembered for a week). */
  | { readonly kind: "notFound" }
  /** Fix songs online is off: "No lyrics", with no request. */
  | { readonly kind: "off" }
  /** It couldn't search (offline): Try again. */
  | { readonly kind: "failed" };

/** One source's request: how long it may take before it counts as failed. */
const ASK_TIMEOUT = "30 seconds";

/** A source's request, settled: what it found, or that it failed (or took too long). */
const settle = (effect: Effect.Effect<FoundLyrics | null, unknown>): Effect.Effect<LyricsAnswer> =>
  effect.pipe(
    Effect.timeout(ASK_TIMEOUT),
    Effect.match({
      onSuccess: (lyrics): LyricsAnswer => ({ ok: true, lyrics }),
      onFailure: (cause): LyricsAnswer => {
        console.warn("[wave] lyrics search failed", cause);
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
  });

const NOTHING: LyricsAnswer = { ok: true, lyrics: null };

const SEARCHING: NonDLyricsShown = { kind: "searching" };

/** Asks [source] for [song]'s lyrics. Never fails: a failure is an answer. */
const ask = (source: LyricsSource, song: LyricsSearchSong): Promise<LyricsAnswer> => {
  if (source === "lrclib") {
    return song.lookup === null
      ? Promise.resolve(NOTHING)
      : appRuntime.runPromise(settle(searchLrclibLyrics(song.lookup)));
  }
  return song.videoId === null
    ? Promise.resolve(NOTHING)
    : appRuntime.runPromise(settle(ytMusicLyrics(song.videoId)));
};

/** What the phone saved for [videoId]; nothing when it can't be read. */
const readSaved = (videoId: string): Promise<SavedLyrics | null> =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.savedLyrics(videoId);
      }),
    )
    .catch(() => null);

const keep = (videoId: string, saved: SavedLyrics): Promise<void> =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        yield* store.keepSavedLyrics(videoId, saved);
      }),
    )
    .catch((cause: unknown) => console.warn("[wave] couldn't save lyrics", cause));

/** What the view shows once Core's search is done. */
const settledShown = (step: Exclude<NonDLyrics, { kind: "searching" }>): NonDLyricsShown => {
  switch (step.kind) {
    case "lyrics":
      return { kind: "lyrics", lyrics: step.lyrics };
    case "notFound":
    case "off":
    case "failed":
      return { kind: step.kind };
  }
};

/**
 * What the Lyrics view shows for the queue's track [trackId] when it's a
 * non-D song, and Try again; null for a Library track (its file has the
 * lyrics) or nothing playing. Saved lyrics show at once; otherwise it shows
 * the skeleton while LRCLIB, then YT Music, are asked. Nothing is asked
 * while Fix songs online is off.
 */
export const useNonDLyrics = (
  trackId: string | null,
): { readonly shown: NonDLyricsShown | null; readonly retry: () => void } => {
  const lookupsOn = useLyricsAndGenreLookupsEnabled();
  const ytMusicOn = useYtMusicEnabled();
  // What the search goes by, as text: a queued track's details learned again
  // (its cover cached) don't search again.
  const searchFor = useSyncExternalStore(queueTracks.subscribe, () => {
    if (trackId === null) return null;
    const track = queueTracks.get().get(trackId);
    const song = nonDLyricsSong(trackId, track === undefined ? null : details(track));
    return song === null ? null : JSON.stringify(song);
  });
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    readonly trackId: string;
    readonly attempt: number;
    readonly shown: NonDLyricsShown;
  } | null>(null);

  useEffect(() => {
    if (trackId === null || searchFor === null) return undefined;
    const song = JSON.parse(searchFor) as LyricsSearchSong;
    let current = true;
    const show = (shown: NonDLyricsShown): void => {
      if (current) setState({ trackId, attempt, shown });
    };
    void (async () => {
      const saved = song.videoId === null ? null : await readSaved(song.videoId);
      const answers: LyricsAnswer[] = [];
      for (;;) {
        const step = nonDLyrics(song, { saved, answers, lookupsOn, ytMusicOn, now: Date.now() });
        if (step.kind !== "searching") {
          const save = step.kind === "lyrics" || step.kind === "notFound" ? step.save : null;
          // Core saves only with a video to save against.
          if (save !== null && song.videoId !== null) await keep(song.videoId, save);
          show(settledShown(step));
          return;
        }
        show(SEARCHING);
        // Gone from the view (another song, closed): no more requests.
        if (!current) return;
        answers.push(await ask(step.ask, song));
      }
    })();
    return () => {
      current = false;
    };
  }, [trackId, searchFor, lookupsOn, ytMusicOn, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (searchFor === null || trackId === null || state?.trackId !== trackId) {
    return { shown: null, retry };
  }
  // Try again shows the skeleton at once, not the failure it's retrying.
  return { shown: state.attempt === attempt ? state.shown : SEARCHING, retry };
};

/** What a queued streamed song's details say, for its lookup. */
const details = (track: QueueTrack): NonDSongDetails => ({
  title: track.title,
  artists: track.artists ?? [track.artist],
  album: track.album,
  // The length YouTube Music listed, kept with the song it was queued from.
  durationMs: track.ytSong?.durationMs ?? null,
});
