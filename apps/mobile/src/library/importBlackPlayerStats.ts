import { planBlackPlayerImport, summarizeBlackPlayerImport } from "@wave/core";
import * as Effect from "effect/Effect";

import { WaveNative } from "@/native/waveNative";
import { showError } from "@/overlay/alert";
import { playsImported } from "@/playback/PlayHistory";

import { showImportSummary } from "./importPlaylists";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * Settings › Import BlackPlayer Stats: opens the system file picker for
 * BlackPlayer's track-stat snapshots (several at once), adds the plays they
 * hold that aren't in the history yet, dated by comparing the snapshots
 * (Core's `planBlackPlayerImport`), then says what was imported and lists the
 * songs not in the Library. Resolves once the summary is closed.
 */
export const importBlackPlayerStats = async (): Promise<void> => {
  try {
    const files = await WaveNative.pickStatFiles();
    if (files.length === 0) return;
    const [tracks, imported] = await appRuntime.runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      LibraryStore.use((store) => Effect.all([store.importTracks, store.importedPlays])),
    );
    const plan = planBlackPlayerImport(
      files.map(({ name, text }) => ({ name, text })),
      tracks,
      imported,
    );
    if (plan.plays.length > 0) {
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      await appRuntime.runPromise(LibraryStore.use((store) => store.saveImportedPlays(plan.plays)));
      // Stats, Home and the artist pages read the history again, and the plays go up.
      playsImported();
    }
    await showImportSummary(summarizeBlackPlayerImport(plan));
  } catch (error) {
    await showError("Couldn't import the BlackPlayer stats", error);
  }
};
