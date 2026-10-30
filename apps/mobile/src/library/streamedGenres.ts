import { songLookup } from "@wave/core";
import * as Effect from "effect/Effect";
import { AppState } from "react-native";

import { freeTurn } from "@/lib/backgroundWork";
import { playHistoryVersion } from "@/playback/PlayHistory";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { LibraryStore } from "./LibraryStore";
import { lookUpStreamedGenre, logLookupFailure } from "./lyricsAndGenre";
import { appRuntime } from "./runtime";
import { fillStreamedGenres } from "./streamedGenreFill";

/** A restarted worker waits for an in-flight lookup and save before reading pending videos. */
let pendingFill: Promise<void> = Promise.resolve();

/** Starts after settlement. No screen or playback call waits for this worker. */
export const startStreamedGenres = (): (() => void) => {
  let stopped = false;
  let running = false;
  let dirty = false;
  const enabled = () =>
    !stopped && AppState.currentState === "active" && lyricsAndGenreLookupsEnabled();
  const run = async (): Promise<void> => {
    dirty = true;
    if (running || !enabled()) return;
    running = true;
    const previous = pendingFill;
    let release!: () => void;
    pendingFill = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (!enabled()) return;
      const store = await appRuntime.runPromise(LibraryStore);
      do {
        dirty = false;
        await fillStreamedGenres({
          enabled,
          failed: (_videoId, cause) => logLookupFailure("Streamed genre lookup", "Deezer", cause),
          turn: freeTurn,
          page: (after) => appRuntime.runPromise(store.pendingStreamedGenres(after)),
          lookup: async (videoId) => {
            const songs = await appRuntime.runPromise(store.streamedSongsByIds([videoId]));
            const song = songs.get(videoId);
            const lookup =
              song === undefined
                ? null
                : songLookup({
                    title: song.title,
                    artist: song.artists.join(", "),
                    album: song.album ?? "",
                    durationMs: song.durationMs ?? 0,
                  });
            if (lookup === null) return null;
            return appRuntime.runPromise(Effect.suspend(() => lookUpStreamedGenre(lookup)));
          },
          save: (videoId, genre) => appRuntime.runPromise(store.keepStreamedGenre(videoId, genre)),
        });
      } while (dirty && enabled());
    } catch (cause) {
      logLookupFailure("Streamed genre lookup", "Deezer", cause);
    } finally {
      running = false;
      release();
    }
  };
  const changed = () => {
    void run();
  };
  const stopHistory = playHistoryVersion.subscribe(changed);
  const activity = AppState.addEventListener("change", changed);
  changed();
  return () => {
    stopped = true;
    stopHistory();
    activity.remove();
  };
};
