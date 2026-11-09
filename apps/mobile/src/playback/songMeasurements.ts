/**
 * Normalize Volume's measurements of the songs about to play (docs/spec.md,
 * "Normalize Volume"): while the switch is on, the Library files without a
 * value among the current song, the album playing (when album gain could
 * apply) and the next five in Up Next (Core's `songsToMeasure`) are measured
 * one at a time by the native meter, which decodes on a low-priority thread of
 * its own. Each step takes the first of them still to measure, so a queue
 * change takes effect after the song being measured, and stops when none is
 * left. A song this runner measured keeps its place among the five, so the
 * line moves on as the queue does, about a song per song played, and never
 * runs through the whole queue: the rest is the charging job's.
 *
 * A value kept for a song reaches the player at once ([learned]): before the
 * song starts it plays at it, and once it has, from its next start (the gain
 * stage settles a song's gain as it starts). A file the meter can't decode is
 * kept as unmeasurable, so it isn't tried again until it changes. One it
 * can't open now (a missing file, storage not mounted) is kept nowhere and
 * takes no place among the five; it's tried again after the next scan
 * ([scanned]) or launch. Turning the switch off stops the measurement running
 * and keeps nothing of it; turning it on picks up there. Kept free of Expo so
 * it runs under plain Node tests.
 */
import { measureCandidates, songsToMeasure, type AlbumLoudness, type QueueState } from "@wave/core";
import * as Effect from "effect/Effect";

import type { SongMeasurement, SongToMeasure } from "../library/db/loudness.ts";
import type { AudioMeasurement } from "../native/audioMeasurement.ts";

/** The queue now, and the Library album it plays, for Core's `songsToMeasure`. */
export interface QueueToMeasure {
  readonly state: QueueState;
  /** The local album of an album context (`LibraryStore.albumLoudness`); null for any other. */
  readonly album: AlbumLoudness | null;
}

export interface SongMeasurementsDeps {
  /** Whether Normalize Volume is on. */
  readonly on: () => boolean;
  /** The queue as it is now. */
  readonly queue: () => Effect.Effect<QueueToMeasure, unknown>;
  /** Those of [ids] still to measure (`LibraryStore.songsToMeasure`). */
  readonly songsToMeasure: (
    ids: readonly number[],
  ) => Effect.Effect<readonly SongToMeasure[], unknown>;
  /** Measures the file at [path] (`WaveNative.measureAudioLoudness`). */
  readonly measure: (path: string) => Promise<AudioMeasurement>;
  /** Stops the measurement running (`WaveNative.cancelAudioMeasurement`). */
  readonly cancel: () => void;
  /** Keeps what measuring [song] gave; false when its file changed meanwhile. */
  readonly save: (
    song: SongToMeasure,
    measurement: SongMeasurement,
  ) => Effect.Effect<boolean, unknown>;
  /** Library song [id] has a value of its own now. */
  readonly learned: (id: number) => void;
}

/** Why a step stopped measuring: nothing left to measure, or the switch is off. */
const DONE = Symbol("done");

export const createSongMeasurements = (deps: SongMeasurementsDeps) => {
  // Files the meter couldn't open (or answer for) since the last scan, by Track id and file.
  const unreadable = new Set<string>();
  const fileKey = (song: SongToMeasure): string =>
    `${song.id}\u0000${song.path}\u0000${song.sizeBytes}\u0000${song.modifiedAt}`;
  // Songs this runner kept a result for: they keep their place in the line.
  const done = new Set<number>();
  let running: Promise<void> | null = null;
  // A wake came while the step running had already read the queue.
  let again = false;

  /** Measures the first song still to measure; DONE when there's none, or the switch is off. */
  const step = Effect.gen(function* () {
    if (!deps.on()) return DONE;
    const { state, album } = yield* deps.queue();
    const toMeasure = new Map<number, SongToMeasure>();
    for (const song of yield* deps.songsToMeasure(measureCandidates(state, album))) {
      if (!unreadable.has(fileKey(song))) toMeasure.set(song.id, song);
    }
    const line = songsToMeasure(state, (id) => toMeasure.has(id) || done.has(id), album);
    const song = line.flatMap((id) => toMeasure.get(id) ?? [])[0];
    if (song === undefined) return DONE;
    const answer = yield* Effect.promise(() =>
      deps.measure(song.path).catch((): AudioMeasurement => ({ kind: "unreadable" })),
    );
    switch (answer.kind) {
      case "measured":
        if (yield* deps.save(song, { loudness: answer.loudness, peak: answer.peak })) {
          done.add(song.id);
          deps.learned(song.id);
        }
        break;
      case "unmeasurable":
        if (yield* deps.save(song, null)) done.add(song.id);
        break;
      case "unreadable":
        unreadable.add(fileKey(song));
        break;
      case "cancelled":
        // The switch went off: nothing is kept, and the song is measured when it's back on.
        break;
    }
    return song.id;
  });

  const pass = Effect.gen(function* () {
    for (;;) {
      again = false;
      const done = yield* step;
      if (done === DONE && !again) return;
    }
  }).pipe(Effect.ignore);

  /** Measures what's due now; resolves once nothing is left (a pass already running included). */
  const wake = (): Promise<void> => {
    again = true;
    running ??= Effect.runPromise(pass).finally(() => {
      running = null;
    });
    return running;
  };

  return {
    wake,
    /** The switch changed: off stops the measurement running, on picks up where it stopped. */
    switched: (): void => {
      if (deps.on()) void wake();
      else deps.cancel();
    },
    /** A scan finished: the files the meter couldn't open are tried again. */
    scanned: (): void => {
      unreadable.clear();
      void wake();
    },
  };
};
