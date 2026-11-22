/**
 * A player session over a platform's audio process: the queue, Undo, counted
 * plays and the saved queue follow Core's rules, and the audio process only
 * plays, pauses, seeks and preloads the song Core says comes next.
 */
import {
  EMPTY_PLAY_TRACKER,
  EMPTY_QUEUE,
  REAL_SHUFFLE,
  RECAP_PLAY_CONTEXT,
  currentEntry,
  explicitPassOver,
  movedToFollowing,
  openedFilePath,
  parseTrackId,
  playSoFar,
  queueUndo,
  queueWrite,
  queuedPassedOver,
  reduceQueue,
  restorePlayback,
  savedQueueState,
  trackPlays,
  undoneQueue,
  type PassOver,
  type PlayEvent,
  type PlaySource,
  type PlaybackSignal,
  type QueueCommand,
  type QueueEntry,
  type QueuePersistenceState,
  type QueueResult,
  type QueueState,
  type QueueUndo,
  type QueueWrite,
  type Shuffle,
  type YtAlbumSong,
} from "@wave/core";

import type { LibraryDatabase } from "./db/database.ts";
import { endPlay, recordPlay, updatePlay } from "./db/playHistory.ts";
import { loadPlayback, savePlayback } from "./db/playback.ts";
import { selectPlayableSongs } from "./db/tracks.ts";
import { makeExternalStore } from "./externalStore.ts";
import { observePlayCheckpoints } from "./playCheckpoints.ts";
import { observeQueueSaves } from "./queueSaves.ts";

/** What the audio process reports. */
export interface AudioStatus {
  readonly state: "idle" | "paused" | "playing" | "ended";
  readonly positionMs: number;
  readonly durationMs?: number | undefined;
  /** The queue entry the loaded song plays. */
  readonly key?: string | undefined;
  readonly device?: string | undefined;
  /**
   * When the audio process took this report, in wall-clock ms. A report older
   * than one already taken in is out of date and is ignored.
   */
  readonly observedAtMs?: number | undefined;
}

/**
 * What the audio process did by itself at [atMs]: moved on to the preloaded
 * song [key] with no gap (`gapless`, the default) or started fading it in
 * under the current one (`crossfade`); or the song fading out, [key], went
 * silent or was cut off by a seek (`fadeEnded`).
 */
export interface AudioTransition {
  readonly key: string;
  readonly atMs: number;
  readonly kind?: "gapless" | "crossfade" | "fadeEnded" | undefined;
}

/** How the audio process plays a song it loads or lines up. */
export interface AudioSongOptions {
  /** Normalize Volume's gain for the song, settled as it starts; none plays it as it is. */
  readonly gainDb?: number | undefined;
  /** Whether the current song ending on its own may crossfade into it; never with repeat one. */
  readonly fade?: boolean | undefined;
}

/**
 * The platform's audio process. `preload` lines up the song that follows the
 * current one, for a gapless move or a crossfade (with no path, nothing); it
 * never disturbs the current song.
 */
export interface AudioPort {
  readonly load: (path: string, key: string, options?: AudioSongOptions) => Promise<AudioStatus>;
  readonly preload: (
    path?: string,
    key?: string,
    options?: AudioSongOptions,
  ) => Promise<AudioStatus>;
  readonly play: () => Promise<AudioStatus>;
  readonly pause: () => Promise<AudioStatus>;
  readonly seek: (positionMs: number) => Promise<AudioStatus>;
  readonly status: () => Promise<AudioStatus>;
}

export interface SessionSnapshot {
  readonly queue: QueueState;
  readonly status: AudioStatus;
  /** "New queue playing" offers Undo. */
  readonly canUndo: boolean;
  readonly undoQueue?: QueueState;
}

/**
 * A queue command (Core's `QueueCommand`). Previous with no position goes by the one the session
 * holds when the command's turn comes, which a caller can't know while another command runs.
 */
export type SessionCommand =
  | Exclude<QueueCommand, { readonly type: "previous" }>
  | { readonly type: "previous"; readonly positionMs?: number | undefined };

export interface PlaybackSession {
  readonly snapshot: () => SessionSnapshot;
  /**
   * A queue command; a play replacing a queue offers Undo. When the song it moves to won't
   * load, the queue still changes, nothing plays, and the call rejects.
   */
  readonly dispatch: (command: SessionCommand) => Promise<void>;
  /** Plays the queue's current song, loading it first when the audio process doesn't hold it. */
  readonly play: () => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly seek: (positionMs: number) => Promise<void>;
  /** Back to the queue the last play replaced; it rejects as `dispatch` does. */
  readonly undo: () => Promise<void>;
  readonly dismissUndo: () => void;
  /** What the audio process pushed: its status and the moves and fades since its last report. */
  readonly feed: (status: AudioStatus, transitions?: readonly AudioTransition[]) => Promise<void>;
  /**
   * Normalize Volume learned a song's value: the song lined up next plays at
   * it, and the current one from its next start.
   */
  readonly gainsChanged: () => Promise<void>;
  /** Don't play explicit turned on: removes explicit songs from the active and borrowed queues. */
  readonly dropExplicit: () => Promise<void>;
  /**
   * While on, each song ends paused: nothing is lined up after it, and once it ends the next
   * song waits paused at its start (the sleep timer's End of track).
   */
  readonly pauseAtTrackEnd: (on: boolean) => Promise<void>;
  /**
   * Borrows the player for a Recap's music: notes the queue as it is now and where the player
   * is in its current song, for the loan to give back.
   */
  readonly borrow: () => Promise<QueueLoan>;
  /** Saves the position and the play so far, as before quitting. */
  readonly flush: () => Promise<void>;
  /** Pauses, saves, and ends the play open; the session does nothing more. */
  readonly close: () => Promise<void>;
}

/** The player borrowed from the queue (`PlaybackSession.borrow`). */
export interface QueueLoan {
  /**
   * Plays the song [trackId] on its own, in place of the queue. It offers no Undo, its play is
   * never recorded (Core's `RECAP_PLAY_CONTEXT`), and the saved queue stays the one borrowed.
   */
  readonly play: (trackId: string) => Promise<void>;
  /**
   * Puts the borrowed queue back at its saved position, paused. A queue played meanwhile stays
   * instead.
   */
  readonly giveBack: () => Promise<void>;
}

export interface PlaybackSessionDeps {
  readonly db: LibraryDatabase;
  readonly audio: AudioPort;
  /** Where plays started on this platform come from. */
  readonly source: PlaySource;
  readonly now?: () => number;
  /** Whether the file behind a song can be read now. */
  readonly available?: (path: string) => boolean;
  readonly shuffle?: (state: QueueState, command: QueueCommand) => Shuffle;
  /**
   * A YT Music song's details, by video id, when the platform streams them. Its queue entry
   * (`yt:<videoId>`) plays from the path `yt:<videoId>`, which the audio process fetches; an
   * unknown one is skipped as unplayable. Without it, the queue holds Library songs only.
   */
  readonly streamed?: (videoId: string) => YtAlbumSong | undefined;
  /**
   * Whether a file outside the Library can be read now, when the platform opens files. Its queue
   * entry (`file:<path>`, Core's `openedFileTrackId`) plays from that path and records no play;
   * one that can't be read is skipped as unplayable, as every such entry is without this.
   */
  readonly openedFile?: (path: string) => boolean;
  /** The snapshot changed. */
  readonly changed?: () => void;
  readonly playEnded?: (play: PlayEvent, byNext: boolean) => void;
  /**
   * Playback stopped by itself: a song ended while `pauseAtTrackEnd` was on (`trackEnd`), or
   * the queue played out (`queueEnd`).
   */
  readonly stopped?: (why: "trackEnd" | "queueEnd") => void;
  /** Normalize Volume's gain in dB for [entry] of [queue] (Core's `entryGain`, or typical gain). */
  readonly gainDb?: (queue: QueueState, entry: QueueEntry) => number | undefined;
  /**
   * Whether Don't play explicit is on (docs/spec.md, "Explicit songs"): the queue then passes
   * over the songs marked explicit, Library and YT Music ones alike (Core's `explicitPassOver`).
   */
  readonly dontPlayExplicit?: () => boolean;
}

const unavailable = () => new Error("[folder-unavailable] Song is unavailable");

/**
 * Opens the session and restores the saved queue, paused where it was
 * (story 34). Every call runs after the ones before it.
 */
export const createPlaybackSession = async (
  deps: PlaybackSessionDeps,
): Promise<PlaybackSession> => {
  const { db, audio } = deps;
  const now = deps.now ?? Date.now;
  const available = deps.available ?? (() => true);
  let queue = EMPTY_QUEUE;
  let status: AudioStatus = { state: "idle", positionMs: 0 };
  let observedAt = -Infinity;
  let takeBack: QueueUndo | null = null;
  /** What Core does when the current song ends, worked out once so the preloaded song is the one played. */
  let planned: QueueResult | null = null;
  let tracker = EMPTY_PLAY_TRACKER;
  let lastSaved: QueuePersistenceState | null = null;
  let lane = Promise.resolve();
  let closed = false;
  let holdNext = false;
  /** The queue a Recap's music borrowed the player from, until it is given back. */
  let lent:
    | (QueuePersistenceState & {
        readonly takeBack: QueueUndo | null;
      })
    | null = null;
  /** While the player holds a Recap's song, the borrowed queue is the one we save. */
  const queueOnLoan = () => (queue.context?.kind === RECAP_PLAY_CONTEXT.kind ? lent : null);
  const rowIds = new Map<string, number>();

  const identity = (play: PlayEvent) => `${play.trackId}:${play.startedAt}`;
  const streamedSong = (id: string): YtAlbumSong | undefined => {
    const ref = parseTrackId(id);
    return ref?.kind === "yt" ? deps.streamed?.(ref.videoId) : undefined;
  };
  /** Where the audio process reads the song [id] from, when it can now. */
  const pathOf = (id: string): string | undefined => {
    const file = openedFilePath(id);
    if (file !== null) return deps.openedFile?.(file) === true ? file : undefined;
    if (parseTrackId(id)?.kind === "yt") return streamedSong(id) === undefined ? undefined : id;
    const path = selectPlayableSongs(db, [Number(id)])[0]?.path;
    return path && available(path) ? path : undefined;
  };
  const playable = (id: string) => pathOf(id) !== undefined;
  /** The songs Don't play explicit keeps out of the queue now. */
  const explicit: PassOver = (id) =>
    explicitPassOver({
      on: deps.dontPlayExplicit?.() ?? false,
      flagOf: (trackId) =>
        parseTrackId(trackId)?.kind === "yt"
          ? streamedSong(trackId)?.explicit
          : selectPlayableSongs(db, [Number(trackId)])[0]?.explicit,
    })(id);
  const passOver: PassOver = (id) => !playable(id) || explicit(id);
  const currentKey = () => currentEntry(queue)?.key;
  const plannedKey = () =>
    planned === null || planned.playback === "stop" ? undefined : currentEntry(planned.state)?.key;

  const playback = makeExternalStore({ isPlaying: false });
  const settled = makeExternalStore<QueueWrite | null>(null);
  const saves = observeQueueSaves({
    playback,
    settled,
    positionMs: () => queueOnLoan()?.positionMs ?? status.positionMs,
    saveQueue: (write) => savePlayback(db, write, now()),
    savePosition: (positionMs) => {
      if (queueOnLoan() === null) savePlayback(db, { positionMs }, now());
    },
  });
  const checkpoint = () => {
    const play = playSoFar(tracker, now());
    const id = play === null ? undefined : rowIds.get(identity(play));
    if (play !== null && id !== undefined) updatePlay(db, id, play);
  };
  const stopCheckpoints = observePlayCheckpoints(playback, checkpoint);

  const feedSignal = (signal: PlaybackSignal) => {
    const result = trackPlays(tracker, signal);
    tracker = result.state;
    for (const step of result.steps) {
      // A file outside the Library is nobody's song: its play is neither kept nor told.
      if (openedFilePath(step.play.trackId) !== null) continue;
      if (step.type === "started") {
        rowIds.set(
          identity(step.play),
          recordPlay(db, step.play, false, streamedSong(step.play.trackId)),
        );
        continue;
      }
      const id = rowIds.get(identity(step.play));
      if (id !== undefined) endPlay(db, id, step.play);
      rowIds.delete(identity(step.play));
      deps.playEnded?.(step.play, step.byNext);
    }
  };
  const writeQueue = (next: QueuePersistenceState) => {
    settled.set(queueWrite(lastSaved, next));
    lastSaved = next;
  };
  const save = () => {
    if (queueOnLoan() === null) writeQueue({ state: queue, positionMs: status.positionMs });
  };
  /** Takes a report in, unless one taken later already superseded it. */
  const accept = (next: AudioStatus, at = now()): boolean => {
    if (next.observedAtMs !== undefined) {
      if (next.observedAtMs < observedAt) return false;
      observedAt = next.observedAtMs;
    }
    status = next;
    const entry = currentEntry(queue);
    feedSignal({
      type: "state",
      at,
      key: entry?.key ?? null,
      status: next.state === "ended" ? "ended" : next.state === "idle" ? "idle" : "ready",
      playing: next.state === "playing",
      durationMs: next.durationMs ?? null,
      track:
        entry === null
          ? null
          : {
              trackId: entry.trackId,
              context: entry.contextIndex === null ? null : queue.context,
              source: deps.source,
            },
    });
    playback.set({ isPlaying: next.state === "playing" });
    if (next.state !== "playing") checkpoint();
    deps.changed?.();
    return true;
  };
  const reduce = (command: QueueCommand, state = queue) =>
    reduceQueue(
      state,
      command,
      Math.random,
      deps.shuffle?.(state, command) ?? REAL_SHUFFLE,
      passOver,
    );
  /** Works out the song that follows and has the audio process preload it. */
  const prepare = async () => {
    planned = reduce({ type: "trackEnded" });
    const key = plannedKey();
    const entry = key === undefined ? null : currentEntry(planned.state);
    const path = entry === null ? undefined : pathOf(entry.trackId);
    if (holdNext || path === undefined || entry === null || key === undefined) {
      await audio.preload(undefined, undefined);
      return;
    }
    await audio.preload(path, key, {
      gainDb: deps.gainDb?.(planned.state, entry),
      // Repeat one plays the song again without a fade (docs/spec.md, story 22a).
      fade: queue.repeat !== "one",
    });
  };
  /** The player leaves the current entry for [to]'s current one. */
  const leave = (
    to: QueueState,
    reason: "auto" | "repeat" | "seek" | "playlist" | "crossfade",
    at = now(),
  ) => {
    const from = currentKey() ?? null;
    const toKey = currentEntry(to)?.key ?? null;
    feedSignal({
      type: "transition",
      at,
      key: toKey,
      reason,
      toFollowing: reason === "seek" && movedToFollowing(to, from, toKey),
    });
  };
  /** The song ended by itself and the player went on to what Core planned. */
  const followPlan = (at: number, crossfade = false) => {
    const next = planned!.state;
    leave(next, crossfade ? "crossfade" : queue.repeat === "one" ? "repeat" : "auto", at);
    queue = next;
  };
  const loadCurrent = async (positionMs = 0, play = false) => {
    const entry = currentEntry(queue);
    const path = entry === null ? undefined : pathOf(entry.trackId);
    if (entry === null || path === undefined) throw unavailable();
    accept(await audio.load(path, entry.key, { gainDb: deps.gainDb?.(queue, entry) }));
    if (positionMs > 0) accept(await audio.seek(positionMs));
    await prepare();
    if (play) accept(await audio.play());
    save();
  };
  /**
   * Loads the queue's current song after a move to it. When it won't load, the audio process
   * still holds the song before it: that one stops, nothing is lined up, and the failure is
   * thrown once the change is saved and told.
   */
  const loadMoved = async (positionMs: number, play: boolean) => {
    try {
      await loadCurrent(positionMs, play);
    } catch (cause) {
      planned = null;
      await audio.pause().catch(() => undefined);
      await audio.preload().catch(() => undefined);
      accept({ state: "idle", positionMs: 0 });
      save();
      throw cause;
    }
  };
  const restart = async (pause: boolean) => {
    feedSignal({
      type: "seek",
      at: now(),
      key: currentKey() ?? null,
      fromMs: status.positionMs,
      toMs: 0,
    });
    accept(await audio.seek(0));
    if (pause) accept(await audio.pause());
  };
  const serial = (run: () => Promise<void>): Promise<void> => {
    const result = lane.then(() => (closed ? undefined : run()));
    lane = result.catch(() => {});
    return result;
  };

  const saved = loadPlayback(db);
  const savedState = saved === null ? null : savedQueueState(saved.parts);
  const restored =
    saved === null || savedState === null
      ? null
      : restorePlayback(savedState, saved.positionMs, playable);
  saves.start();
  if (restored !== null) {
    queue = restored.state;
    try {
      await loadCurrent(restored.positionMs);
    } catch {
      status = { state: "idle", positionMs: restored.positionMs };
    }
  }

  const applyCommand = async (given: SessionCommand) => {
    const before = queue;
    const previous = currentEntry(queue);
    const latest = await audio.status();
    // The audio process's position is newer than the last one reported.
    if (latest.key === currentKey()) accept(latest);
    const command: QueueCommand =
      given.type === "previous"
        ? { type: "previous", positionMs: given.positionMs ?? status.positionMs }
        : given;
    const result = reduce(command);
    if (command.type === "play") {
      // A queue played over a Recap's song has nothing to go back to.
      takeBack =
        queueOnLoan() !== null
          ? null
          : queueUndo(
              before,
              command,
              { key: previous?.key ?? null, positionMs: status.positionMs },
              result,
              passOver,
            );
    }
    const entry = currentEntry(result.state);
    const moved = entry?.key !== previous?.key || result.playback === "play";
    if (moved) leave(result.state, command.type === "play" ? "playlist" : "seek");
    queue = result.state;
    if (entry === null) {
      await audio.pause();
      await audio.preload();
      planned = null;
      accept({ state: "idle", positionMs: 0 });
    } else if (moved) {
      await loadMoved(0, result.playback === "play" || status.state === "playing");
    } else if (result.playback === "restart" || result.playback === "stop") {
      await restart(result.playback === "stop");
      await prepare();
    } else await prepare();
    save();
    deps.changed?.();
  };

  const session: PlaybackSession = {
    snapshot: () => ({
      queue,
      status,
      canUndo: takeBack !== null,
      ...(takeBack ? { undoQueue: takeBack.state } : {}),
    }),
    dispatch: (given) => serial(() => applyCommand(given)),
    play: () =>
      serial(async () => {
        if (currentEntry(queue) === null) return;
        // A song that wouldn't load left the audio process without the queue's current one.
        if (status.state === "idle") await loadCurrent(status.positionMs, true);
        else accept(await audio.play());
        save();
      }),
    pause: () =>
      serial(async () => {
        accept(await audio.pause());
        save();
      }),
    seek: (positionMs) =>
      serial(async () => {
        feedSignal({
          type: "seek",
          at: now(),
          key: currentKey() ?? null,
          fromMs: status.positionMs,
          toMs: positionMs,
        });
        accept(await audio.seek(positionMs));
        save();
      }),
    undo: () =>
      serial(async () => {
        if (takeBack === null) return;
        const undo = takeBack;
        takeBack = null;
        const next = undoneQueue(undo, queue);
        if (currentEntry(next)?.key === currentKey()) {
          queue = next;
          await prepare();
          save();
          deps.changed?.();
          return;
        }
        leave(next, "playlist");
        queue = next;
        await loadMoved(undo.positionMs, true);
      }),
    dismissUndo: () => {
      takeBack = null;
      deps.changed?.();
    },
    feed: (next, transitions = []) =>
      serial(async () => {
        let followed = false;
        for (const transition of transitions) {
          if (transition.kind === "fadeEnded") {
            feedSignal({ type: "fadeEnded", at: transition.atMs });
            continue;
          }
          if (transition.key !== plannedKey()) continue;
          followPlan(transition.atMs, transition.kind === "crossfade");
          const durationMs = next.key === transition.key ? next.durationMs : undefined;
          accept(
            { state: "playing", positionMs: 0, key: transition.key, durationMs },
            transition.atMs,
          );
          followed = true;
        }
        if (
          next.key !== undefined &&
          next.key !== currentKey() &&
          next.key === plannedKey() &&
          // One taken before the queue last moved is from the song it left, which may be the
          // one lined up again (Previous from the next song): it isn't a move.
          (next.observedAtMs === undefined || next.observedAtMs >= observedAt)
        ) {
          // The move's own report went missing; the audio process is on the next song all the same.
          followPlan(now());
          followed = true;
        }
        if (followed) {
          await prepare();
          save();
        }
        if (next.key === undefined || next.key !== currentKey()) return;
        if (!accept(next) || next.state !== "ended") return;
        if (planned === null || planned.playback === "stop") {
          // The end of the queue stays paused at the start of its last song, as Core's stop says.
          await restart(true);
          save();
          deps.stopped?.("queueEnd");
          return;
        }
        if (holdNext) {
          followPlan(now());
          try {
            await loadCurrent(0, false);
          } catch {
            accept({ state: "idle", positionMs: 0 });
          }
          deps.stopped?.("trackEnd");
          return;
        }
        // Nothing was preloaded (it failed, or the audio process restarted): load what Core planned.
        followPlan(now());
        try {
          await loadCurrent(0, true);
        } catch {
          accept({ state: "idle", positionMs: 0 });
        }
      }),
    pauseAtTrackEnd: (on) =>
      serial(async () => {
        if (holdNext === on) return;
        holdNext = on;
        if (planned !== null) await prepare();
      }),
    gainsChanged: () =>
      serial(async () => {
        if (planned !== null) await prepare();
      }),
    borrow: async () => {
      await serial(async () => {
        if (lent !== null) return;
        const latest = await audio.status();
        if (latest.key === currentKey()) accept(latest);
        save();
        saves.savePositionNow();
        lent = { state: queue, positionMs: status.positionMs, takeBack };
      });
      return {
        play: (trackId) =>
          serial(async () => {
            if (lent === null) return;
            const result = reduce({
              type: "play",
              trackIds: [trackId],
              context: RECAP_PLAY_CONTEXT,
              shuffle: false,
            });
            takeBack = null;
            leave(result.state, "playlist");
            queue = result.state;
            try {
              await loadMoved(0, true);
            } finally {
              deps.changed?.();
            }
          }),
        giveBack: () =>
          serial(async () => {
            if (lent === null) return;
            const back = lent;
            const playedRecap = queueOnLoan() !== null;
            lent = null;
            if (!playedRecap) return;
            takeBack = back.takeBack;
            leave(back.state, "playlist");
            queue = back.state;
            try {
              if (currentEntry(queue) === null) {
                await audio.pause();
                await audio.preload();
                planned = null;
                accept({ state: "idle", positionMs: 0 });
                save();
              } else {
                // Paused before the load, so the queue's song doesn't sound from its start.
                accept(await audio.pause());
                await loadMoved(back.positionMs, false);
              }
            } finally {
              deps.changed?.();
            }
          }),
      };
    },
    dropExplicit: () =>
      serial(async () => {
        if (lent !== null) {
          const trackIds = queuedPassedOver(lent.state, explicit);
          if (trackIds.length > 0) {
            const { state } = reduce({ type: "removeTracks", trackIds }, lent.state);
            const positionMs =
              currentEntry(state)?.key === currentEntry(lent.state)?.key ? lent.positionMs : 0;
            lent = { ...lent, state, positionMs };
            if (queueOnLoan() !== null) writeQueue(lent);
          }
        }
        const trackIds = queuedPassedOver(queue, explicit);
        if (trackIds.length > 0) await applyCommand({ type: "removeTracks", trackIds });
      }),
    flush: () =>
      serial(async () => {
        const latest = await audio.status();
        if (latest.key === currentKey()) accept(latest);
        checkpoint();
        save();
        saves.savePositionNow();
      }),
    close: () =>
      serial(async () => {
        if (status.state !== "idle") accept(await audio.pause());
        checkpoint();
        save();
        saves.savePositionNow();
        feedSignal({
          type: "state",
          at: now(),
          key: null,
          status: "idle",
          playing: false,
          durationMs: null,
          track: null,
        });
        saves.stop();
        stopCheckpoints();
        closed = true;
      }),
  };
  return session;
};
