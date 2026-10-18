/**
 * Flipping Download in best quality offers to bring the Library's songs in line (docs/spec.md,
 * "YT Music" › Download quality): on, to replace low-quality songs with MP3 320 copies from
 * Soulseek ("Replace 342 songs with best quality? About +1.2 GB"); off, to free space by replacing
 * MP3 320s with YouTube Music's copies ("Free about 900 MB by replacing 410 songs with YouTube
 * Music copies?"), with Replace / Not now. Settings › Downloads' row offers the current direction
 * again while songs are left. Core decides which songs qualify and the estimates
 * (`qualitySongs`, `qualityUpgradeOffer`/`qualityDowngradeOffer`).
 */
import {
  qualityDowngradeOffer,
  qualitySongs,
  qualityUpgradeOffer,
  youTubeCopyKbps,
  type QualityDirection,
  type QualityFile,
  type QualityMemory,
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

import { ytMusicEnabled, useYtMusicEnabled } from "./ytMusic";

type NoBetterCopiesByDirection = { readonly [D in QualityDirection]: ReadonlySet<number> };

const readNoBetterCopy = (): Promise<NoBetterCopiesByDirection> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const store = yield* LibraryStore;
      const [upgrade, downgrade] = yield* Effect.all([
        store.noBetterCopies("upgrade"),
        store.noBetterCopies("downgrade"),
      ]);
      return { upgrade: new Set(upgrade), downgrade: new Set(downgrade) };
    }),
  );

/** The songs recorded as having no better copy, each way; null until first read. */
const noBetterCopy = makeExternalStore<NoBetterCopiesByDirection | null>(null);
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
 * Core's offer in [direction] for the Library's [files]: freeing space comes at the bitrate the
 * owner's YouTube downloads get (`youTubeCopyKbps`).
 */
const offerFor = (
  direction: QualityDirection,
  files: readonly QualityFile[],
  memory: QualityMemory,
  mobileData: boolean,
): QualityOffer | null =>
  direction === "upgrade"
    ? qualityUpgradeOffer(qualitySongs(direction, files, memory), { onMobileData: mobileData })
    : qualityDowngradeOffer(qualitySongs(direction, files, memory), {
        onMobileData: mobileData,
        youTubeKbps: youTubeCopyKbps(files),
      });

/**
 * Offers the replacement in [direction]: reads the Library and the download journal as they are
 * now, and when any song qualifies asks with Core's card; Replace queues them under "Quality
 * upgrade" or "Free up space". Nothing shows when no song qualifies, nothing would be saved, or
 * (freeing space) YT Music is off, as YouTube Music's copies need it.
 */
export const offerQualityReplacement = async (direction: QualityDirection): Promise<void> => {
  if (direction === "downgrade" && !ytMusicEnabled()) return;
  const [files, remembered] = await Promise.all([
    appRuntime.runPromise(readQualityFiles),
    readNoBetterCopy(),
  ]);
  const memory = { noBetterCopy: remembered[direction], jobs: downloadJournal() };
  const offer = offerFor(direction, files, memory, onMobileData());
  if (offer === null) return;
  if (await confirmAction(offer.alert)) runQualityReplacements(direction, offer.trackIds);
};

const NO_FILES: readonly QualityFile[] | null = null;

/**
 * The replacement offered now in [direction] (null for none asked): the songs left to replace,
 * following the Library, the journal (songs on their way leave it) and the songs found to have
 * no better copy; null when no song qualifies, or freeing space while YT Music is off.
 */
export const useQualityOffer = (direction: QualityDirection | null): QualityOffer | null => {
  const ytMusicOn = useYtMusicEnabled();
  const asked = direction === "downgrade" && !ytMusicOn ? null : direction;
  const files = useLibraryQuery(asked === null ? null : qualityFiles, NO_FILES);
  const remembered = useSyncExternalStore(noBetterCopy.subscribe, noBetterCopy.get);
  useEffect(() => {
    if (asked !== null) reloadNoBetterCopy();
  }, [asked]);
  const jobs = useDownloadJournal();
  return useMemo(
    () =>
      asked === null || files === null || remembered === null
        ? null
        : offerFor(asked, files, { noBetterCopy: remembered[asked], jobs }, false),
    [asked, files, remembered, jobs],
  );
};
