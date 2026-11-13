import { makeExternalStore } from "@/lib/externalStore";

/** Invalidates Search after either local or saved streamed lyrics change. */
export const lyricsSearchIndexVersion = makeExternalStore(0);

let versionTimer: ReturnType<typeof setTimeout> | undefined;
export const notifyLyricsSearchIndexChanged = (): void => {
  if (versionTimer !== undefined) return;
  versionTimer = setTimeout(() => {
    versionTimer = undefined;
    lyricsSearchIndexVersion.update((version) => version + 1);
  }, 350);
};
