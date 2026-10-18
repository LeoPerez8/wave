/**
 * Turning Download in best quality on offers to replace the Library's low-quality songs with
 * MP3 320 copies from Soulseek (docs/spec.md, "YT Music" › Download quality): the card that asks
 * ("Replace 342 songs with best quality? About +1.2 GB", Replace / Not now), and Settings ›
 * Downloads' row that offers it again while songs are left. Core decides which songs qualify
 * and the estimate (`qualityUpgradeSongs`, `qualityUpgradeOffer`).
 */
import {
  qualityUpgradeOffer,
  qualityUpgradeSongs,
  type QualityFile,
  type QualityOffer,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { WaveNative } from "@/native/waveNative";
import { confirmAction } from "@/overlay/alert";
import {
  downloadJournal,
  onNoBetterCopies,
  runQualityReplacements,
  useDownloadJournal,
} from "@/ytmusic/YtDownloads";

const readNoBetterCopy = (): Promise<ReadonlySet<number>> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const store = yield* LibraryStore;
      return new Set(yield* store.noBetterCopies("upgrade"));
    }),
  );

/** The songs recorded as having no better copy for an upgrade; null until first read. */
const noBetterCopy = makeExternalStore<ReadonlySet<number> | null>(null);
const reloadNoBetterCopy = (): void => {
  void readNoBetterCopy().then(noBetterCopy.set, () => undefined);
};
onNoBetterCopies(reloadNoBetterCopy);

const readQualityFiles = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.qualityFiles;
});

const qualityFiles = libraryQuery("qualityFiles", { tracks: true }, readQualityFiles);

/** Whether the phone is on mobile data now; Wi-Fi when the module can't tell. */
const onMobileData = (): boolean => {
  try {
    return WaveNative.onMobileData();
  } catch {
    return false;
  }
};

/**
 * Offers the upgrade: reads the Library and the download journal as they are now, and when any
 * song qualifies asks with Core's card; Replace queues them under "Quality upgrade". Nothing
 * shows when no song qualifies.
 */
export const offerQualityUpgrade = async (): Promise<void> => {
  const [files, remembered] = await Promise.all([
    appRuntime.runPromise(readQualityFiles),
    readNoBetterCopy(),
  ]);
  const songs = qualityUpgradeSongs(files, { noBetterCopy: remembered, jobs: downloadJournal() });
  const offer = qualityUpgradeOffer(songs, { onMobileData: onMobileData() });
  if (offer === null) return;
  if (await confirmAction(offer.alert)) runQualityReplacements("upgrade", offer.trackIds);
};

const NO_FILES: readonly QualityFile[] | null = null;

/**
 * The upgrade offered now while best quality is [on] (Core's `qualityUpgradeOffer`): the songs
 * left to replace, following the Library, the journal (songs on their way leave it) and the
 * songs found to have no better copy; null while it's off or no song qualifies.
 */
export const useQualityUpgradeOffer = (on: boolean): QualityOffer | null => {
  const files = useLibraryQuery(on ? qualityFiles : null, NO_FILES);
  const remembered = useSyncExternalStore(noBetterCopy.subscribe, noBetterCopy.get);
  useEffect(() => {
    if (on) reloadNoBetterCopy();
  }, [on]);
  const jobs = useDownloadJournal();
  return useMemo(
    () =>
      !on || files === null || remembered === null
        ? null
        : qualityUpgradeOffer(qualityUpgradeSongs(files, { noBetterCopy: remembered, jobs }), {
            onMobileData: false,
          }),
    [on, files, remembered, jobs],
  );
};
