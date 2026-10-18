import {
  MAGIC_QUEUE_CONTEXT,
  isMagicQueue,
  libraryTrackIds,
  magicBatch,
  magicPlaySignal,
  magicQueueEdits,
  magicQueueLabel,
  magicSignal,
  parseMagicSession,
  parseTrackId,
  startMagicQueue as startSession,
  wantsMagicBatch,
  type MagicSeed,
  type MagicSession,
  type MagicSignalKind,
  type MagicSong,
  type QueueState,
  ytTrackId,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { onStarred, onYtSongSignal } from "@/library/libraryChanges";
import {
  LibraryStore,
  songHasFile,
  type SongRow,
} from "@/library/LibraryStore";
import { YtMusic } from "@/ytmusic/YtMusic";

import { keepMagicRadioSeed, magicRadioCandidates } from "./magicQueueRadio";
import { Player } from "./Player";
import { onPlayEnded } from "./PlayHistory";
import { Queue, queueState, toQueueTrack, type QueueTrack } from "./Queue";
import { queueTracks, toYtQueueTrack } from "./queueTracks";
import { cacheYtCoversInBackground } from "./ytQueueTracks";

/**
 * The Magic Queue (docs/spec.md, Magic Queue): Core's engine picks the songs
 * and learns; this module starts a session from a long-press menu, feeds it
 * what happens (plays ending, stars, downloads, Up Next edits) and adds a
 * batch once the last recommendation plays, out of the Library and the
 * seed's YouTube Music radio (`magicQueueRadio`). The session is saved
 * beside the queue, so it goes on after Wave restarts, while the queue is
 * still its own.
 */

const KEY = "playback.magicQueue";

const readSaved = (): MagicSession | null => {
  try {
    const stored = Storage.getItemSync(KEY);
    return stored === null ? null : parseMagicSession(JSON.parse(stored));
  } catch {
    return null;
  }
};

/**
 * The latest Magic Queue session, kept after something else plays so Undo
 * on "New queue playing" can go back to it; it's only under way while the
 * queue is its own (`activeMagicSession`).
 */
const magicSession = makeExternalStore<MagicSession | null>(readSaved());

const save = (session: MagicSession): void => {
  magicSession.set(session);
  try {
    Storage.setItemSync(KEY, JSON.stringify(session));
  } catch {
    // Saving is best effort: the session goes on in memory.
  }
};

/** The Magic Queue session [state] is, if it's one. */
const activeMagicSession = (state: QueueState = queueState.get()): MagicSession | null => {
  const session = magicSession.get();
  return session !== null && isMagicQueue(session, state) ? session : null;
};

const labelNow = (): string | null => {
  const session = activeMagicSession();
  return session === null ? null : magicQueueLabel(session);
};

const subscribeLabel = (listener: () => void): (() => void) => {
  const stopQueue = queueState.subscribe(listener);
  const stopSession = magicSession.subscribe(listener);
  return () => {
    stopQueue();
    stopSession();
  };
};

/** "Magic Queue · from <seed>" while the queue is a Magic Queue, else null; re-renders on change. */
export const useMagicQueueLabel = (): string | null =>
  useSyncExternalStore(subscribeLabel, labelNow);

/** A Library song as the engine weighs it. */
const toMagicSong = (song: SongRow): MagicSong => ({
  trackId: String(song.id),
  artists: song.artistIds.map(String),
  genre: song.genre,
});

/** A YT Music song in the queue as the engine weighs it: by its YouTube Music artists. */
const queuedMagicSong = (track: QueueTrack): MagicSong => ({
  trackId: track.id,
  artists: track.artists ?? [track.artist],
  genre: null,
});

/** The Library songs that can play: what a Magic Queue grows from. */
const librarySongs = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const songs = yield* store.listSongs;
  return songs.filter(songHasFile);
});

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed): it replaces the queue (with Undo, as any play
 * does) with the seed's first song; the first 9 recommendations follow as
 * the session's first batch, once the seed's radio was read.
 */
export const startMagicQueue = (seed: MagicSeed, seedSongs: readonly SongRow[]) =>
  Effect.gen(function* () {
    const playable = seedSongs.filter(songHasFile);
    const started = startSession(seed, playable.map(toMagicSong), {
      id: String(Date.now()),
      random: Math.random,
    });
    const first = playable.find((song) => String(song.id) === started?.first);
    if (started === null || first === undefined) return;
    keepMagicRadioSeed(started.session.id, seed, playable);
    save(started.session);
    const queue = yield* Queue;
    yield* queue.dispatch(
      {
        type: "play",
        trackIds: [started.first],
        startIndex: 0,
        context: { kind: MAGIC_QUEUE_CONTEXT, id: started.session.id },
        shuffle: false,
      },
      [toQueueTrack(first)],
    );
  });

/** Runs [effect] on its own; the Magic Queue is best effort and never disturbs playback. */
const fork = (effect: Effect.Effect<void, unknown>): void => {
  Effect.runFork(Effect.ignore(effect));
};

/**
 * Follows the queue for the Magic Queue under way: plays ending (a skip
 * within 30 s, a song played through), stars, songs lined up by hand and
 * recommendations removed teach it; once Up Next holds no recommendation,
 * the next batch joins the end of the queue.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;
    const ytMusic = yield* YtMusic;
    const player = yield* Player;

    /** Teaches the session under way [kind] about each of [trackIds] it holds. */
    const learn = (kind: MagicSignalKind, trackIds: readonly string[]) =>
      Effect.gen(function* () {
        if (activeMagicSession() === null) return;
        const ids = libraryTrackIds(trackIds);
        const library = ids.length === 0 ? [] : yield* store.songsByIds(ids);
        const known = queueTracks.get();
        const streamed = trackIds.flatMap((id) => {
          const track = known.get(id);
          return track === undefined || parseTrackId(id)?.kind !== "yt"
            ? []
            : [queuedMagicSong(track)];
        });
        const songs = [...library.map(toMagicSong), ...streamed];
        const session = activeMagicSession();
        if (session === null || songs.length === 0) return;
        save(songs.reduce((learned, song) => magicSignal(learned, { kind, song }), session));
      });

    let filling = false;

    /** Adds the next batch once the session wants one (`wantsMagicBatch`). */
    const fill = Effect.gen(function* () {
      const session = activeMagicSession();
      if (filling || session === null || !wantsMagicBatch(session, queueState.get())) return;
      filling = true;
      const library = yield* Effect.provideService(librarySongs, LibraryStore, store);
      const yt = yield* magicRadioCandidates(session.id).pipe(
        Effect.provideService(LibraryStore, store),
        Effect.provideService(YtMusic, ytMusic),
      );
      // Signals may have come while the radio was read.
      const learned = activeMagicSession();
      if (learned?.id !== session.id) return;
      const batch = magicBatch(learned, library.map(toMagicSong), Math.random, yt);
      if (batch.trackIds.length === 0) return;
      save(batch.session);
      const tracks = new Map<string, QueueTrack>(
        library.map((song) => [String(song.id), toQueueTrack(song)]),
      );
      for (const candidate of yt)
        tracks.set(candidate.trackId, toYtQueueTrack(candidate.song, null));
      const songs = batch.trackIds.flatMap((id) => tracks.get(id) ?? []);
      yield* queue.dispatch({ type: "append", trackIds: songs.map((song) => song.id) }, songs);
      const picked = new Set(batch.trackIds);
      yield* cacheYtCoversInBackground(
        yt.filter((candidate) => picked.has(candidate.trackId)).map((candidate) => candidate.song),
      ).pipe(Effect.provideService(YtMusic, ytMusic), Effect.provideService(Player, player));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          filling = false;
        }),
      ),
    );

    let previous = queueState.get();
    const onQueue = (): void => {
      const state = queueState.get();
      const before = previous;
      previous = state;
      const session = activeMagicSession(state);
      if (session === null) return;
      const { added, removed } = magicQueueEdits(session, before, state);
      fork(
        Effect.gen(function* () {
          yield* learn("added", added);
          yield* learn("removed", removed);
          yield* fill;
        }),
      );
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const stops = [
          queueState.subscribe(onQueue),
          onPlayEnded((play) => {
            const kind = magicPlaySignal(play);
            if (kind !== null) fork(learn(kind, [play.trackId]));
          }),
          onYtSongSignal((kind, videoIds) => {
            const held = new Set(queueState.get().entries.map((entry) => entry.trackId));
            fork(learn(kind, videoIds.map(ytTrackId).filter((id) => held.has(id))));
          }),
          onStarred((trackIds) => {
            const held = new Set(queueState.get().entries.map((entry) => entry.trackId));
            const starred = trackIds.map(String).filter((id) => held.has(id));
            fork(learn("favorite", starred));
          }),
        ];
        // A Magic Queue picked back up at launch may want its batch already.
        onQueue();
        return stops;
      }),
      (stops) =>
        Effect.sync(() => {
          for (const stop of stops) stop();
        }),
    );
  }),
);
