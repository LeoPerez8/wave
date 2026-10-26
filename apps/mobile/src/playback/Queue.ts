import {
  EMPTY_QUEUE,
  REAL_SHUFFLE,
  RECAP_PLAY_CONTEXT,
  answerPlayingWalk,
  applyPlayerSync,
  explicitPassOver,
  explicitPlayNotice,
  extrapolatePosition,
  keptPlayingEntry,
  keptQueue,
  keysToLoad,
  newQueueToast,
  noticeLine,
  parseQueueState,
  passedOverNotice,
  planPlayerSync,
  playerQueueList,
  queueSourceAfter,
  playReplacesQueue,
  queuedPassedOver,
  queueUndo,
  reduceQueue,
  shuffledTrackIds,
  shufflesQueue,
  songChangeCause,
  startPlayingWalk,
  undoneQueue,
  withHeldCurrent,
  type PassOver,
  type PlayerList,
  type PlayingStep,
  type PlayingWalk,
  type PlaySource,
  type QueueCommand,
  type QueueEntry,
  type QueuePlayback,
  type QueueState,
  type QueueUndo,
  type RepeatMode,
  type Shuffle,
  type SongChangeCause,
  type SyncStep,
  type UnsearchedSettlement,
  type YtAlbumSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore } from "@/library/LibraryStore";
import type { NativeSyncStep, PlayerItem } from "@/native/wavePlayer";
import { currentToast, dismissToast, showToast } from "@/overlay/toast";
import { perfMark } from "@/perf/perf";
import { dontPlayExplicit, onDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { shuffleKind } from "@/settings/shuffleKind";

import { Player, PlayerError, playbackState } from "./Player";
import { searchPlaying } from "./playingSearch";
import { learnQueueTracks, queueTracks, type QueueTrack } from "./queueTracks";

export { toQueueTrack, type QueueTrack } from "./queueTracks";

/** The queue as the app shows it (Up Next, shuffle and repeat toggles, the playing row). */
export const queueState = makeExternalStore<QueueState>(EMPTY_QUEUE);

/**
 * The entry the player was on when JS restarted while it kept going, and the
 * queue was picked back up from it; null otherwise. `PlayHistory` goes on with
 * the play on record for it instead of starting a new one.
 */
export const keptPlayingKey = makeExternalStore<string | null>(null);

/**
 * Where the queue's playback was started from: `auto` once Android Auto
 * started it (`Queue.handOver`), `phone` once the app did. Every play in the
 * queue is recorded with it (`PlayHistory`), whoever skips or pauses later.
 */
export const queueSource = makeExternalStore<PlaySource>("phone");

/** Queue changes come in bursts (skips, reorders); the queue is serialised once they settle. */
const QUEUE_SETTLE_MS = 500;

/**
 * The queue as JSON, serialised once per settled change and shared: the player
 * keeps it for when JS restarts, and `PlaybackPersistence` writes it to the library.
 */
export const settledQueue = makeExternalStore<string | null>(null);

export class Queue extends Context.Service<
  Queue,
  {
    /**
     * Runs a queue command and brings the native player in line. `tracks` must
     * describe every track id the command adds (play, Play Next, Add to Queue).
     */
    readonly dispatch: (
      command: QueueCommand,
      tracks?: readonly QueueTrack[],
    ) => Effect.Effect<void, PlayerError>;
    /**
     * Loads a queue saved before Wave's process ended, paused at [positionMs]
     * in its current entry. Does nothing (and returns false) when a queue is
     * already loaded, e.g. the player kept playing while JS restarted.
     * `tracks` must describe every track id in [state].
     */
    readonly restore: (
      state: QueueState,
      tracks: readonly QueueTrack[],
      positionMs: number,
    ) => Effect.Effect<boolean, PlayerError>;
    /**
     * Starts playback whose items the media session sets on the player itself
     * (a play request from Android Auto): instead of syncing the player,
     * returns every entry of the new queue as a player item and the one to
     * start at. `tracks` must describe every track id the command plays.
     */
    readonly handOver: (
      command: PlayCommand,
      tracks: readonly QueueTrack[],
    ) => Effect.Effect<QueueHandOver, PlayerError>;
    /** Serialises a queue change still settling right away (Wave is leaving the foreground). */
    readonly flush: Effect.Effect<void>;
    /**
     * Borrows the player for a Recap's music: notes the queue as it is now,
     * where the player is in its current song, for the loan to give back.
     */
    readonly borrow: Effect.Effect<QueueLoan>;
  }
>()("@wave/mobile/playback/Queue") {}

/** The player borrowed from the queue (`Queue.borrow`). */
export interface QueueLoan {
  /** Plays [track] on its own, in place of the queue, offering no Undo and kept off the play history. */
  readonly play: (track: QueueTrack) => Effect.Effect<void, PlayerError>;
  /** Puts the queue back as it was borrowed, paused where it was in its current song. */
  readonly giveBack: Effect.Effect<void, PlayerError>;
}

/** Starting playback of a list: the only command a session request hands over. */
export type PlayCommand = Extract<QueueCommand, { readonly type: "play" }>;

/** The player list a session request gets (see `Queue.handOver`). */
export interface QueueHandOver {
  readonly items: readonly PlayerItem[];
  readonly startIndex: number;
}

const toNative = (step: SyncStep): NativeSyncStep => {
  switch (step.type) {
    case "clear":
      return { type: "clear" };
    case "replace":
      return { type: "replace", keys: step.keys, index: step.index };
    case "seek":
      return { type: "seek", key: step.key, index: step.index };
    case "edit":
      return { type: "edit", at: step.at, removeCount: step.removeCount, keys: step.insertKeys };
  }
};

type PlayingSettlement = UnsearchedSettlement<YtAlbumSong>;

/** The playing song's search (`searchPlaying`); one given up counts as failed. */
const askPlaying = (trackId: string): Promise<PlayingSettlement> =>
  searchPlaying(trackId).then(
    (settled): PlayingSettlement => settled ?? { kind: "failed", reason: "failed" },
  );

/**
 * A play's way back to the queue it replaced (Core's `QueueUndo`), with the
 * tracks that queue knew and where its playback was started from.
 */
interface TakeBack {
  readonly undo: QueueUndo;
  readonly tracks: ReadonlyMap<string, QueueTrack>;
  readonly source: PlaySource;
  /** The play's own notice (a tapped explicit song skipped), said once the walk ends. */
  readonly notice: string | null;
}

/** The toast a new queue shows (Core's `newQueueToast`), with its Undo. */
interface NewQueue {
  readonly text: string;
  readonly takeBack: TakeBack;
}

/** A command waiting, outside the queue's lane, for its playing song's search (Core's `PlayingWalk`). */
interface Waiting {
  readonly walk: PlayingWalk;
  readonly trackId: string;
  readonly answer: Promise<PlayingSettlement>;
  /** The tracks the queue knew before the command: going back, the queue knows them again. */
  readonly knownBefore: ReadonlyMap<string, QueueTrack>;
  /** The Undo the new queue offers once it plays, if the command was a play. */
  readonly takeBack: TakeBack | null;
}

/** Where a command got to in the lane: done (go, stay, or another command took its place) or waiting. */
type Outcome =
  | {
      readonly kind: "go";
      readonly state: QueueState;
      readonly playback: QueuePlayback;
      /** Going there shows "New queue playing" with Undo. */
      readonly newQueue: NewQueue | null;
    }
  | { readonly kind: "stay" }
  | { readonly kind: "superseded" }
  | { readonly kind: "wait"; readonly waiting: Waiting };

type Done = Exclude<Outcome, { readonly kind: "wait" }>;

/** The player item for [entry], from the tracks the queue learned. */
const itemFor = (entry: QueueEntry): Effect.Effect<PlayerItem, PlayerError> => {
  const track = queueTracks.get().get(entry.trackId);
  if (track === undefined) {
    return Effect.fail(
      new PlayerError({
        operation: "update the queue",
        cause: `unknown track ${entry.trackId}`,
      }),
    );
  }
  const { path, title, artist, album, artworkPath } = track;
  return Effect.succeed({ id: entry.key, path, title, artist, album, artworkPath });
};

/**
 * The songs the queue passes over now (Core's `explicitPassOver`): explicit
 * ones while Don't play explicit is on, by what the queue knows of them and
 * of the tracks a command adds ([added]).
 */
export const passOverNow = (added: readonly QueueTrack[] = []): PassOver => {
  if (!dontPlayExplicit()) return () => false;
  const adding = new Map(added.map((track) => [track.id, track]));
  return explicitPassOver({
    on: true,
    flagOf: (trackId) => (adding.get(trackId) ?? queueTracks.get().get(trackId))?.explicit,
  });
};

/**
 * Learns the tracks a command adds, before the queue changes, so Up Next
 * shows them on its first frame; a play that replaces the queue (Core's
 * `playReplacesQueue`: not one whose every song [passOver] passes over)
 * forgets the old queue's.
 */
const learnTracks = (
  command: QueueCommand,
  added: readonly QueueTrack[],
  passOver: PassOver,
): void => learnQueueTracks(added, { forgetOthers: playReplacesQueue(command, passOver) });

/** A song's title for a notice, from what the queue knows of it. */
const titleOf = (trackId: string): string => queueTracks.get().get(trackId)?.title ?? "This song";

const reportError = (error: unknown): void =>
  playbackState.update((previous) => ({
    ...previous,
    error: error instanceof Error ? error.message : String(error),
  }));

/** [effect], its failure shown as the playback error rather than failing. */
const reported = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A | void> =>
  effect.pipe(Effect.catch((error) => Effect.sync(() => reportError(error))));

/** Where the current track is now, extrapolated from the last position report. */
export const currentPositionMs = (): number => extrapolatePosition(playbackState.get(), Date.now());

export const layer = Layer.effect(
  Queue,
  Effect.gen(function* () {
    const player = yield* Player;
    const store = yield* LibraryStore;
    // Every queue change, from the UI or the player, runs one at a time in this lane.
    const lane = yield* Semaphore.make(1);
    // What the native player holds, as far as JS knows. Only the lane edits the
    // list; the player moves `currentKey` on its own (auto-advance, notification).
    let native: PlayerList = { keys: [], currentKey: null };
    // False once the media session was handed a list to set (`handOver`): JS
    // can't tell whether it did (Auto may have given up waiting, or couldn't
    // read the answer), so the next sync reads what the player holds first.
    let nativeKnown = true;
    let appliedRepeat: RepeatMode | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    /** Serialises the queue once, for the player and the library (`settledQueue`). */
    const settle = (): void => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      const json = JSON.stringify(queueState.get());
      Effect.runSync(player.saveQueue(json, queueSource.get()));
      settledQueue.set(json);
    };

    const queueChanged = (): void => {
      settleTimer ??= setTimeout(settle, QUEUE_SETTLE_MS);
    };

    const flush = Effect.sync(() => {
      if (settleTimer !== null) settle();
    });

    /** Brings the player in line with [state]; [cause] names a song change it makes in the app log. */
    const applyPlan = (state: QueueState, cause: SongChangeCause) =>
      Effect.gen(function* () {
        // The player holds no unsearched entry, and waits while the playing one is searched.
        const list = playerQueueList(state);
        if (list === null) return;
        const steps = planPlayerSync(native, list);
        if (steps.length === 0) return;
        // A skip sends no items, so it doesn't look through the whole queue.
        const toLoad = new Set(keysToLoad(native, steps));
        const items =
          toLoad.size === 0
            ? []
            : yield* Effect.forEach(
                state.entries.filter((entry) => toLoad.has(entry.key)),
                itemFor,
              );
        yield* player.applySync(steps.map(toNative), items, cause);
        native = applyPlayerSync(native, steps);
        // The `skip` perf scenario's response: what the plan did, on how long a queue.
        perfMark(
          "queue.synced",
          `${steps.map((step) => step.type).join("+")} ${state.entries.length}`,
        );
      });

    const readNative = Effect.gen(function* () {
      native = yield* player.getItemIds;
      nativeKnown = true;
    });

    /** Syncs the player; if JS's picture of it was off, re-reads it and tries once more. */
    const sync = (state: QueueState, cause: SongChangeCause) =>
      (nativeKnown
        ? applyPlan(state, cause)
        : Effect.andThen(readNative, applyPlan(state, cause))
      ).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            yield* readNative;
            yield* applyPlan(state, cause);
          }),
        ),
      );

    const applyRepeat = (state: QueueState) =>
      Effect.gen(function* () {
        if (state.repeat === appliedRepeat) return;
        yield* player.setRepeatMode(state.repeat);
        appliedRepeat = state.repeat;
      });

    /**
     * The kind of shuffle [command] uses on [state] (Core's `shufflesQueue`):
     * the chosen one, with the all-time counted plays of the songs it orders
     * (`shuffledTrackIds`, streamed ones included) for Smart Shuffle, read
     * only when the command shuffles. Plays that can't be read count as none.
     */
    const shuffleFor = (state: QueueState, command: QueueCommand) =>
      Effect.gen(function* () {
        if (shuffleKind() === "real" || !shufflesQueue(state, command)) return REAL_SHUFFLE;
        const plays = yield* store
          .songCountedPlays(shuffledTrackIds(state, command))
          .pipe(Effect.orElseSucceed((): ReadonlyMap<string, number> => new Map()));
        return { kind: "smart", plays } satisfies Shuffle;
      });

    /**
     * [command] applied to [state], shuffling the way the owner chose and
     * passing over the songs [passOver] does.
     */
    const reduce = (state: QueueState, command: QueueCommand, passOver: PassOver) =>
      Effect.map(shuffleFor(state, command), (shuffle) =>
        reduceQueue(state, command, Math.random, shuffle, passOver),
      );

    // The command waiting for its playing song's search, if any: the next
    // command takes its place (Core's `startPlayingWalk`).
    let waiting: Waiting | null = null;
    // Whether a command paused the player while its playing song was searched:
    // once the queue goes on, playback goes on too.
    let pausedForSearch = false;

    /**
     * Takes [step] (Core's `PlayingStep`) in the lane: shows its notice, then
     * waits for the playing song's search (the song shows as playing, and the
     * song before it pauses), goes back to the queue as it was, or goes on.
     * [rejoin] is the command waiting before, whose search for the same song
     * is joined rather than asked again. [takeBack] is the Undo a new queue
     * offers once it goes (its toast says the notice too); staying, there's none.
     */
    const take = (
      step: PlayingStep,
      knownBefore: ReadonlyMap<string, QueueTrack>,
      rejoin: Waiting | null,
      takeBack: TakeBack | null,
    ) =>
      Effect.gen(function* () {
        // The play's own notice waits, while a search goes on, for how the walk ends.
        const notices = [takeBack?.notice ?? null, step.notice];
        const text =
          step.kind === "go" && takeBack !== null ? newQueueToast(step.playback, notices) : null;
        const said = noticeLine(step.kind === "search" ? [step.notice] : notices);
        if (said !== null && text === null) void showToast(said);
        switch (step.kind) {
          case "search": {
            queueState.set(step.state);
            if (!pausedForSearch && playbackState.get().playWhenReady) {
              yield* player.pauseForSearch;
              pausedForSearch = true;
            }
            const answer =
              rejoin?.trackId === step.trackId ? rejoin.answer : askPlaying(step.trackId);
            waiting = { walk: step.walk, trackId: step.trackId, answer, knownBefore, takeBack };
            return { kind: "wait", waiting } satisfies Outcome;
          }
          case "stay":
            queueState.set(step.state);
            // The old queue's tracks too, which a new play forgot, and keeps
            // those learned meanwhile (songs coming up found while it waited).
            queueTracks.set(new Map([...knownBefore, ...queueTracks.get()]));
            if (pausedForSearch) {
              pausedForSearch = false;
              yield* player.play;
            }
            return { kind: "stay" } satisfies Outcome;
          case "go": {
            const playback = pausedForSearch && step.playback === "keep" ? "play" : step.playback;
            pausedForSearch = false;
            const newQueue = text === null || takeBack === null ? null : { text, takeBack };
            return { kind: "go", state: step.state, playback, newQueue } satisfies Outcome;
          }
        }
      });

    /**
     * Runs [command] in the lane, up to its end or its wait for a search.
     * [source] is where the queue's playback was started from before the
     * command, which Undo puts back; null when a play offers no Undo (one
     * from Android Auto).
     */
    const start = (
      command: QueueCommand,
      added: readonly QueueTrack[],
      source: PlaySource | null = null,
    ) =>
      Effect.gen(function* () {
        const pending = waiting;
        waiting = null;
        const knownBefore = pending?.knownBefore ?? queueTracks.get();
        const passOver = passOverNow(added);
        learnTracks(command, added, passOver);
        // A tapped explicit song skipped, or nothing played or queued: say why.
        const passed = explicitPlayNotice(command, passOver, titleOf);
        if (command.type === "playerMoved") native = { ...native, currentKey: command.key };
        const before = queueState.get();
        // A play offers going back to the queue the player holds (a walk's
        // goes back there too) and withdraws an earlier Undo; a command
        // taking a walk's place keeps its Undo.
        let takeBack = pending?.takeBack ?? null;
        if (command.type === "play") {
          withdrawUndo();
          const player = { key: native.currentKey, positionMs: currentPositionMs() };
          const undo = queueUndo(pending?.walk.before ?? before, command, player, passOver);
          const from = takeBack?.source ?? source;
          takeBack =
            undo === null || from === null
              ? null
              : { undo, tracks: knownBefore, source: from, notice: passed };
        }
        // A play offering Undo says its notice on the new queue's toast.
        if (passed !== null && takeBack?.notice !== passed) void showToast(passed);
        const reduced = yield* reduce(before, command, passOver);
        const step = startPlayingWalk(before, command, reduced, pending?.walk ?? null);
        // The player went on past songs still unsearched: they're skipped, as a failed search skips them.
        if (command.type === "playerMoved" && step.kind === "go") {
          const notice = passedOverNotice(before, step.state);
          if (notice !== null) void showToast(notice);
        }
        return yield* take(step, knownBefore, pending, takeBack);
      });

    /** Takes [answer], [w]'s search's, in the lane, unless a newer command took its place. */
    const answered = (w: Waiting, answer: PlayingSettlement) =>
      Effect.gen(function* () {
        if (waiting !== w) return { kind: "superseded" } satisfies Outcome;
        waiting = null;
        const step = answerPlayingWalk(w.walk, answer, passOverNow());
        return yield* take(step, w.knownBefore, null, w.takeBack);
      });

    /**
     * Runs [next] in the lane and, once it's done, [finish] with it there.
     * A wait for a search happens outside the lane, so other commands and the
     * player's events go on meanwhile; the answer is taken in the lane again.
     */
    const walkOut = <A>(
      next: Effect.Effect<Outcome, PlayerError>,
      finish: (done: Done) => Effect.Effect<A, PlayerError>,
    ): Effect.Effect<A, PlayerError> =>
      Effect.gen(function* () {
        const outcome = yield* lane.withPermit(
          Effect.flatMap(
            next,
            (got): Effect.Effect<{ readonly value: A } | Waiting, PlayerError> =>
              got.kind === "wait"
                ? Effect.succeed(got.waiting)
                : Effect.map(finish(got), (value) => ({ value })),
          ),
        );
        return "value" in outcome ? outcome.value : yield* waitOut(outcome, finish);
      });

    /** Waits for [w]'s search outside the lane, then goes on as `walkOut`. */
    const waitOut = <A>(
      w: Waiting,
      finish: (done: Done) => Effect.Effect<A, PlayerError>,
    ): Effect.Effect<A, PlayerError> =>
      Effect.flatMap(
        Effect.promise(() => w.answer),
        (answer) => walkOut(answered(w, answer), finish),
      );

    /**
     * What a dispatched command's end does: the queue becomes its state, and
     * the player follows. [cause] is the command, as the app log names the
     * song change it makes (Core's `songChangeCause`).
     */
    const apply = (cause: SongChangeCause) => (done: Done) =>
      Effect.gen(function* () {
        if (done.kind !== "go") return;
        const { state, playback, newQueue } = done;
        const shown = queueState.get();
        if (state === shown && playback === "keep") return;
        queueState.set(state);
        if (state !== shown) queueChanged();
        yield* sync(state, cause);
        yield* applyRepeat(state);
        switch (playback) {
          case "play":
            yield* player.play;
            break;
          // The player reports the seek back to the start, which ends the play (`PlayHistory`).
          case "restart":
            yield* player.seekTo(0, "previousRestart");
            break;
          case "stop":
            yield* player.pause;
            yield* player.seekTo(0, "queueEnd");
            break;
          case "keep":
            break;
        }
        if (newQueue !== null) offerUndo(newQueue);
      });

    // The Undo on show, and its toast: a newer play withdraws it.
    let offered: { readonly takeBack: TakeBack; readonly toastId: number | null } | null = null;

    const offerUndo = ({ text, takeBack }: NewQueue): void => {
      void showToast(text, {
        label: "Undo",
        run: () => Effect.runFork(reported(undoPlay(takeBack))),
      });
      offered = { takeBack, toastId: currentToast.get()?.id ?? null };
    };

    const withdrawUndo = (): void => {
      if (offered !== null && offered.toastId !== null) dismissToast(offered.toastId);
      offered = null;
    };

    /**
     * Undo on "New queue playing": the queue the play replaced comes back as
     * it was (Core's `undoneQueue`), on its song where it was, playing. A
     * command still waiting for a search gives way. Does nothing once a newer
     * play withdrew it.
     */
    const undoPlay = (takeBack: TakeBack) =>
      lane.withPermit(
        Effect.gen(function* () {
          if (offered?.takeBack !== takeBack) return;
          offered = null;
          yield* putBack(takeBack);
          yield* player.play;
        }),
      );

    /**
     * Brings back a queue a play replaced (Core's `undoneQueue`), paused on
     * its song where it was. A command still waiting for a search gives way.
     * Runs in the lane.
     */
    const putBack = ({ undo, tracks, source }: Omit<TakeBack, "notice">) =>
      Effect.gen(function* () {
        waiting = null;
        pausedForSearch = false;
        learnQueueTracks([...tracks.values()], { forgetOthers: true });
        queueSource.set(source);
        const state = undoneQueue(undo, queueState.get());
        queueState.set(state);
        queueChanged();
        // Paused while the player changes songs, so the old one doesn't play from its start first.
        yield* player.pause;
        yield* sync(state, "undo");
        yield* applyRepeat(state);
        if (state.index >= 0) yield* player.seekTo(undo.positionMs, "undo");
      });

    // A Recap's music plays without Undo (no source to put back) and gives the queue back itself.
    const borrow = lane.withPermit(
      Effect.sync((): QueueLoan => {
        const lent = {
          undo: { state: queueState.get(), positionMs: currentPositionMs() },
          tracks: queueTracks.get(),
          source: queueSource.get(),
        };
        return {
          play: (track) => {
            const command: QueueCommand = {
              type: "play",
              trackIds: [track.id],
              context: RECAP_PLAY_CONTEXT,
              shuffle: false,
            };
            return walkOut(start(command, [track]), apply(songChangeCause(command)));
          },
          giveBack: lane.withPermit(putBack(lent)),
        };
      }),
    );

    const dispatch = (command: QueueCommand, added: readonly QueueTrack[] = []) =>
      walkOut(
        Effect.suspend(() => {
          const source = queueSource.get();
          queueSource.set(queueSourceAfter(source, command, "phone"));
          return start(command, added, source);
        }),
        apply(songChangeCause(command)),
      );

    // An unsearched song played from Auto is searched first, as on the phone.
    const handOver = (command: PlayCommand, added: readonly QueueTrack[]) =>
      walkOut(start(command, added), (done) =>
        Effect.gen(function* () {
          if (done.kind !== "go") {
            const cause = done.kind === "stay" ? "not searched" : "played something else meanwhile";
            return yield* Effect.fail(
              new PlayerError({ operation: "play from Android Auto", cause }),
            );
          }
          const { state } = done;
          const list = playerQueueList(state) ?? { keys: [], index: -1 };
          const held = new Set(list.keys);
          const items = yield* Effect.forEach(
            state.entries.filter((entry) => held.has(entry.key)),
            itemFor,
          );
          queueSource.update((source) => queueSourceAfter(source, command, "auto"));
          queueState.set(state);
          queueChanged();
          // What the player holds once the session has set the items; the next
          // sync checks it did (`nativeKnown`) before planning from it.
          native = { keys: list.keys, currentKey: list.keys[list.index] ?? null };
          nativeKnown = false;
          yield* applyRepeat(state);
          return { items, startIndex: Math.max(0, list.index) };
        }),
      );

    /**
     * Picks the queue back up when JS restarts while the player kept going
     * (Wave was backgrounded and its activity or JS runtime went away).
     */
    const restore = Effect.gen(function* () {
      yield* readNative;
      const json = yield* player.savedQueue;
      const parsed = json === null ? null : parseQueueState(JSON.parse(json));
      // Saved while its playing song was searched, it goes on from a song the player holds.
      const saved = parsed === null ? null : keptQueue(parsed, native.keys);
      if (saved === null) return;
      const resumedByPlayer = yield* player.takeResumed;
      keptPlayingKey.set(keptPlayingEntry(native.currentKey, { resumedByPlayer }));
      const source = yield* player.savedQueueSource;
      if (source !== null) queueSource.set(source);
      queueState.set(saved);
      appliedRepeat = saved.repeat;
      if (native.currentKey !== null) {
        const outcome = yield* start({ type: "playerMoved", key: native.currentKey }, []);
        // The lane is this one's already: a wait (none follows the player) goes on outside it.
        if (outcome.kind === "wait")
          Effect.runFork(Effect.ignore(waitOut(outcome.waiting, apply("restore"))));
        else yield* apply("restore")(outcome);
      }
    }).pipe(Effect.catch(() => Effect.void));

    // Auto's shuffle and repeat toggles follow the queue, whether the app or the car changed it.
    let shownModes: string | null = null;
    const showModes = (): void => {
      const { shuffle, repeat } = queueState.get();
      const modes = `${shuffle}/${repeat}`;
      if (modes === shownModes) return;
      shownModes = modes;
      Effect.runFork(
        player.setModes(shuffle, repeat).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              shownModes = null;
            }),
          ),
        ),
      );
    };
    showModes();
    yield* Effect.acquireRelease(
      Effect.sync(() => queueState.subscribe(showModes)),
      (stop) => Effect.sync(stop),
    );

    // Don't play explicit turning on takes the queue's explicit songs out, the playing one too.
    const dropExplicit = (on: boolean): void => {
      if (!on) return;
      const trackIds = queuedPassedOver(queueState.get(), passOverNow());
      if (trackIds.length === 0) return;
      Effect.runFork(reported(dispatch({ type: "removeTracks", trackIds })));
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => onDontPlayExplicit(dropExplicit)),
      (stop) => Effect.sync(stop),
    );

    yield* lane.take(1);
    yield* Effect.forkScoped(restore.pipe(Effect.ensuring(lane.release(1))));

    // Notification, lock screen and Bluetooth skips, and gapless auto-advance.
    yield* player.onItemTransition((event) => {
      if (event.itemId === null) return;
      // The player was handed a list JS didn't sync: it resumed the saved queue
      // (playback resumption) while JS was up with nothing loaded. Adopt it.
      if (
        event.reason === "playlist" &&
        queueState.get().entries.length === 0 &&
        !native.keys.includes(event.itemId)
      ) {
        Effect.runFork(lane.withPermit(restore));
        return;
      }
      if (event.reason !== "auto" && event.reason !== "seek" && event.reason !== "crossfade")
        return;
      Effect.runFork(reported(dispatch({ type: "playerMoved", key: event.itemId })));
    });

    const restoreSaved = (saved: QueueState, added: readonly QueueTrack[], positionMs: number) =>
      lane.withPermit(
        Effect.gen(function* () {
          if (queueState.get().entries.length > 0) return false;
          yield* readNative;
          if (native.keys.length > 0) return false;
          // Paused, it can't wait for a search: an unsearched playing song gives way to the next.
          const state = withHeldCurrent(saved);
          learnQueueTracks(added);
          queueState.set(state);
          // A fresh player stays paused: nothing here asks it to play.
          yield* sync(state, "restore");
          yield* player.setRepeatMode(state.repeat);
          appliedRepeat = state.repeat;
          if (positionMs > 0 && state === saved) yield* player.seekTo(positionMs, "restore");
          settle();
          return true;
        }).pipe(Effect.tapError(() => Effect.sync(() => queueState.set(EMPTY_QUEUE)))),
      );

    yield* Effect.addFinalizer(() => flush);

    return Queue.of({ dispatch, handOver, restore: restoreSaved, flush, borrow });
  }),
);
