import { extrapolatePosition, paletteGradient, type Gradient, type QueueEntry } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";

import { LibraryStore, type TrackDetails } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { playbackState } from "@/playback/Player";
import { learnUnknownQueueTracks, queueTracks, type QueueTrack } from "@/playback/queueTracks";
import { useThemeColor } from "@/theme/useThemeColor";

import { useNowPlayingShown } from "./sheet";

/** The playing track's album and artist (for the links) and palette, from the library. */
export const useTrackDetails = (trackId: string | null): TrackDetails | null => {
  const [details, setDetails] = useState<TrackDetails | null>(null);
  useEffect(() => {
    if (trackId === null) return undefined;
    let current = true;
    appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.trackDetails(Number(trackId));
        }),
      )
      .then((result) => {
        if (current) setDetails(result);
      })
      .catch(() => {
        if (current) setDetails(null);
      });
    return () => {
      current = false;
    };
  }, [trackId]);
  return details !== null && String(details.id) === trackId ? details : null;
};

const isHex = (colour: string): boolean => /^#[0-9a-f]{6}$/i.test(colour);

/**
 * The background gradient for the playing artwork, toned so Wave's ink,
 * graphite and teal stay readable on it. The plain ground without a palette.
 */
export const useNowPlayingGradient = (details: TrackDetails | null): Gradient => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const ground = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const secondary = useThemeColor("secondary");
  const accent = useThemeColor("accent");
  const palette = details?.palette ?? null;
  return useMemo(() => {
    const ink = [foreground, secondary, accent];
    if (!isHex(ground) || !ink.every(isHex)) return { top: ground, bottom: ground };
    return paletteGradient(palette, { scheme, ground, ink });
  }, [palette, scheme, ground, foreground, secondary, accent]);
};

const TICK_MS = 200;

const ignore = (): (() => void) => () => {};

/** The player's position reports; not listened to while `live` is off, re-read when it turns on. */
const usePositionReport = (live: boolean) => {
  const subscribe = live ? playbackState.subscribe : ignore;
  const positionMs = useSyncExternalStore(subscribe, () => playbackState.get().positionMs);
  const durationMs = useSyncExternalStore(subscribe, () => playbackState.get().durationMs);
  const at = useSyncExternalStore(subscribe, () => playbackState.get().at);
  const isPlaying = useSyncExternalStore(subscribe, () => playbackState.get().isPlaying);
  return { positionMs, durationMs, at, isPlaying };
};

/**
 * Where the playhead is now, ticking between the player's reports (every
 * 500 ms) so the scrubber and the elapsed / remaining labels run smoothly.
 * It stands still while Now Playing is out of sight.
 */
export const usePlayhead = (): {
  readonly positionMs: number;
  readonly durationMs: number | null;
} => {
  const live = useNowPlayingShown();
  const report = usePositionReport(live);
  const [now, setNow] = useState(Date.now);
  const ticking = live && report.isPlaying;
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return {
    positionMs: extrapolatePosition(report, Math.max(now, report.at)),
    durationMs: report.durationMs,
  };
};

/**
 * The queue's tracks by id, as the Queue service learned them with the
 * commands that queued them, so the rows are filled on the first frame. Only
 * tracks it doesn't know (a queue picked back up from the player after JS
 * restarted) are looked up in the library, once for the app's lifetime.
 */
export const useQueueTracks = (entries: readonly QueueEntry[]): ReadonlyMap<string, QueueTrack> => {
  const tracks = useSyncExternalStore(queueTracks.subscribe, queueTracks.get);
  useEffect(() => {
    void appRuntime.runPromise(
      LibraryStore.use((store) => learnUnknownQueueTracks(entries, store.songsByIds)),
    );
  }, [entries]);
  return tracks;
};
