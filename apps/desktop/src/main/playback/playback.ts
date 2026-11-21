/**
 * Playback: the queue the player bar plays, over the audio process. The queue, shuffle,
 * repeat, Undo, counted plays and the saved queue are Core's rules, run by
 * `@wave/client/playbackSession`; this service adds what is the desktop's own: the Library's
 * rows, the volume, the scopes the window plays from, and Settings › Playback (Crossfade,
 * Normalize Volume and the measurements it needs, Buffer).
 */
import { Database } from "@wave/client";
import { saveMeasurement, selectSongsToMeasure } from "@wave/client/db/loudness";
import { selectMissingSongs } from "@wave/client/db/missingSongs";
import { setFavorites } from "@wave/client/db/playHistory";
import {
  createPlaybackSession,
  type AudioPort,
  type QueueLoan,
} from "@wave/client/playbackSession";
import { queueShuffle } from "@wave/client/queueShuffle";
import { createQueueGains, queueAlbum } from "@wave/client/queueGains";
import { createSongMeasurements } from "@wave/client/songMeasurements";
import {
  listPlay,
  missingSongYtSong,
  openedAudioFiles,
  openedFilePath,
  openedFileTitle,
  openedFilesQueue,
  parseTrackId,
  scanPath,
  scanPathKey,
  tappedMissingSong,
  skipMissingSongs,
  ytTrackId,
  type YtAlbumSong,
  type PlayEvent,
  type QueueCommand,
  type QueueState,
  type SleepTimer,
  type SleepTimerChoice,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { statSync } from "node:fs";
import { realpath } from "node:fs/promises";

import type { Page } from "../../shared/bridge.ts";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type {
  PlaybackTransport,
  PlayerView,
  PlayStart,
  QueueRow,
} from "../../shared/playerView.ts";
import { ytRow } from "../../shared/yt.ts";
import { PLAYABLE_EXTENSIONS } from "../../shared/playback.ts";
import type { OutputSettings, PlaybackSettings } from "../../shared/playbackSettings.ts";
import { Player } from "../audio/player.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import {
  browseSongs,
  browseTrackIds,
  playlistSongs,
  type PlaylistSong,
} from "../library/browse.ts";
import { DesktopLibrary } from "../library/library.ts";
import { preference, savePreference } from "../preferences.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { streamedStarred } from "../yt/streamedSong.ts";
import { streamedWithinBuffer } from "./bufferAhead.ts";
import { outputSettings, readOutput, saveOutput } from "./outputDevice.ts";
import { readPlaybackSettings, savePlaybackSettings } from "./playbackSettings.ts";
import { createSleepTimer } from "./sleepTimer.ts";
import { Downloads } from "../downloads/downloadsLayer.ts";

export interface PlaybackShape extends PlaybackTransport {
  readonly fileFailed: (id: number) => boolean;
  /** What the player bar shows; cheap enough to poll. */
  readonly view: () => PlayerView;
  /**
   * Plays [scope]'s songs as a new queue: from row [index], or shuffled when [shuffle] is
   * true, or from the first song. A queue it replaces can come back with `undo`.
   */
  readonly start: (scope: BrowseScope, index?: number, shuffle?: boolean) => Promise<PlayStart>;
  /**
   * Activates a song in a resolved list; missing songs download, then play after import. With
   * no [index] (Play, Shuffle), missing songs YouTube Music has stream while it's on.
   */
  readonly activate: (
    ids: readonly string[],
    index: number | undefined,
    context: NonNullable<QueueState["context"]>,
    shuffle?: boolean,
  ) => Promise<PlayStart>;
  /**
   * Activates the song at [index] of [songs], Library songs and streamed ones mixed, as a
   * playlist's page lists them: a Graveyard's songs.
   */
  readonly playEntries: (
    songs: readonly PlaylistSong[],
    index: number,
    context: NonNullable<QueueState["context"]>,
  ) => Promise<PlayStart>;
  /**
   * Plays the audio files among [paths] (absolute), in order, as a new queue: files opened with
   * Wave. A file the Library has plays as its song; any other plays without joining the Library.
   * Paths that aren't audio files, or aren't there, are ignored; false when none is left.
   */
  readonly openFiles: (paths: readonly string[]) => Promise<boolean>;
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
  /**
   * A page of the queue, History first. An entry whose song nothing knows has no row, so a row
   * is found by its `at`, never by where it sits in the page.
   */
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
  /** The system's outputs and the one picked for this computer. */
  readonly outputs: () => OutputSettings;
  /**
   * Moves playback to the output with [id], one the system has now, or back to the system's
   * default with null; the song goes on from where it is. Rejects an id the system doesn't have.
   */
  readonly setOutput: (id: string | null) => Promise<OutputSettings>;
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
  /**
   * A Recap's music (docs/spec.md, Recap): with nothing playing as the Recap opens, its stories'
   * songs play in place of the queue, on no record, and closing gives the queue back paused
   * where it was. With a song playing, the Recap leaves it alone.
   */
  readonly recap: {
    /** A Recap opened; [songs] is the Library song each of its stories plays, in story order. */
    readonly opened: (songs: readonly (number | null)[]) => Promise<void>;
    /** Story [index] shows. False when no open Recap has that story. */
    readonly story: (index: number) => Promise<boolean>;
    readonly closed: () => Promise<void>;
  };
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

/** Whether [path] is a file that can be read now. */
const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The most files outside the Library whose tags are kept in memory. */
const OUTSIDE_FILES_KEPT = 500;

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
    const downloads = yield* Downloads;
    const kotlin = yield* Kotlin;
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
        shuffle: queueShuffle({ db, kind: () => settings.shuffleKind, streamed: yt.song }),
        openedFile: isFile,
        playEnded: (play, byNext) => {
          tell("played");
          for (const watcher of watchers) watcher.playEnded(play, byNext);
        },
        stopped: (why) => stoppedBy(why),
        gainDb: gains.gainDb,
        dontPlayExplicit: () => settings.dontPlayExplicit,
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
    /**
     * Plays by [next] from here, measuring or not as its Normalize Volume says. Don't Play
     * Explicit turning on takes the queue's explicit songs out, and the Magic Queue hears
     * Continue with Magic Queue change.
     */
    const playBySettings = async (next: typeof settings) => {
      const switched = next.normalizeVolume !== settings.normalizeVolume;
      const explicitOff = next.dontPlayExplicit && !settings.dontPlayExplicit;
      const continues = next.continueQueue !== settings.continueQueue;
      settings = next;
      await sendSettings();
      sendBuffer();
      if (switched) measurements.switched();
      if (explicitOff) await moved(session.dropExplicit());
      else if (continues) queueChanged();
    };
    yield* Effect.promise(() => run(player.setVolume(muted ? 0 : volume)).catch(failed));
    yield* Effect.promise(() => sendSettings().catch(failed));
    const picked = readOutput(db);
    if (picked !== undefined)
      yield* Effect.promise(() => run(player.setOutput(picked.id)).catch(failed));
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
    /**
     * What the tags of files outside the Library say, read the first time a row is asked for;
     * undefined while the read runs or after it failed, and the row goes by the file's name.
     */
    const outsideTags = new Map<string, Partial<BrowseRow> | undefined>();
    const outsideRow = (path: string): BrowseRow => {
      if (!outsideTags.has(path)) {
        if (outsideTags.size >= OUTSIDE_FILES_KEPT) outsideTags.clear();
        outsideTags.set(path, undefined);
        run(kotlin.readTags(path)).then(
          (tags) => {
            if (!outsideTags.has(path)) return;
            outsideTags.set(path, {
              ...(tags.title ? { title: tags.title } : {}),
              artist: tags.artist ?? "",
              album: tags.album ?? "",
              durationMs: tags.durationMs,
            });
            revision++;
          },
          () => undefined,
        );
      }
      return {
        id: 0,
        outside: true,
        title: openedFileTitle(path),
        artist: "",
        album: "",
        artworkHash: null,
        durationMs: 0,
        count: 0,
        year: null,
        genre: null,
        trackNumber: null,
        favorite: false,
        path,
        unavailable: false,
        ...outsideTags.get(path),
      };
    };
    /** The Library song whose file is [path] (as `scanPath` spells it), when it can play. */
    const librarySong = (path: string): number | null => {
      let row = db.get<{ id: number }>(sql`SELECT id FROM tracks WHERE path = ${path}`);
      if (row === undefined && process.platform === "win32") {
        const key = scanPathKey(path, process.platform);
        row = db.get<{ id: number }>(
          sql`SELECT id FROM tracks WHERE wave_scan_path_key(path) = ${key} LIMIT 1`,
        );
      }
      return row !== undefined && browseSongs(db, [row.id])[0]?.path != null ? row.id : null;
    };
    /** Each entry's row, Library songs read in one go; songs nothing knows are left out. */
    const rowsOf = (trackIds: readonly string[]): (BrowseRow | undefined)[] => {
      const refs = trackIds.map(parseTrackId);
      const songs = new Map(
        rows(refs.flatMap((ref) => (ref?.kind === "library" ? [ref.id] : []))).map((song) => [
          song.id,
          song,
        ]),
      );
      return refs.map((ref, at) => {
        if (ref?.kind === "library") return songs.get(ref.id);
        const file = openedFilePath(trackIds[at]!);
        if (file !== null) return outsideRow(file);
        const song = ref?.kind === "yt" ? yt.song(ref.videoId) : undefined;
        return song === undefined
          ? undefined
          : { ...ytRow(song), favorite: streamedStarred(db, song) };
      });
    };
    /** Keeps the queue's YT Music songs for the next launch, after anything that changes it. */
    const keepQueued = () => {
      const { queue, undoQueue } = session.snapshot();
      yt.keepQueued(queue.entries, undoQueue?.entries);
    };
    /**
     * Follows a queue change the session was asked for, [replaced] when it plays a new queue.
     * The queue changes even when its song then won't load, so a failure is followed too.
     */
    const failedFiles = new Set<number>();
    const moved = async (change: Promise<void>, replaced = false) => {
      const before = session.snapshot().queue;
      try {
        await change;
        // A song counts as fixed once it loads again, not when Repeat or the like goes through.
        const queue = session.snapshot().queue;
        const current = queue.entries[queue.index];
        if (replaced || current !== before.entries[before.index])
          failedFiles.delete(Number(current?.trackId));
      } catch (cause) {
        const queue = session.snapshot().queue;
        const id = Number(queue.entries[queue.index]?.trackId);
        if (Number.isSafeInteger(id) && id > 0) {
          failedFiles.add(id);
          if (failedFiles.size > 200) failedFiles.delete(failedFiles.values().next().value!);
        }
        throw cause;
      } finally {
        const { queue, canUndo } = session.snapshot();
        if (replaced && canUndo && queue !== before) undoOffer++;
        keepQueued();
        queueChanged();
      }
    };
    let pending:
      | {
          ids: readonly string[];
          index: number;
          context: NonNullable<QueueState["context"]>;
          streams: readonly YtAlbumSong[] | undefined;
        }
      | undefined;
    const activate = async (
      ids: readonly string[],
      index: number | undefined,
      context: NonNullable<QueueState["context"]>,
      shuffle?: boolean,
      streams?: readonly YtAlbumSong[],
    ): Promise<PlayStart> => {
      pending = undefined;
      error = null;
      const songs = new Map(
        rowsOf(ids).flatMap((row, at) => (row ? [[ids[at]!, row] as const] : [])),
      );
      const chosen = index === undefined ? undefined : songs.get(ids[index]!);
      if (chosen?.unavailable) throw new Error("[folder-unavailable] Drive is not connected");
      const hasFile = (id: string) => {
        const song = songs.get(id);
        return (
          song !== undefined &&
          (song.videoId !== undefined || song.path !== null) &&
          !song.unavailable
        );
      };
      // A missing song: the account has it and this computer has no file (docs/spec.md).
      const isMissing = (id: string) => {
        const song = songs.get(id);
        return song !== undefined && song.path === null && song.videoId === undefined;
      };
      const missing = tappedMissingSong(ids, index, (id) => !isMissing(id));
      if (missing !== null) {
        const request = { ids, index: index!, context, streams };
        pending = request;
        try {
          await downloads.missing([Number(missing)]);
        } catch (cause) {
          if (pending === request) pending = undefined;
          throw cause;
        }
        return { kind: "downloading" };
      }
      /** The listed songs whose drive is disconnected. */
      const unavailable = ids.filter((id) => songs.get(id)?.unavailable === true).length;
      if (index === undefined)
        return playList(ids, context, shuffle, hasFile, isMissing, unavailable);
      const play = skipMissingSongs(ids, index, hasFile);
      if (play === null) return { kind: "nothing", missing: 0, unavailable };
      await moved(
        session.dispatch({
          type: "play",
          trackIds: [...play.songs],
          startIndex: play.startIndex,
          context,
          shuffle,
        }),
        true,
      );
      return { kind: "playing", streamed: 0, leftOut: 0 };
    };
    /**
     * A list's Play or Shuffle (Core's `listPlay`): its songs with a file and, with YT Music on,
     * its missing songs YouTube Music has, streamed in their place; the others are counted.
     */
    const playList = async (
      ids: readonly string[],
      context: NonNullable<QueueState["context"]>,
      shuffle: boolean | undefined,
      hasFile: (id: string) => boolean,
      isMissing: (id: string) => boolean,
      unavailable: number,
    ): Promise<PlayStart> => {
      const listed = ids.filter((id) => hasFile(id) || isMissing(id));
      const streams = new Map<string, YtAlbumSong>();
      if (yt.enabled())
        for (const track of selectMissingSongs(db, listed.filter(isMissing).map(Number))) {
          const song = missingSongYtSong(track);
          if (song !== null) streams.set(String(track.id), { ...song, albumId: null });
        }
      const play = listPlay(listed, { hasFile, streams: (id) => streams.has(id) });
      if (play.kind === "nothing")
        return { kind: "nothing", missing: play.missing.length, unavailable };
      await yt.withSongs(
        play.streamed.map((id) => streams.get(id)!),
        () =>
          moved(
            session.dispatch({
              type: "play",
              trackIds: play.songs.map((id) => {
                const stream = streams.get(id);
                return stream === undefined ? id : ytTrackId(stream.videoId);
              }),
              context,
              shuffle,
            }),
            true,
          ),
      );
      return { kind: "playing", streamed: play.streamed.length, leftOut: play.leftOut.length };
    };
    const stopImports = library.subscribe(() => {
      const request = pending;
      if (!request) return;
      const row = rowsOf([request.ids[request.index]!])[0];
      if (row?.path == null || row.unavailable) return;
      pending = undefined;
      const resume = () =>
        activate(request.ids, request.index, request.context, undefined, request.streams);
      void (request.streams ? yt.withSongs(request.streams, resume) : resume()).catch(failed);
    });
    yield* Effect.addFinalizer(() => Effect.sync(stopImports));
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

    /** The open Recap: each story's song, the one playing, and the queue it borrowed. */
    let recapOpen:
      | {
          readonly songs: readonly (number | null)[];
          readonly silent: boolean;
          playing: number | null;
          loan: QueueLoan | undefined;
        }
      | undefined;
    const recapClosed = async () => {
      const loan = recapOpen?.loan;
      recapOpen = undefined;
      if (loan !== undefined) await moved(loan.giveBack());
    };

    return {
      recap: {
        opened: async (songs) => {
          await recapClosed().catch(failed);
          recapOpen = {
            songs,
            silent: session.snapshot().status.state === "playing",
            playing: null,
            loan: undefined,
          };
        },
        story: async (index) => {
          const open = recapOpen;
          if (open === undefined || !(index in open.songs)) return false;
          const song = open.songs[index] ?? null;
          // The same song goes on playing; a story with no song of its own keeps the last one.
          if (open.silent || song === null || song === open.playing) return true;
          open.playing = song;
          open.loan ??= await session.borrow();
          // A song that won't load leaves the Recap silent.
          await moved(open.loan.play(String(song))).catch(() => undefined);
          return true;
        },
        closed: recapClosed,
      },
      fileFailed: (id) => failedFiles.has(id),
      view,
      activate,
      playEntries: (songs, index, context) => {
        error = null;
        const ids = songs.map((song) =>
          "song" in song ? ytTrackId(song.song.videoId) : String(song.trackId),
        );
        const streams = songs.flatMap((entry) => ("song" in entry ? [entry.song] : []));
        return yt.withSongs(streams, () =>
          activate(ids, index, context, undefined, streams.length > 0 ? streams : undefined),
        );
      },
      start: async (scope, index, shuffle) => {
        error = null;
        // A playlist with YT Music songs plays them in their places, as its page lists them.
        const mixed =
          scope.kind === "playlist" && scope.id !== undefined
            ? playlistSongs(db, scope.id, scope.find)
            : undefined;
        const ids =
          mixed?.map((song) =>
            "song" in song ? ytTrackId(song.song.videoId) : String(song.trackId),
          ) ?? browseTrackIds(db, scope);
        const chosen = index === undefined ? undefined : ids[index];
        if (index !== undefined && chosen === undefined) throw new Error("Invalid song position");
        // A song from Search plays alone; with YT Music on, main starts its Magic Queue instead
        // (`playSearchSong` in ytServices.ts).
        const alone = scope.kind === "search" && chosen !== undefined;
        const streams = mixed?.flatMap((entry) => ("song" in entry ? [entry.song] : []));
        const play = () =>
          activate(
            alone ? [chosen] : ids,
            alone ? 0 : index,
            scope.kind === "search"
              ? { kind: "search", id: null }
              : { kind: scope.kind, id: scope.id === undefined ? null : String(scope.id) },
            shuffle,
            streams,
          );
        return streams ? yt.withSongs(streams, play) : play();
      },
      startYt: async (videoIds, index, shuffle) => {
        pending = undefined;
        error = null;
        if (videoIds.some((videoId) => yt.song(videoId) === undefined))
          throw new Error("[yt-unknown] That song isn't in the search results anymore");
        const playing = session.dispatch({
          type: "play",
          trackIds: videoIds.map(ytTrackId),
          // Shuffle starts anywhere among them, as a Library list's does.
          startIndex: shuffle === true ? undefined : index,
          context: { kind: "search", id: null },
          ...(shuffle === true ? { shuffle } : {}),
        });
        await moved(playing, true);
      },
      command: async (command) => {
        pending = undefined;
        error = null;
        // Previous goes by the position the session holds when its turn comes.
        await moved(session.dispatch(command));
      },
      play: async () => {
        await session.play();
        await sleep.resumed();
      },
      pause: () => {
        pending = undefined;
        return session.pause();
      },
      seek: session.seek,
      undo: () => {
        pending = undefined;
        return moved(session.undo());
      },
      openFiles: async (paths) => {
        // The Library knows a file by its real path, as the scan read it.
        const files = await Promise.all(
          openedAudioFiles(paths, PLAYABLE_EXTENSIONS).map(async (path) =>
            scanPath(await realpath(path).catch(() => path), process.platform),
          ),
        );
        const trackIds = openedFilesQueue(files, librarySong).filter((id) => {
          const file = openedFilePath(id);
          return file === null || isFile(file);
        });
        if (trackIds.length === 0) return false;
        pending = undefined;
        error = null;
        await moved(
          session.dispatch({ type: "play", trackIds, context: { kind: "files", id: null } }),
          true,
        );
        return true;
      },
      dismissUndo: session.dismissUndo,
      favorite: () => {
        const current = view().current;
        // A YT Music song isn't the Library's; starring it comes with its own ticket.
        if (current === null || current.videoId !== undefined || current.outside) return;
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
                    at,
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
      outputs: () => outputSettings(player.outputs(), readOutput(db)),
      setOutput: async (id) => {
        const output = id === null ? undefined : player.outputs().find((it) => it.id === id);
        if (id !== null && output === undefined) throw new Error("Refused: unknown output");
        await run(player.setOutput(output?.id));
        saveOutput(db, output);
        return outputSettings(player.outputs(), output);
      },
      queueState: () => session.snapshot().queue,
      playing: () => session.snapshot().status.state === "playing",
      dispatch: async (command) => {
        pending = undefined;
        error = null;
        await moved(session.dispatch(command), command.type === "play");
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
