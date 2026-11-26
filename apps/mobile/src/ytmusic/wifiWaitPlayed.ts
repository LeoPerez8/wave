import { currentEntry, wifiWaitPlayed } from "@wave/core";

import { WaveSoulseek } from "@/native/waveSoulseek";
import { queueState } from "@/playback/Queue";

import { journal } from "./downloadJournal";

/**
 * Download only on Wi-Fi (#1502): when a song whose download waits for Wi-Fi starts playing,
 * the journal lets it download now over whatever network there is, since playing it streams the
 * same audio (Core's `wifiWaitPlayed`; a best-quality copy keeps waiting, as the journal decides).
 * Follows the queue's current song from [followWifiWaitPlayed] on.
 */
export const followWifiWaitPlayed = (): (() => void) => {
  let playing: string | null = null;
  return queueState.subscribe(() => {
    const trackId = currentEntry(queueState.get())?.trackId ?? null;
    if (trackId === playing) return;
    playing = trackId;
    const id = wifiWaitPlayed(journal.get(), trackId);
    if (id === null) return;
    void WaveSoulseek.playNowDownload(id).catch((error: unknown) => {
      console.warn("[wave] Couldn't start the played song's download", error);
    });
  });
};
