import type { WaveSession } from "@wave/core";

import { libraryEdited, libraryVersion } from "@/library/LibraryScan";
import { onFavoritesSaved, reloadFavorites } from "@/library/favorites";
import { downloadSyncedStars } from "@/library/starSongs";
import { onPlaylistsEdited, playlistsChanged } from "@/library/playlists";
import { appRuntime } from "@/library/runtime";
import { WaveAccount } from "@/native/waveAccount";
import { WaveSoulseek } from "@/native/waveSoulseek";
import { onPlaysRecorded, playHistoryChanged, type PlaysRecorded } from "@/playback/PlayHistory";
import { followPulledBestQuality } from "@/settings/bestQuality";

import type { SyncedChanges } from "./syncCycle";
import { syncedPreferences } from "./syncedPreferences";
import { WaveSync } from "./WaveSync";

let started = false;
/** Whether `WaveSync` was built: once an account signed in, so signed out it never loads. */
let syncing = false;

// Signed out, edits go nowhere: signing in joins the Library with the account anew.
const changed = (songs: boolean) => (): void => {
  if (!syncing) return;
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  void appRuntime.runPromise(WaveSync.use((sync) => sync.changed({ songs }))).catch(() => {});
};

/** A play's start or end goes up with the next batch of play ends; imported plays as an edit does. */
const recorded = (what: PlaysRecorded): void => {
  if (!syncing) return;
  if (what === "imported") return changed(false)();
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  void appRuntime.runPromise(WaveSync.use((sync) => sync.played(what))).catch(() => {});
};

/**
 * Shows what the Wave account changed: lists over playlists, stars and plays
 * re-read, and every list once missing songs came in or left. Missing songs
 * with a star download (`downloadSyncedStars`).
 */
const showPulled = (changes: SyncedChanges): void => {
  if (changes.library) libraryEdited();
  if (changes.playlists) playlistsChanged();
  if (changes.favorites) reloadFavorites();
  if (changes.plays) playHistoryChanged();
  if (changes.favorites || changes.library) void downloadSyncedStars();
};

/**
 * Starts syncing the Library with the Wave account while signed in
 * (`WaveSync`), and tells it of the changes made here: playlist edits,
 * stars, plays (Wave's own in batches, imported ones as edits) and the song
 * list (scans, downloads, deletions). Plays pulled from the account aren't
 * changes made here, so they start no sync. Synced preferences tell it as they're stamped
 * (`startServices`). Missing songs with a star download, those starred
 * before Wave started too. Signed out, `WaveSync` isn't built: the first
 * signed-in session builds it. The app's root layout calls it; a headless
 * start (Android Auto) doesn't sync. Safe to call repeatedly.
 */
export const startSync = (): void => {
  if (started) return;
  started = true;
  const signedIn = (session: WaveSession): void => {
    if (session.status === "signedIn") startSyncing();
  };
  WaveAccount.addListener("onSessionChanged", signedIn);
  WaveAccount.session().then(signedIn, () => {});
  // Stars already here (pulled by an older Wave, or by a run that didn't finish) download too.
  void downloadSyncedStars();
  onPlaylistsEdited(changed(false));
  onFavoritesSaved(changed(false));
  onPlaysRecorded(recorded);
  libraryVersion.subscribe(changed(true));
};

/** Builds `WaveSync` and starts it, the first time an account is signed in. */
const startSyncing = (): void => {
  if (syncing) return;
  syncing = true;
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
};
