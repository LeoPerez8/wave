import { WavePlayer, type AutoLyricsEvent } from "@/native/wavePlayer";
import { playbackState } from "@/playback/Player";
import { queueState } from "@/playback/Queue";
import { queueTracks } from "@/playback/queueTracks";
import { readTrackLyrics } from "@/playback/trackLyrics";

import { startAutoLyricLines } from "./autoLyricLines";

/** The audio file of queue entry `itemId`, once the queue knows it. */
const pathOf = (itemId: string): string | null => {
  const entry = queueState.get().entries.find((candidate) => candidate.key === itemId);
  return entry === undefined ? null : (queueTracks.get().get(entry.trackId)?.path ?? null);
};

/**
 * Shows the lyrics being sung as the title and artist on Android Auto's
 * player screen while its Lyrics toggle is on (see `startAutoLyricLines`). The toggle
 * lives in the playback service, which reports it with Auto's connection.
 * Call it once per JS runtime (`startServices` does).
 */
export const startAutoLyrics = (): void => {
  const sync = startAutoLyricLines({
    playback: playbackState,
    pathOf,
    readLyrics: readTrackLyrics,
    show: (itemId, text) => {
      WavePlayer.setAutoLyricsText(itemId, text).catch(() => undefined);
    },
  });
  let reported = false;
  WavePlayer.addListener("onAutoLyrics", (event: AutoLyricsEvent) => {
    reported = true;
    sync.setToggle(event);
  });
  WavePlayer.getAutoLyrics()
    .then((toggle) => {
      // An event that came first is newer.
      if (!reported) sync.setToggle(toggle);
    })
    .catch(() => undefined);
};
