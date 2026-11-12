import { useCallback } from "react";
import { useSightedStore } from "@/lib/screenSight";
import { onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { DownloadListKey } from "@/library/db/listDownloadMembers";
import { useLocalisation } from "@/localisation/localisation";
import { journal } from "./downloadJournal";
import { createListDownloadProgressStore } from "./listDownloadProgressStore";

const progress = createListDownloadProgressStore({
  journal,
  subscribeMembership: (changed) =>
    onLibraryChange((change) => {
      if (change.kind === "playlists" || change.kind === "tracks") changed();
    }),
  read: (scope) => {
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    return appRuntime.runPromise(LibraryStore.use((store) => store.listDownloadMembers(scope)));
  },
});

/**
 * One playlist's or album's page-head line, readable without opening its page.
 * Narrow, visible-only subscriptions; the shared reader owns all journal work.
 * Home cards and album lists can use the same address and membership reader.
 */
export const useListDownloadProgress = (kind: "playlist" | "album", id: number): string | null => {
  const { language } = useLocalisation();
  const key: DownloadListKey = `${kind}:${id}`;
  const subscribe = useCallback((changed: () => void) => progress.subscribe(key, changed), [key]);
  const get = useCallback(() => progress.get(key, language), [key, language]);
  return useSightedStore(subscribe, get);
};
