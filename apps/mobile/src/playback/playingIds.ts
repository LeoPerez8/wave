/** One live playing-recording query shared by every retained list. Free of React/native code. */
import {
  createLibraryQueries,
  recordingMatches,
  playingTrackIds,
  type LibraryChange,
  type LibrarySongKey,
  type YtSong,
} from "@wave/core";
import type { ExternalStore } from "../lib/externalStore.ts";

export interface PlayingTarget {
  readonly id: string | null;
  readonly song: YtSong | null;
}

const targetKey = ({ id, song }: PlayingTarget): string =>
  JSON.stringify([id, song?.videoId, song?.title, song?.artists, song?.durationMs]);

export const createPlayingIds = (options: {
  readonly target: Pick<ExternalStore<PlayingTarget>, "get" | "subscribe">;
  readonly read: (song: YtSong) => Promise<{ readonly id: number } | null>;
  readonly onDownload: (listener: (song: LibrarySongKey) => void) => () => void;
  readonly onSavedRecordings: (listener: (songs: readonly LibrarySongKey[]) => void) => () => void;
  readonly onLibraryChange: (listener: (change: LibraryChange) => void) => () => void;
}) => {
  const listeners = new Set<() => void>();
  let snapshot: ReadonlySet<string> = new Set();
  let selected = options.target.get();
  let key = "";
  let localId: number | null = null;
  let stop: (() => void) | null = null;
  let sourceRefreshes = 0;
  let reads = 0;

  const publish = (target: PlayingTarget, local: { readonly id: number } | null): void => {
    const next = playingTrackIds(target.id, target.song, () => local);
    if (next.length === snapshot.size && next.every((id) => snapshot.has(id))) return;
    snapshot = new Set(next);
    for (const listener of listeners) listener();
  };

  const start = (): (() => void) => {
    const definitions = new Map<string, YtSong>();
    const registry = createLibraryQueries<{ readonly id: number } | null>({
      now: Date.now,
      schedule: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      read: (queryKey, settle) => {
        const song = definitions.get(queryKey);
        if (song === undefined) {
          settle({ ok: false });
          return;
        }
        reads++;
        // Even a synchronous SQLite reader starts outside the source writer/navigation callback.
        setTimeout(() => {
          void options.read(song).then(
            (value) => settle({ ok: true, value }),
            () => settle({ ok: false }),
          );
        }, 0);
      },
      dropped: (queryKey) => {
        definitions.delete(queryKey);
      },
      limits: { retainMs: 0, maxRetained: 0 },
    });
    let attached: ReturnType<typeof registry.attach> | null = null;
    const follow = (): void => {
      const next = options.target.get();
      const nextKey = targetKey(next);
      if (nextKey === key) return;
      attached?.detach();
      attached = null;
      key = nextKey;
      selected = next;
      localId = null;
      // Never show the previous recording's local row while a new lookup is in flight.
      publish(next, null);
      if (next.song === null || next.id !== `yt:${next.song.videoId}`) return;
      definitions.set(nextKey, next.song);
      attached = registry.attach(
        nextKey,
        { tracks: true },
        {
          visible: true,
          onChange: () => {
            if (key !== nextKey) return;
            const result = registry.current(nextKey);
            if (result === undefined) return;
            localId = result.value?.id ?? null;
            publish(next, result.value);
          },
        },
      );
    };
    key = "";
    follow();
    const stopTarget = options.target.subscribe(follow);
    const stopDownload = options.onDownload((recording) => {
      if (selected.song === null || selected.id !== `yt:${selected.song.videoId}`) return;
      if (!recordingMatches(recording, selected.song)) return;
      sourceRefreshes++;
      registry.change({ kind: "tracks" });
    });
    const stopSaved = options.onSavedRecordings((recordings) => {
      const song = selected.song;
      if (song === null || selected.id !== `yt:${song.videoId}`) return;
      if (!recordings.some((recording) => recordingMatches(recording, song))) return;
      // New matches have no known id yet. Filter committed metadata before any SQL;
      // multiple matching saves share the registry's scan throttle.
      registry.change({ kind: "tracks", burst: true });
    });
    const stopChanges = options.onLibraryChange((change) => {
      // A scan can retag the matched row. Ignore unrelated ids and unnamed bursts.
      if (
        localId !== null &&
        change.kind === "tracks" &&
        (change.ids === undefined ? !change.burst : change.ids.includes(localId))
      )
        registry.change(change);
    });
    return () => {
      stopTarget();
      stopDownload();
      stopSaved();
      stopChanges();
      attached?.detach();
      key = "";
    };
  };

  return {
    get: (): ReadonlySet<string> => {
      if (stop === null) {
        const target = options.target.get();
        // An unmounted store follows no source and keeps no potentially stale Library match.
        const next = playingTrackIds(target.id, target.song, () => null);
        if (next.length !== snapshot.size || next.some((id) => !snapshot.has(id)))
          snapshot = new Set(next);
      }
      return snapshot;
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      if (stop === null) stop = start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    },
    stats: () => ({ sourceRefreshes, reads, consumers: listeners.size }),
  };
};
