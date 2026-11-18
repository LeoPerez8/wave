/**
 * Playback: the queue the player bar plays, over the audio process. The queue, shuffle,
 * repeat, Undo, counted plays and the saved queue are Core's rules, run by
 * `@wave/client/playbackSession`; this service adds what is the desktop's own: the Library's
 * rows, the volume, and the scopes the window plays from.
 */
import { Database } from "@wave/client";
import { setFavorites } from "@wave/client/db/playHistory";
import { createPlaybackSession, type AudioPort } from "@wave/client/playbackSession";
import type { QueueState } from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Page } from "../../shared/bridge.ts";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { PlaybackCommand, PlayerView, QueueRow } from "../../shared/playerView.ts";
import { Player } from "../audio/player.ts";
import { browseSongs, browseTrackIds } from "../library/browse.ts";
import { DesktopLibrary } from "../library/library.ts";
import { preference, savePreference } from "../preferences.ts";

export interface PlaybackShape {
  /** What the player bar shows; cheap enough to poll. */
  readonly view: () => PlayerView;
  /**
   * Plays [scope]'s songs as a new queue: from row [index], or shuffled when [shuffle] is
   * true, or from the first song. A queue it replaces can come back with `undo`.
   */
  readonly start: (scope: BrowseScope, index?: number, shuffle?: boolean) => Promise<void>;
  /** A queue command: Next, Previous, shuffle, repeat, and the Queue's edits. */
  readonly command: (command: PlaybackCommand) => Promise<void>;
  readonly play: () => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly seek: (positionMs: number) => Promise<void>;
  /** Back to the queue the last `start` replaced, where it was. */
  readonly undo: () => Promise<void>;
  readonly dismissUndo: () => void;
  /** Stars or unstars the current song. */
  readonly favorite: () => void;
  /** Reads the songs' rows again, after something else changed them (a star, a removal). */
  readonly refresh: () => void;
  /** Sets the volume (0 to 1) and mute, kept across launches. */
  readonly volume: (value: number, muted: boolean) => Promise<void>;
  /** A page of the queue, History first. */
  readonly queue: (offset: number, limit: number) => Page<QueueRow>;
  /** Saves the position and the play so far. */
  readonly flush: () => Promise<void>;
}

export class Playback extends Context.Service<Playback, PlaybackShape>()(
  "@wave/desktop/Playback",
) {}

const savedVolume = (value: string | undefined): number => {
  const volume = Number(value ?? 1);
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
};

export const playbackLayer = Layer.effect(
  Playback,
  Effect.gen(function* () {
    const db = yield* Database;
    const player = yield* Player;
    const library = yield* DesktopLibrary;
    const run = Effect.runPromise;
    const audio: AudioPort = {
      load: (path, key) => run(player.load(path, key)),
      preload: (path, key) => run(player.preload(path, key)),
      play: () => run(player.play()),
      pause: () => run(player.pause()),
      seek: (positionMs) => run(player.seek(positionMs)),
      status: () => run(player.status()),
    };
    let error: string | null = null;
    let revision = 0;
    let lastQueue: QueueState | undefined;
    let undoOffer = 0;
    let volume = savedVolume(preference(db, "volume"));
    let muted = preference(db, "muted") === "true";
    const failed = (cause: unknown) => {
      error = cause instanceof Error ? cause.message : String(cause);
    };
    const session = yield* Effect.promise(() =>
      createPlaybackSession({
        db,
        audio,
        source: "desktop",
        available: (path) => !library.unavailable(path),
      }),
    );
    yield* Effect.promise(() => run(player.setVolume(muted ? 0 : volume)).catch(failed));
    const stop = player.subscribe((event) => {
      session.feed(event.status, event.transitions).catch(failed);
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        stop();
        await session.close().catch(failed);
      }),
    );

    const rows = (ids: readonly number[]): BrowseRow[] =>
      browseSongs(db, ids).map((song) => ({
        ...song,
        unavailable: song.path !== null && library.unavailable(song.path),
      }));
    /** The current song's row, read again only when the queue or a star changed. */
    let currentRow: { readonly revision: number; readonly row: BrowseRow | null } | undefined;
    const view = (): PlayerView => {
      const { queue, status, canUndo } = session.snapshot();
      if (queue !== lastQueue) {
        lastQueue = queue;
        revision++;
      }
      if (currentRow?.revision !== revision) {
        const entry = queue.entries[queue.index];
        currentRow = { revision, row: entry ? (rows([Number(entry.trackId)])[0] ?? null) : null };
      }
      return {
        status,
        current: currentRow.row,
        index: queue.index,
        length: queue.entries.length,
        shuffle: queue.shuffle,
        repeat: queue.repeat,
        undoOffer: canUndo ? undoOffer : null,
        volume,
        muted,
        revision,
        error,
      };
    };

    return {
      view,
      start: async (scope, index, shuffle) => {
        error = null;
        const ids = browseTrackIds(db, scope);
        const chosen = index === undefined ? undefined : ids[index];
        if (chosen !== undefined && rows([Number(chosen)])[0]?.unavailable)
          throw new Error("[folder-unavailable] Drive is not connected");
        await session.dispatch({
          type: "play",
          trackIds: ids,
          ...(index === undefined ? {} : { startIndex: index }),
          ...(shuffle === undefined ? {} : { shuffle }),
          context: { kind: scope.kind, id: scope.id === undefined ? null : String(scope.id) },
        });
        if (session.snapshot().canUndo) undoOffer++;
      },
      command: async (command) => {
        error = null;
        await session.dispatch(
          command.type === "previous"
            ? { ...command, positionMs: session.snapshot().status.positionMs }
            : command,
        );
      },
      play: session.play,
      pause: session.pause,
      seek: session.seek,
      undo: session.undo,
      dismissUndo: session.dismissUndo,
      favorite: () => {
        const current = view().current;
        if (current === null) return;
        setFavorites(db, [current.id], !current.favorite, Date.now());
        revision++;
      },
      refresh: () => {
        revision++;
      },
      volume: async (value, mute) => {
        await run(player.setVolume(mute ? 0 : value));
        volume = value;
        muted = mute;
        savePreference(db, "volume", String(value));
        savePreference(db, "muted", String(mute));
      },
      queue: (offset, limit) => {
        const { queue } = session.snapshot();
        const entries = queue.entries.slice(offset, offset + limit);
        const songs = new Map(
          rows(entries.map((entry) => Number(entry.trackId))).map((song) => [song.id, song]),
        );
        return {
          offset,
          total: queue.entries.length,
          items: entries.flatMap((entry, n) => {
            const song = songs.get(Number(entry.trackId));
            const at = offset + n;
            return song
              ? [
                  {
                    ...song,
                    key: entry.key,
                    history: at < queue.index,
                    current: at === queue.index,
                  },
                ]
              : [];
          }),
        };
      },
      flush: session.flush,
    };
  }),
);
