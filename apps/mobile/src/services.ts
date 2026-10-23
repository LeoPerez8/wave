import * as Effect from "effect/Effect";

import { Auto } from "@/auto/Auto";
import { startAutoLyrics } from "@/auto/autoLyrics";
import { startAutoResponder } from "@/auto/autoResponder";
import { afterFirstSettled } from "@/lib/backgroundWork";
import { onSyncedSettingChange } from "@/lib/persistedSetting";
import { startBackgroundFill } from "@/library/backgroundFill";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { AutoRequest } from "@/native/wavePlayer";
import { connectPlayer } from "@/playback/actions";
import { startPlayingSearches } from "@/playback/playingSearches";
import { applyCrossfade } from "@/settings/crossfade";
import { applyStreamBuffer } from "@/settings/streamBuffer";
import { WaveSync } from "@/sync/WaveSync";
import { startDownloads } from "@/ytmusic/YtDownloads";

/** What starts the app services: the Activity's root layout or the headless `WaveService` task. */
export type ServicesStarter = "app" | "headless";

/** Who started the app services in this JS runtime, once they are. */
let startedBy: ServicesStarter | null = null;

/**
 * Answers one Auto request through the `Auto` service. What Auto shows when it
 * fails is the responder's call (`startAutoResponder`).
 */
const answerAuto = (request: AutoRequest): Promise<unknown> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const auto = yield* Auto;
      return yield* auto.answer(request);
    }),
  );

/**
 * Stamps a synced preference the owner changed in the Library store, for the
 * Wave account, which takes it up a few seconds later.
 */
const stampPreference = (key: string): void => {
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        yield* store.stampPreference(key);
        const sync = yield* WaveSync;
        yield* sync.changed({ songs: false });
      }),
    )
    .catch((error: unknown) => console.warn("[wave] Couldn't record a preference change", error));
};

/**
 * Starts the app services that work without UI: the library store, the queue
 * and player sync, playback persistence and play history (one `appRuntime`),
 * the Android Auto responder, Auto's lyrics, the searches of unsearched
 * songs about to play, the background fill of the others and the stamps of
 * synced preference changes. The
 * Activity's root layout and the headless `WaveService` task (index.ts) both call it;
 * whichever comes first starts them, and later calls change nothing, so one
 * JS runtime never initialises them twice. The library scan stays with the UI.
 */
export const startServices = (by: ServicesStarter): void => {
  // The app's resume reads the journal and may read the whole Library: after the first screen.
  if (by === "app") afterFirstSettled("downloads", () => startDownloads(true));
  else startDownloads(false);
  if (startedBy !== null) {
    console.log(`[wave] services already started by the ${startedBy}; the ${by} reuses them`);
    return;
  }
  startedBy = by;
  console.log(`[wave] services started by the ${by}`);
  connectPlayer();
  startPlayingSearches();
  // It reads every playlist's unsearched songs: in the app, after the first screen.
  if (by === "app") afterFirstSettled("backgroundFill", startBackgroundFill);
  else startBackgroundFill();
  applyCrossfade();
  applyStreamBuffer();
  onSyncedSettingChange(stampPreference);
  startAutoResponder(answerAuto);
  startAutoLyrics();
};
