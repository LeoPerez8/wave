import {
  magicLibrarySongs,
  tasteLearned,
  tastePlaySignal,
  tasteProfile,
  ytTrackId,
  type TasteProfile,
  type TasteSignalKind,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import { makeExternalStore } from "@/lib/externalStore";
import { onStarred, onYtSongSignal } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";

import { magicSongsOf } from "./magicSongs";
import { onPlayEnded } from "./PlayHistory";

/**
 * The taste profile (docs/spec.md, Taste profile): what the owner likes,
 * which the Magic Queue weighs from its first batch. Core derives it from the
 * play history, favorites and downloads (`tasteProfile`), so it keeps no
 * state of its own; this module derives it once per launch, the first time
 * it's asked for, and keeps it up to date as signals come from playback
 * anywhere in the app: plays ending, stars, YT Music stars and downloads.
 */

/** The profile once derived; null until it's first asked for (or while it can't be read). */
const taste = makeExternalStore<TasteProfile | null>(null);

/** Only one derivation at a time: a second ask waits for the first's profile. */
const deriving = Semaphore.makeUnsafe(1);

/**
 * The owner's taste profile, derived from the history the first time it's
 * asked for, then as signals have kept it; null when the history can't be
 * read (the Magic Queue then weighs by its session alone).
 */
export const tasteProfileNow: Effect.Effect<TasteProfile | null, never, LibraryStore> =
  Semaphore.withPermit(
    deriving,
    Effect.gen(function* () {
      const known = taste.get();
      if (known !== null) return known;
      const store = yield* LibraryStore;
      const history = yield* store.tasteHistory;
      const songs = yield* store.listSongs;
      const toMagicSong = magicLibrarySongs(yield* store.listArtists);
      const byId = new Map(songs.map((song) => [String(song.id), toMagicSong(song)]));
      const derived = tasteProfile(history, (trackId) => byId.get(trackId), Date.now());
      taste.set(derived);
      return derived;
    }),
  ).pipe(Effect.orElseSucceed(() => null));

/**
 * Keeps the taste profile up to date once it was derived: a play ending (a
 * song played to the end, or skipped within its first 30 s), a star, and a
 * YT Music song starred or downloaded each move it at once. Signals before
 * it's first derived are in the history it's derived from (the Library's),
 * or only count for the session they came in (a streamed song's).
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;

    /** Teaches the profile [kind] about each of [trackIds], at [at]. */
    const learn = (kind: TasteSignalKind, trackIds: readonly string[], at: number): void => {
      if (trackIds.length === 0 || taste.get() === null) return;
      Effect.runFork(
        Effect.ignore(
          Effect.gen(function* () {
            const songs = yield* magicSongsOf(trackIds);
            const current = taste.get();
            if (current === null || songs.length === 0) return;
            taste.set(
              songs.reduce((learned, song) => tasteLearned(learned, { kind, song, at }), current),
            );
          }).pipe(Effect.provideService(LibraryStore, store)),
        ),
      );
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => [
        onPlayEnded(({ play }) => {
          const kind = tastePlaySignal(play);
          if (kind !== null) learn(kind, [play.trackId], play.startedAt);
        }),
        onStarred((trackIds) => learn("favorite", trackIds.map(String), Date.now())),
        onYtSongSignal((kind, videoIds) => learn(kind, videoIds.map(ytTrackId), Date.now())),
      ]),
      (stops) =>
        Effect.sync(() => {
          for (const stop of stops) stop();
        }),
    );
  }),
);
