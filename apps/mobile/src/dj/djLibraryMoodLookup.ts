/** Free-turn ReccoBeats fill for Library songs' mood features, by their file's ISRC tag. */
import { djAudioFeaturesByIsrc } from "@wave/core";
import { AppState } from "react-native";

import { freeTurn } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { online } from "@/native/waveNative";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

const RECCOBEATS = "https://api.reccobeats.com/v1";
/** How often the worker looks for songs a scan tagged since its last run. */
const RECHECK_MS = 10 * 60 * 1000;

/** ReccoBeats' rows for [isrcs]: the request carries only the codes. */
const featureRows = async (isrcs: readonly string[]): Promise<readonly unknown[]> => {
  const response = await fetch(
    `${RECCOBEATS}/audio-features?ids=${encodeURIComponent(isrcs.join(","))}`,
  );
  if (!response.ok) throw new Error(`ReccoBeats HTTP ${response.status}`);
  const body: unknown = await response.json();
  const content =
    typeof body === "object" && body !== null ? (body as { content?: unknown }).content : null;
  if (!Array.isArray(content)) throw new Error("ReccoBeats returned an invalid feature list");
  return content;
};

/**
 * Starts a cancellable worker that looks up, 40 at a time, the Library songs whose file has an
 * ISRC tag and no answer kept for it. It runs only while Fix songs online is on, the app is in
 * the foreground and the phone is online; a failed request leaves its songs due.
 */
export const startDjLibraryMoodLookup = (): (() => void) => {
  let stopped = false;
  let running = false;
  const enabled = () =>
    !stopped && AppState.currentState === "active" && online() && lyricsAndGenreLookupsEnabled();
  const run = async (): Promise<void> => {
    if (running || !enabled()) return;
    running = true;
    let checked = 0;
    let matched = 0;
    try {
      const store = await appRuntime.runPromise(LibraryStore);
      let after = 0;
      while (enabled()) {
        await freeTurn();
        if (!enabled()) break;
        const page = await appRuntime.runPromise(
          store.pendingDjLibraryMoodSongs(after, Date.now()),
        );
        if (page.length === 0) break;
        after = page[page.length - 1]!.trackId;
        const found = djAudioFeaturesByIsrc(
          await featureRows([...new Set(page.map(({ isrc }) => isrc))]),
        );
        if (!enabled()) break;
        const writes = page.map(({ trackId, isrc }) => ({
          trackId,
          isrc,
          features: found.get(isrc) ?? null,
          checkedAt: Date.now(),
        }));
        await appRuntime.runPromise(store.keepDjLibraryMoodFeatures(writes));
        checked += writes.length;
        matched += writes.filter(({ features }) => features !== null).length;
        // ReccoBeats is asked at most every 400 ms.
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
      }
      if (checked > 0)
        console.info(`[wave] DJ Library mood lookup: ${checked} songs checked, ${matched} matched`);
    } catch {
      // The songs not saved stay due for the next run.
      console.warn(
        `[wave] DJ Library mood lookup failed after ${checked} songs checked, ${matched} matched`,
      );
    } finally {
      running = false;
    }
  };
  const activity = AppState.addEventListener("change", () => void run());
  const timer = setInterval(() => void run(), RECHECK_MS);
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
    activity.remove();
  };
};
