import {
  nonDLyrics,
  nonDLyricsSong,
  type LyricsSearchSong,
  type Lyrics,
  type NonDLyrics,
  type NonDSongDetails,
  type SavedLyrics,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo, useSyncExternalStore } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { queueTracks, type QueueTrack } from "@/playback/queueTracks";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useLyricsSearch, type LyricsSearchPlan } from "./useLyricsSearch";

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

const SEARCHING: NonDLyricsShown = { kind: "searching" };

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
 * lyrics), a streamed song whose details the queue doesn't know yet (Core's
 * `nonDLyricsSong` waits for them), or nothing playing. Saved lyrics show at
 * once; otherwise it shows the skeleton while LRCLIB, then YT Music, are
 * asked. Nothing is asked while Fix songs online is off.
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

  const begin = useMemo(() => {
    if (searchFor === null) return null;
    const song = JSON.parse(searchFor) as LyricsSearchSong;
    return async (): Promise<LyricsSearchPlan<NonDLyricsShown>> => {
      const saved = song.videoId === null ? null : await readSaved(song.videoId);
      return {
        song,
        step: (answers) => {
          const step = nonDLyrics(song, { saved, answers, lookupsOn, ytMusicOn, now: Date.now() });
          if (step.kind === "searching") return { kind: "ask", source: step.ask };
          const save = step.kind === "lyrics" || step.kind === "notFound" ? step.save : null;
          return {
            kind: "done",
            shown: settledShown(step),
            keep: save === null ? null : () => keep(save.videoId, save.saved),
          };
        },
      };
    };
  }, [searchFor, lookupsOn, ytMusicOn]);

  return useLyricsSearch(begin === null ? null : trackId, begin, SEARCHING);
};

/** What a queued streamed song's details say, for its lookup. */
const details = (track: QueueTrack): NonDSongDetails => ({
  title: track.title,
  artists: track.artists ?? [track.artist],
  album: track.album,
  // The length YouTube Music listed, kept with the song it was queued from.
  durationMs: track.ytSong?.durationMs ?? null,
});
