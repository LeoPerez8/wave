/**
 * Playback: the queue the player bar plays, over the audio process. The queue, shuffle,
 * repeat, Undo, counted plays and the saved queue are Core's rules, run by
 * `@wave/client/playbackSession`; this service adds what is the desktop's own: the Library's
 * rows, the volume, the scopes the window plays from, and Settings › Playback (Crossfade,
 * Normalize Volume and the measurements it needs, Buffer).
 */
import { Database } from "@wave/client";
import { saveMeasurement, selectSongsToMeasure } from "@wave/client/db/loudness";
import { setFavorites } from "@wave/client/db/playHistory";
import { createPlaybackSession, type AudioPort } from "@wave/client/playbackSession";
import { createQueueGains, queueAlbum } from "@wave/client/queueGains";
import { createSongMeasurements } from "@wave/client/songMeasurements";
import {
  parseTrackId,
  ytTrackId,
  type PlayEvent,
  type QueueCommand,
  type QueueState,
  type SleepTimer,
  type SleepTimerChoice,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Page } from "../../shared/bridge.ts";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { PlaybackCommand, PlayerView, QueueRow } from "../../shared/playerView.ts";
import { ytRow } from "../../shared/yt.ts";
import type { PlaybackSettings } from "../../shared/playbackSettings.ts";
import { Player } from "../audio/player.ts";
import { browseSongs, browseTrackIds } from "../library/browse.ts";
import { DesktopLibrary } from "../library/library.ts";
import { preference, savePreference } from "../preferences.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { streamedWithinBuffer } from "./bufferAhead.ts";
import { readPlaybackSettings, savePlaybackSettings } from "./playbackSettings.ts";
import { createSleepTimer } from "./sleepTimer.ts";

export interface PlaybackShape {
  /** What the player bar shows; cheap enough to poll. */
  readonly view: () => PlayerView;
  /**
   * Plays [scope]'s songs as a new queue: from row [index], or shuffled when [shuffle] is
   * true, or from the first song. A queue it replaces can come back with `undo`.
   */
  readonly start: (scope: BrowseScope, index?: number, shuffle?: boolean) => Promise<void>;
  /** Plays YouTube Music songs a search found, from [index], as a new queue. */
  readonly startYt: (videoIds: readonly string[], index: number) => Promise<void>;
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
  /**
   * Reads the songs' rows again, after something else changed them (a star, a removal), and
   * tells the account's sync.
   */
  readonly refresh: () => void;
  /** Sets the volume (0 to 1) and mute, kept across launches. */
  readonly volume: (value: number, muted: boolean) => Promise<void>;
  /** A page of the queue, History first. */
  readonly queue: (offset: number, limit: number) => Page<QueueRow>;
  /** Saves the position and the play so far. */
  readonly flush: () => Promise<void>;
  /** Hears a play that ended and a star that changed: the Wave account's sync sends them. */
  readonly subscribe: (listener: (change: PlaybackChange) => void) => () => void;
  /** Settings › Playback as the account holds them. */
  readonly settings: () => PlaybackSettings;
  /** Keeps the owner's change to Settings › Playback; it applies from the next song. */
  readonly setSettings: (change: Partial<PlaybackSettings>) => Promise<PlaybackSettings>;
  /** Plays by the stored settings again, after sync pulled the account's values. */
  readonly applySettings: () => Promise<void>;
  /**
   * Starts a sleep timer, replacing the running one; null cancels it. End of queue also means
   * nothing adds songs to a queue that plays out.
   */
  readonly setSleepTimer: (choice: SleepTimerChoice | null) => Promise<SleepTimer | null>;
  readonly sleepTimer: () => SleepTimer | null;
  /** The queue as Core holds it. */
  readonly queueState: () => QueueState;
  /** Whether the queue's current song is playing. */
  readonly playing: () => boolean;
  /** A queue command from main (the Magic Queue's); a new queue offers Undo, as `start` does. */
  readonly dispatch: (command: QueueCommand) => Promise<void>;
  /** Hears the queue change and plays end, until the returned function is called. */
  readonly watch: (watcher: QueueWatcher) => () => void;
}

/** What follows the queue from main: the Magic Queue. */
export interface QueueWatcher {
  /** The queue changed, or its song started playing. */
  readonly queueChanged: () => void;
  readonly playEnded: (play: PlayEvent, byNext: boolean) => void;
}

export type PlaybackChange = "played" | "starred";

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
    const yt = yield* YtMusic;
    const run = Effect.runPromise;
    const audio: AudioPort = {
      load: (path, key, options) => run(player.load(path, key, options?.gainDb)),
      preload: (path, key, options) =>
        run(player.preload(path, key, options?.gainDb, options?.fade)),
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
    const listeners = new Set<(change: PlaybackChange) => void>();
    const watchers = new Set<QueueWatcher>();
    const tell = (change: PlaybackChange) => {
      for (const listener of listeners) listener(change);
    };
    const failed = (cause: unknown) => {
      error = cause instanceof Error ? cause.message : String(cause);
    };
    const gains = createQueueGains(db);
    let settings = readPlaybackSettings(db);
    /** Playback is shutting down: nothing more is measured, as the Library is closing. */
    let closing = false;
    let stoppedBy: (why: "trackEnd" | "queueEnd") => void = () => {};
    const session = yield* Effect.promise(() =>
      createPlaybackSession({
        db,
        audio,
        source: "desktop",
        available: (path) => !library.unavailable(path),
        streamed: yt.song,
        playEnded: (play, byNext) => {
          tell("played");
          for (const watcher of watchers) watcher.playEnded(play, byNext);
        },
        stopped: (why) => stoppedBy(why),
        gainDb: gains.gainDb,
      }),
    );
    const sleep = createSleepTimer({
      now: Date.now,
      pause: session.pause,
      pauseAtTrackEnd: session.pauseAtTrackEnd,
      schedule: (ms, run) => {
        const handle = setTimeout(run, ms);
        return () => clearTimeout(handle);
      },
    });
    stoppedBy = (why) => void sleep.stopped(why).catch(failed);
    // Normalize Volume's measurements: the queue's songs with no value of their own, one at a
    // time, the song playing and the next ones first (Core's `songsToMeasure`).
    const measurements = createSongMeasurements({
      on: () => !closing && settings.normalizeVolume,
      queue: () =>
        Effect.sync(() => {
          const state = session.snapshot().queue;
          return { state, album: queueAlbum(db, state) };
        }),
      songsToMeasure: (ids) => Effect.sync(() => selectSongsToMeasure(db, ids)),
      measure: player.measure,
      cancel: () => void run(player.cancelMeasurements()).catch(() => undefined),
      save: (song, measurement) => Effect.sync(() => saveMeasurement(db, song, measurement)),
      learned: () => {
        gains.changed();
        session.gainsChanged().catch(failed);
      },
    });
    /** How long a song plays, for the Buffer; null while nothing says. */
    const lengthOf = (trackId: string): number | null => {
      const ref = parseTrackId(trackId);
      if (ref?.kind === "yt") return yt.song(ref.videoId)?.durationMs ?? null;
      return ref?.kind === "library" ? (browseSongs(db, [ref.id])[0]?.durationMs ?? null) : null;
    };
    let bufferSent: string | undefined;
    /** Tells the audio process which YT Music songs the Buffer reaches, when that changed. */
    const sendBuffer = () => {
      const videoIds = streamedWithinBuffer(
        session.snapshot().queue,
        settings.bufferMinutes,
        lengthOf,
      );
      const sending = videoIds.join(" ");
      if (sending === bufferSent) return;
      bufferSent = sending;
      run(player.buffer(videoIds)).catch(() => {
        if (bufferSent === sending) bufferSent = undefined;
      });
    };
    /**
     * The queue changed: songs it brought in may need measuring, the Buffer may reach other
     * songs, and the Magic Queue hears it.
     */
    const queueChanged = () => {
      void measurements.wake().catch(() => undefined);
      sendBuffer();
      for (const watcher of watchers) watcher.queueChanged();
    };
    /** Sends the stored settings to the engine; each applies from its next move. */
    const sendSettings = async () => {
      await run(player.setCrossfade(settings.crossfadeSeconds));
      await run(player.setNormalize(settings.normalizeVolume));
    };
    /** Plays by [next] from here, measuring or not as its Normalize Volume says. */
    const playBySettings = async (next: typeof settings) => {
      const switched = next.normalizeVolume !== settings.normalizeVolume;
      settings = next;
      await sendSettings();
      sendBuffer();
      if (switched) measurements.switched();
    };
    yield* Effect.promise(() => run(player.setVolume(muted ? 0 : volume)).catch(failed));
    yield* Effect.promise(() => sendSettings().catch(failed));
    queueChanged();
    let queueFed = session.snapshot().queue;
    let playingFed = false;
    const stop = player.subscribe((event) => {
      session
        .feed(event.status, event.transitions)
        .then(() => {
          const { queue, status } = session.snapshot();
          const startedPlaying = status.state === "playing" && !playingFed;
          playingFed = status.state === "playing";
          if (queue === queueFed && !startedPlaying) return;
          queueFed = queue;
          queueChanged();
        })
        .catch(failed);
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        closing = true;
        sleep.close();
        stop();
        await session.close().catch(failed);
      }),
    );

    const rows = (ids: readonly number[]): BrowseRow[] =>
      browseSongs(db, ids).map((song) => ({
        ...song,
        unavailable: song.path !== null && library.unavailable(song.path),
      }));
    /** Each entry's row, Library songs read in one go; songs nothing knows are left out. */
    const rowsOf = (trackIds: readonly string[]): (BrowseRow | undefined)[] => {
      const refs = trackIds.map(parseTrackId);
      const songs = new Map(
        rows(refs.flatMap((ref) => (ref?.kind === "library" ? [ref.id] : []))).map((song) => [
          song.id,
          song,
        ]),
      );
      return refs.map((ref) => {
        if (ref?.kind === "library") return songs.get(ref.id);
        const song = ref?.kind === "yt" ? yt.song(ref.videoId) : undefined;
        return song === undefined ? undefined : ytRow(song);
      });
    };
    /** Keeps the queue's YT Music songs for the next launch, after anything that changes it. */
    const keepQueued = () => yt.keepQueued(session.snapshot().queue.entries);
    /** The current song's row, read again only when the queue or a star changed. */
    let currentRow: { readonly revision: number; readonly row: BrowseRow | null } | undefined;
    /** The last finished scan seen: it can bring tag values, and files to try measuring again. */
    let scanSeen = library.status().revision;
    const view = (): PlayerView => {
      const scan = library.status();
      if (scan.status === "done" && scan.revision !== scanSeen) {
        scanSeen = scan.revision;
        gains.changed();
        measurements.scanned();
      }
      const { queue, status, canUndo } = session.snapshot();
      if (queue !== lastQueue) {
        lastQueue = queue;
        revision++;
      }
      if (currentRow?.revision !== revision) {
        const entry = queue.entries[queue.index];
        currentRow = { revision, row: entry ? (rowsOf([entry.trackId])[0] ?? null) : null };
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
        sleepTimer: sleep.current(),
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
        // A song from Search plays alone, as on the phone with YT Music off.
        const alone = scope.kind === "search" && chosen !== undefined;
        await session.dispatch({
          type: "play",
          trackIds: alone ? [chosen] : ids,
          ...(index === undefined ? {} : { startIndex: alone ? 0 : index }),
          ...(shuffle === undefined ? {} : { shuffle }),
          context:
            scope.kind === "search"
              ? { kind: "search", id: null }
              : { kind: scope.kind, id: scope.id === undefined ? null : String(scope.id) },
        });
        if (session.snapshot().canUndo) undoOffer++;
        keepQueued();
        queueChanged();
      },
      startYt: async (videoIds, index) => {
        error = null;
        if (videoIds.some((videoId) => yt.song(videoId) === undefined))
          throw new Error("[yt-unknown] That song isn't in the search results anymore");
        await session.dispatch({
          type: "play",
          trackIds: videoIds.map(ytTrackId),
          startIndex: index,
          context: { kind: "search", id: null },
        });
        if (session.snapshot().canUndo) undoOffer++;
        keepQueued();
        queueChanged();
      },
      command: async (command) => {
        error = null;
        await session.dispatch(
          command.type === "previous"
            ? { ...command, positionMs: session.snapshot().status.positionMs }
            : command,
        );
        keepQueued();
        queueChanged();
      },
      play: async () => {
        await session.play();
        await sleep.resumed();
      },
      pause: session.pause,
      seek: session.seek,
      undo: async () => {
        await session.undo();
        keepQueued();
        queueChanged();
      },
      dismissUndo: session.dismissUndo,
      favorite: () => {
        const current = view().current;
        // A YT Music song isn't the Library's; starring it comes with its own ticket.
        if (current === null || current.videoId !== undefined) return;
        setFavorites(db, [current.id], !current.favorite, Date.now());
        revision++;
        tell("starred");
      },
      refresh: () => {
        revision++;
        // A star from a song's menu or the selection bar goes up as the player's does.
        tell("starred");
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
        const songs = rowsOf(entries.map((entry) => entry.trackId));
        return {
          offset,
          total: queue.entries.length,
          items: entries.flatMap((entry, n) => {
            const song = songs[n];
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
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      settings: () => settings,
      setSettings: async (change) => {
        await playBySettings(savePlaybackSettings(db, change, Date.now()));
        return settings;
      },
      applySettings: () => playBySettings(readPlaybackSettings(db)),
      queueState: () => session.snapshot().queue,
      playing: () => session.snapshot().status.state === "playing",
      dispatch: async (command) => {
        error = null;
        await session.dispatch(command);
        if (command.type === "play" && session.snapshot().canUndo) undoOffer++;
        keepQueued();
        queueChanged();
      },
      watch: (watcher) => {
        watchers.add(watcher);
        return () => void watchers.delete(watcher);
      },
      setSleepTimer: async (choice) => {
        await sleep.set(choice);
        // Turning End of Queue off lets a waiting Magic Queue batch join at once.
        for (const watcher of watchers) watcher.queueChanged();
        return sleep.current();
      },
      sleepTimer: sleep.current,
    };
  }),
);
