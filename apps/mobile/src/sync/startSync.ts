import { libraryEdited, libraryVersion } from "@/library/LibraryScan";
import { onFavoritesSaved, reloadFavorites } from "@/library/favorites";
import { onPlaylistsEdited, playlistsChanged } from "@/library/playlists";
import { appRuntime } from "@/library/runtime";
import { WaveSoulseek } from "@/native/waveSoulseek";
import { playHistoryVersion } from "@/playback/PlayHistory";
import { followPulledBestQuality } from "@/settings/bestQuality";

import type { SyncedChanges } from "./syncCycle";
import { syncedPreferences } from "./syncedPreferences";
import { WaveSync } from "./WaveSync";

let started = false;

const changed = (songs: boolean) => (): void => {
  void appRuntime.runPromise(WaveSync.use((sync) => sync.changed({ songs }))).catch(() => {});
};

/**
 * Shows what the Wave account changed: lists over playlists, stars and plays
 * re-read, and every list once missing songs came in or left.
 */
const showPulled = (changes: SyncedChanges): void => {
  if (changes.library) libraryEdited();
  if (changes.playlists) playlistsChanged();
  if (changes.favorites) reloadFavorites();
  if (changes.plays) playHistoryVersion.update((version) => version + 1);
};

/**
 * Starts syncing the Library with the Wave account while signed in
 * (`WaveSync`), and tells it of the changes made here: playlist edits,
 * stars, plays (Wave's own and imported) and the song list (scans,
 * downloads, deletions). Synced preferences tell it as they're stamped
 * (`startServices`). The app's root layout calls it; a headless start
 * (Android Auto) doesn't sync. Safe to call repeatedly.
 */
export const startSync = (): void => {
  if (started) return;
  started = true;
  void appRuntime
    .runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      WaveSync.use((sync) =>
        sync.start({
          preferences: syncedPreferences,
          pulled: showPulled,
          soulseek: () => WaveSoulseek.followWaveAccount().finally(followPulledBestQuality),
        }),
      ),
    )
    .catch((error: unknown) => console.warn("[wave] Couldn't start syncing", error));
  onPlaylistsEdited(changed(false));
  onFavoritesSaved(changed(false));
  playHistoryVersion.subscribe(changed(false));
  libraryVersion.subscribe(changed(true));
};
