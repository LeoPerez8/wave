import { extrapolatePosition, paletteGradient, type Gradient, type QueueEntry } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";

import { LibraryStore, type SongRow, type TrackDetails } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { playbackState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

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

const usePositionReport = () => {
  const positionMs = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().positionMs,
  );
  const durationMs = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().durationMs,
  );
  const at = useSyncExternalStore(playbackState.subscribe, () => playbackState.get().at);
  const isPlaying = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().isPlaying,
  );
  return { positionMs, durationMs, at, isPlaying };
};

/**
 * Where the playhead is now, ticking between the player's reports (every
 * 500 ms) so the scrubber and the elapsed / remaining labels run smoothly.
 */
export const usePlayhead = (): {
  readonly positionMs: number;
  readonly durationMs: number | null;
} => {
  const report = usePositionReport();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!report.isPlaying) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [report.isPlaying]);
  return {
    positionMs: extrapolatePosition(report, Math.max(now, report.at)),
    durationMs: report.durationMs,
  };
};

/**
 * Library rows for the queue's tracks, looked up once per track id: the
 * queue only holds ids, and Up Next can be the whole library.
 */
export const useQueueSongs = (entries: readonly QueueEntry[]): ReadonlyMap<string, SongRow> => {
  const [songs, setSongs] = useState<ReadonlyMap<string, SongRow>>(() => new Map());
  // Ids already asked for, found or not, so a track gone from the library isn't re-queried.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const missing = [...new Set(entries.map((entry) => entry.trackId))].filter(
      (id) => !requested.current.has(id),
    );
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);
    appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.songsByIds(missing.map(Number));
        }),
      )
      .then((rows) => {
        if (rows.length === 0) return;
        setSongs((previous) => {
          const next = new Map(previous);
          for (const row of rows) next.set(String(row.id), row);
          return next;
        });
      })
      .catch(() => {
        for (const id of missing) requested.current.delete(id);
      });
  }, [entries]);
  return songs;
};
