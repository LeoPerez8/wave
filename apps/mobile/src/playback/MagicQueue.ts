import {
  GENRE_FAITHFULNESS_STEPS,
  MAGIC_QUEUE_CONTEXT,
  genreProfile,
  isMagicQueue,
  magicBatchEmpty,
  magicBatchFailed,
  magicBatchLine,
  magicBatchLoading,
  magicPickDue,
  magicPickEnded,
  magicBatchRadios,
  magicLibrarySongs,
  magicListSeedSongs,
  completeMagicRadioBatch,
  magicPlaySignal,
  magicQueueEdits,
  magicQueueLabel,
  magicQueueShare,
  magicSignal,
  parseMagicSession,
  sliderStepLabel,
  startMagicQueue as startSession,
  wantsMagicBatch,
  type MagicBatchOutcome,
  type MagicSeed,
  type MagicSeedSong,
  type MagicSession,
  type MagicSignalKind,
  type QueueState,
  type YtSong,
  ytTrackId,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { magicProfileOf } from "@/home/artistGenres";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { discoverLevel, discoverSliders } from "@/lib/discoverSettings";
import { makeExternalStore, subscribeAll } from "@/lib/externalStore";
import { oneAtATime } from "@/lib/oneAtATime";
import { onStarred, onYtSongSignal } from "@/library/libraryChanges";
import { LibraryStore, songHasFile, type SongRow, type ArtistRow } from "@/library/LibraryStore";
import { YtMusic } from "@/ytmusic/YtMusic";
import { appLog } from "@/log/appLog";
import { ytMusicEnabled } from "@/settings/ytMusic";

import { magicQueueYtCandidates } from "./magicQueueRadio";
import { magicSignalsOf } from "./magicSongs";
import { Player } from "./Player";
import { onPlayEnded } from "./PlayHistory";
import { Queue, queueState, toQueueTrack, type QueueTrack } from "./Queue";
import { toYtQueueTrack } from "./queueTracks";
import { latestTasteProfile, tasteProfileForRecommendation } from "./TasteProfile";
import { cacheYtCoversInBackground } from "./ytQueueTracks";

/**
 * The Magic Queue (docs/spec.md, Magic Queue): Core's engine picks the songs
 * and learns; this module starts a session from a long-press menu, feeds it
 * what happens (plays ending, stars, downloads, Up Next edits) and adds a
 * batch once the last recommendation plays, out of the Library and the
 * candidate catalog (`magicQueueRadio`), after every signal so far
 * was learned. The session is saved beside the queue, so it goes on after
 * Wave restarts, while the queue is still its own.
 */

const KEY = "playback.magicQueue";
let startingLibrary: {
  readonly songs: readonly SongRow[];
  readonly artists: readonly ArtistRow[];
} = { songs: [], artists: [] };

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

const subscribeLabel = subscribeAll(queueState, magicSession);

/** "Magic Queue · from <seed>" while the queue is a Magic Queue, else null; re-renders on change. */
export const useMagicQueueLabel = (): string | null =>
  useSyncExternalStore(subscribeLabel, labelNow);

/**
 * The id of the session a batch is being picked for, from the moment it's
 * wanted until it's added, fails, times out or turns out not to be wanted;
 * null while none is.
 */
const picking = makeExternalStore<MagicSession["id"] | null>(null);
const failedBatch = makeExternalStore<MagicSession["id"] | null>(null);
/** The id of the session whose last pick found no songs (`magicBatchEmpty`, `magicPickDue`); null while none has. */
const emptyBatch = makeExternalStore<MagicSession["id"] | null>(null);
const retryBatch = makeExternalStore(0);

/** Try Again only asks the active Magic Queue for its missing batch, after a failed or an empty pick. */
export const retryMagicBatch = (): void => {
  emptyBatch.set(null);
  retryBatch.update((attempt) => attempt + 1);
};

const batchFailedNow = (): boolean =>
  magicBatchFailed(activeMagicSession(), failedBatch.get(), queueState.get());
const subscribeBatchFailed = subscribeAll(queueState, magicSession, failedBatch);

export const useMagicBatchFailed = (): boolean =>
  useSyncExternalStore(subscribeBatchFailed, batchFailedNow);

const emptySeedNow = (): string | null => {
  const session = activeMagicSession();
  return magicBatchEmpty(session, emptyBatch.get(), queueState.get())
    ? (session?.seed.title ?? null)
    : null;
};
const subscribeBatchEmpty = subscribeAll(queueState, magicSession, emptyBatch);

/**
 * The seed's title while Up Next says the Magic Queue under way found no
 * songs (`magicBatchEmpty`), else null. Re-renders on change.
 */
export const useMagicBatchEmptySeed = (): string | null =>
  useSyncExternalStore(subscribeBatchEmpty, emptySeedNow);

const batchLoadingNow = (): boolean =>
  magicBatchLoading(activeMagicSession(), picking.get(), queueState.get());

const subscribeBatchLoading = subscribeAll(queueState, magicSession, picking);

/**
 * Whether the Magic Queue under way is picking its next batch, which Up Next
 * still waits for (`magicBatchLoading`): false once the batch lands, the
 * picking ends, or something else plays. Re-renders on change.
 */
export const useMagicBatchLoading = (): boolean =>
  useSyncExternalStore(subscribeBatchLoading, batchLoadingNow);

/** When the current batch first became wanted, including starting the seed's queue. */
let batchStart: { readonly id: string; readonly at: number; readonly first: boolean } | null = null;

/** How many of the seed songs' video ids a session keeps: its song radio reads the first. */
const SEED_VIDEO_IDS = 5;

/**
 * Starts a Magic Queue from [seed], whose songs are [seedSongs] (the song
 * itself for a song seed) and, for a playlist, its [streamedSongs]: it
 * replaces the queue (with Undo, as any play does) with the seed's first
 * Library song; the first 9 recommendations follow as the session's first
 * batch, at once when the radios it reads were saved, else once they were
 * read. Recommendations follow the song's radio for a song, the artist's for
 * an artist, and for an album or a playlist the radios of a few of its songs,
 * streamed ones included, drawn again each batch by their counted plays
 * (`magicBatchRadios`), streamed plays included; known genres only rank them.
 * YouTube Music's share of a batch starts at Discover's New music level
 * (`discoverLevel`), from Home or any long-press menu.
 */
export const startMagicQueue = (
  seed: MagicSeed,
  seedSongs: readonly SongRow[],
  streamedSongs: readonly YtSong[] = [],
) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return;
    const startedAt = Date.now();
    const playable = seedSongs.filter(songHasFile);
    // An album's or a playlist's songs are all radio seeds, with or without a file.
    const list = seed.kind === "album" || seed.kind === "playlist";
    const radioSongs = list ? seedSongs : playable;
    const store = yield* LibraryStore;
    const artists = yield* store.artistsByIds([
      ...new Set(radioSongs.flatMap((song) => song.artistIds)),
    ]);
    // A seed whose artists YouTube Music doesn't know grows from its own song radio (`seedVideoIds`).
    const videoIds = yield* store
      .videoIds(radioSongs.map((song) => song.id))
      .pipe(Effect.orElseSucceed((): ReadonlyMap<number, string> => new Map()));
    const streamed = list ? streamedSongs : [];
    const plays = list
      ? yield* store
          .songCountedPlays([
            ...seedSongs.map((song) => String(song.id)),
            ...streamed.map((song) => ytTrackId(song.videoId)),
          ])
          .pipe(Effect.orElseSucceed((): ReadonlyMap<string, number> => new Map()))
      : new Map<string, number>();
    const names = new Map(artists.map((artist) => [artist.id, artist.name]));
    const listSeedSongs = (): MagicSeedSong[] =>
      magicListSeedSongs(
        [
          ...seedSongs.map((song) => ({
            source: "library" as const,
            track: {
              id: song.id,
              title: song.title,
              artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
              durationMs: song.durationMs,
              ...(videoIds.get(song.id) === undefined ? {} : { videoId: videoIds.get(song.id)! }),
            },
          })),
          ...streamed.map((song) => ({ source: "stream" as const, song })),
        ],
        plays,
      );
    const started = startSession(seed, playable.map(magicLibrarySongs(artists)), {
      id: String(Date.now()),
      random: Math.random,
      radio: {
        artists: playable.flatMap((song) => song.artistIds.flatMap((id) => names.get(id) ?? [])),
        ...(list
          ? { songs: listSeedSongs() }
          : playable[0] === undefined
            ? {}
            : {
                song: {
                  id: seed.kind === "artist" ? `artist:${seed.id}` : `song:${seed.id}`,
                  title: seed.kind === "track" ? seed.title : playable[0].title,
                  artists:
                    seed.kind === "artist"
                      ? [seed.title]
                      : playable[0].artistIds.flatMap((id) => names.get(id) ?? []),
                  durationMs: playable[0].durationMs,
                  ...(videoIds.get(playable[0].id) === undefined
                    ? {}
                    : { videoId: videoIds.get(playable[0].id)! }),
                  ...(seed.kind === "artist" ? { kind: "artist" as const } : {}),
                },
              }),
        profile: genreProfile(playable),
        videoIds: playable.flatMap((song) => videoIds.get(song.id) ?? []).slice(0, SEED_VIDEO_IDS),
      },
      ytShare: magicQueueShare(discoverLevel.get()),
    });
    const first = playable.find((song) => String(song.id) === started?.first);
    if (started === null || first === undefined) return;
    startingLibrary = { songs: playable, artists };
    // Warm future picks without joining their derivation to this first batch.
    yield* Effect.forkDetach(
      recommendationSnapshot.get.pipe(
        Effect.flatMap(({ library }) => tasteProfileForRecommendation(library)),
        Effect.provideService(LibraryStore, store),
        Effect.ignore,
      ),
    );
    batchStart = { id: started.session.id, at: startedAt, first: true };
    save(started.session);
    // The first batch is on its way as the seed starts: Up Next shows it loading from the first frame.
    picking.set(started.session.id);
    failedBatch.set(null);
    emptyBatch.set(null);
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
 * The signals that ask an empty pick again (`magicPickDue`): a play's end or a
 * skip just moves through the queue, which the same inputs would answer alike.
 */
const ASKS_AGAIN: ReadonlySet<MagicSignalKind> = new Set(["favorite", "download", "added"]);

/**
 * Bumped by each ask for a batch again (a signal of `ASKS_AGAIN`, a slider
 * move): an empty pick under way meanwhile doesn't mark its session, it picks again.
 */
let asked = 0;

/**
 * Follows the queue for the Magic Queue under way: plays ending (Next
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
    const warmInputs = recommendationSnapshot.get.pipe(
      Effect.flatMap(({ library }) => tasteProfileForRecommendation(library)),
      Effect.provideService(LibraryStore, store),
      Effect.asVoid,
    );

    const pendingSignals = new Set<Promise<void>>();
    const waitForSignals = () => Effect.promise(() => Promise.all(pendingSignals));

    /** Teaches the session that was active when the owner acted. */
    const learn = (sessionId: string, kind: MagicSignalKind, trackIds: readonly string[]) =>
      Effect.gen(function* () {
        if (activeMagicSession() === null) return;
        const signals = yield* magicSignalsOf(kind, trackIds).pipe(
          Effect.provideService(LibraryStore, store),
        );
        const session = activeMagicSession();
        if (session?.id !== sessionId || signals.length === 0) return;
        save(signals.reduce((learned, signal) => magicSignal(learned, signal), session));
      });

    /** Learns [kind] about [trackIds] for the next available ranking. */
    const teach = (kind: MagicSignalKind, trackIds: readonly string[]): void => {
      const session = activeMagicSession();
      if (trackIds.length === 0 || session === null) return;
      const learned = Effect.runPromise(
        learn(session.id, kind, trackIds).pipe(Effect.catchCause(() => Effect.void)),
      );
      pendingSignals.add(learned);
      void learned.finally(() => {
        pendingSignals.delete(learned);
        // A star, a download or a song lined up by hand may find songs an empty pick didn't.
        if (activeMagicSession()?.id === session.id && ASKS_AGAIN.has(kind)) askAgain();
      });
    };

    /**
     * Picks [wanted]'s next batch, weighing every signal so far, and adds it
     * while still wanted; gives how it ended, for the app log (`magicBatchLine`).
     */
    const pick = (wanted: MagicSession, appended: (count: number) => void) =>
      Effect.gen(function* () {
        yield* waitForSignals();
        if (activeMagicSession()?.id !== wanted.id)
          return { kind: "dropped" } satisfies MagicBatchOutcome;
        fork(warmInputs);
        const latest = recommendationSnapshot.peek();
        const library = latest.library ?? startingLibrary;
        const catalog = latest.catalog ?? [];
        const graph = latest.graph;
        const taste = latestTasteProfile();
        const sliders = discoverSliders.get();
        const profileOf = magicProfileOf(library);
        // This batch's radios, drawn once for it and saved before they're read.
        const live = activeMagicSession();
        const drawn = magicBatchRadios(live?.id === wanted.id ? live : wanted, Math.random);
        if (live?.id === wanted.id && drawn.session !== live) save(drawn.session);
        const yt = yield* magicQueueYtCandidates(drawn.session, drawn.seeds, library, {
          catalog,
          graph,
          taste,
          sliders,
          profileOf,
          sessionNow: () => {
            const current = activeMagicSession();
            return current?.id === wanted.id ? current : drawn.session;
          },
        }).pipe(
          Effect.provideService(LibraryStore, store),
          Effect.provideService(YtMusic, ytMusic),
        );
        yield* waitForSignals();
        const session = activeMagicSession();
        if (session?.id !== wanted.id || !wantsMagicBatch(session, queueState.get()))
          return { kind: "dropped" } satisfies MagicBatchOutcome;
        const playable = library.songs.filter(songHasFile);
        const candidates = yt.candidates;
        const likedCandidates = yt.likedCandidates;
        const batch = completeMagicRadioBatch(session, candidates, likedCandidates);
        if (batch.trackIds.length === 0)
          return {
            kind: "empty",
            seedGenre: session.seedProfile !== null,
            step: sliderStepLabel(GENRE_FAITHFULNESS_STEPS, sliders.faithfulness),
            library: {
              weighed: playable.length,
              admitted: candidates.filter((song) => song.source === "library").length,
            },
            yt: { ranked: yt.ranked, eligible: yt.eligible },
            refill: yt.refilled,
          } satisfies MagicBatchOutcome;
        save(batch.session);
        const allCandidates = [...candidates, ...likedCandidates];
        const tracks = new Map<string, QueueTrack>(
          playable.map((song) => [String(song.id), toQueueTrack(song)]),
        );
        for (const candidate of allCandidates)
          if (candidate.source === "stream" && candidate.song !== null)
            tracks.set(candidate.trackId, toYtQueueTrack(candidate.song, null));
        const songs = batch.trackIds.flatMap((id) => tracks.get(id) ?? []);
        yield* queue.dispatch({ type: "append", trackIds: songs.map((song) => song.id) }, songs);
        const picked = new Set(batch.trackIds);
        appended(songs.length);
        yield* cacheYtCoversInBackground(
          allCandidates.flatMap((candidate) =>
            picked.has(candidate.trackId) &&
            candidate.source === "stream" &&
            candidate.song !== null
              ? [candidate.song]
              : [],
          ),
        ).pipe(Effect.provideService(YtMusic, ytMusic), Effect.provideService(Player, player));
        return { kind: "appended", songs: songs.length } satisfies MagicBatchOutcome;
      });

    /**
     * Picks a batch for the session under way if it wants one
     * (`wantsMagicBatch`); then whether to pick again (`magicPickEnded`):
     * another session took over while it was picked and wants its own.
     */
    const pickOnce = Effect.suspend(() => {
      const wanted = activeMagicSession();
      if (wanted === null || !magicPickDue(wanted, emptyBatch.get(), queueState.get()))
        return Effect.succeed(false);
      picking.set(wanted.id);
      failedBatch.set(null);
      let again = false;
      // Asked again while this pick ran: an empty outcome doesn't stand, it picks again.
      const askedBefore = asked;
      let askedMeanwhile = false;
      const timing =
        batchStart?.id === wanted.id
          ? batchStart
          : { id: wanted.id, at: Date.now(), first: wanted.used.length <= 1 };
      let logged = false;
      const log = (outcome: MagicBatchOutcome) => {
        if (logged) return;
        logged = true;
        if (batchStart === timing) batchStart = null;
        appLog(
          "info",
          "WaveTiming",
          magicBatchLine({ first: timing.first, ms: Date.now() - timing.at, outcome }),
        );
      };
      return pick(wanted, (songs) => log({ kind: "appended", songs })).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            log(outcome);
            if (outcome.kind === "empty") {
              if (asked === askedBefore) emptyBatch.set(wanted.id);
              else askedMeanwhile = true;
            } else if (outcome.kind === "appended") emptyBatch.set(null);
          }),
        ),
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log(
              Cause.hasInterruptsOnly(cause)
                ? { kind: "stopped" }
                : { kind: "failed", reason: String(Cause.squash(cause)) },
            );
            if (!Cause.hasInterruptsOnly(cause) && activeMagicSession()?.id === wanted.id)
              failedBatch.set(wanted.id);
          }),
        ),
        // However the picking ends: added, failed, timed out or no longer wanted.
        Effect.ensuring(
          Effect.sync(() => {
            // Interrupted from outside, past the catch above: its line still goes in.
            log({ kind: "stopped" });
            const ended = magicPickEnded(
              wanted.id,
              picking.get(),
              activeMagicSession(),
              queueState.get(),
            );
            picking.set(ended.picking);
            again = ended.again || askedMeanwhile;
          }),
        ),
        Effect.map(() => again),
      );
    });

    /**
     * Adds the next batch once the session wants one. Asked for again while
     * it runs, it does nothing (`oneAtATime`), so no two batches are picked
     * at once; a session started meanwhile gets its batch once it's done.
     */
    const fill = oneAtATime(
      Effect.gen(function* () {
        let again = yield* pickOnce;
        while (again) again = yield* pickOnce;
      }),
    );

    /** Clears an empty pick's mark and asks for the batch again: a new signal or a slider move. */
    const askAgain = (): void => {
      asked += 1;
      if (emptyBatch.get() === null) return;
      emptyBatch.set(null);
      fork(fill);
    };

    let previous = queueState.get();
    const onQueue = (): void => {
      const state = queueState.get();
      const before = previous;
      previous = state;
      const session = activeMagicSession(state);
      if (session === null) return;
      if (wantsMagicBatch(session, state) && batchStart?.id !== session.id)
        batchStart = { id: session.id, at: Date.now(), first: session.used.length <= 1 };
      const { added, removed } = magicQueueEdits(session, before, state);
      teach("added", added);
      teach("removed", removed);
      fork(fill);
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const stops = [
          queueState.subscribe(onQueue),
          retryBatch.subscribe(() => fork(fill)),
          discoverSliders.subscribe(askAgain),
          onPlayEnded((end) => {
            const kind = magicPlaySignal(end);
            if (kind !== null) teach(kind, [end.play.trackId]);
          }),
          onYtSongSignal((kind, videoIds) => teach(kind, videoIds.map(ytTrackId))),
          onStarred((trackIds) => teach("favorite", trackIds.map(String))),
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
