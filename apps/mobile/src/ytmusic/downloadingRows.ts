import {
  catalogueOf,
  downloadingList,
  queuedDownloadLines,
  sameDownloadingList,
  type AppLanguage,
  type DownloadingList,
  type QueuedDownload,
} from "@wave/core";
import { useCallback, useSyncExternalStore } from "react";

import { useStoreSelector } from "@/lib/storeSelector";
import { useLocalisation } from "@/localisation/localisation";
import type { NativeDownloadJob } from "@/native/waveSoulseek";
import type { NativeYtSong } from "@/native/waveYtMusic";

import { journal, ownerPause } from "./downloadJournal";

/**
 * Settings › Downloads' Downloading list (Core's `downloadingList`), following the journal: the
 * songs downloading now, then the waiting ones grouped by the playlist, album or mix they're from.
 * It renders again only when a song joins, leaves, starts or moves, or a group changes (Core's
 * `sameDownloadingList`), or the owner pauses or resumes one (#1475); a progress tick reaches only the row that shows it
 * (`useQueuedDownloadLine`, #1441).
 */
export const useDownloadingList = (): DownloadingList<NativeYtSong> => {
  const { language } = useLocalisation();
  const pause = useSyncExternalStore(ownerPause.subscribe, ownerPause.get);
  const select = useCallback(
    (jobs: readonly NativeDownloadJob[]) => downloadingList(jobs, language, pause),
    [language, pause],
  );
  return useStoreSelector(journal, select, sameDownloadingList);
};

let lines: {
  jobs: readonly NativeDownloadJob[] | null;
  language: AppLanguage | null;
  byId: ReadonlyMap<string, string>;
} = { jobs: null, language: null, byId: new Map() };

/** Every song on its way's line (Core's `queuedDownloadLines`), worked out once per journal change. */
const linesNow = (jobs: readonly NativeDownloadJob[], language: AppLanguage) => {
  if (jobs !== lines.jobs || language !== lines.language) {
    lines = { jobs, language, byId: queuedDownloadLines(jobs, catalogueOf(language)) };
  }
  return lines.byId;
};

/**
 * [queued]'s progress line as the journal says it now, following only that line: a tick of
 * another song's download doesn't render this row. Once the job is gone, the row keeps the line
 * its list gave it until the list drops it.
 */
export const useQueuedDownloadLine = (queued: QueuedDownload<NativeYtSong>): string => {
  const { language } = useLocalisation();
  const { id, line } = queued;
  const select = useCallback(
    (jobs: readonly NativeDownloadJob[]) => linesNow(jobs, language).get(id) ?? line,
    [id, line, language],
  );
  return useStoreSelector(journal, select);
};
