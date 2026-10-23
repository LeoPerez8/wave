import { ytTrackId, type TasteHistory, type TasteProfile } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { freeTurnEffect } from "@/lib/backgroundWork";

import { onLibraryChange, onStarred, onUnstarred, onYtSongSignal } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";

import { deriveTaste, type TasteLibrary } from "./tasteDerivation";
import { makeLiveTaste } from "./liveTaste";
import { magicSongsOf } from "./magicSongs";
import { onPlayEnded } from "./PlayHistory";

/**
 * The taste profile (docs/spec.md, Taste profile): what the owner likes,
 * which the Magic Queue and Home's Magic Queue section weigh. Core derives it
 * from the play history, favorites and downloads (`tasteProfile`), so it
 * keeps no state of its own; this module derives it once per launch, the
 * first time it's asked for, and keeps it up to date as signals come from
 * playback anywhere in the app (`makeLiveTaste`): Library plays ending,
 * stars and unstars, YT Music stars and downloads.
 */
const derive = (snapshotTaken: (history: TasteHistory) => void, library?: TasteLibrary) =>
  Effect.gen(function* () {
    return yield* deriveTaste(
      yield* LibraryStore,
      freeTurnEffect,
      Date.now(),
      library,
      snapshotTaken,
    );
  });
const live = makeLiveTaste({
  derive: derive(() => {}),
  deriveWithSnapshot: (snapshotTaken) => derive(snapshotTaken),
  songsOf: magicSongsOf,
  between: freeTurnEffect,
});

/** Home reuses its due-build input without creating another live profile or rereading songs. */
export const tasteProfileForLibrary = (library: TasteLibrary) =>
  live.profileUsing((snapshotTaken) => derive(snapshotTaken, library));

/**
 * The owner's taste profile, derived from the history the first time it's
 * asked for, then as signals have kept it; null when the history can't be
 * read (the Magic Queue then weighs by its session alone).
 */
export const tasteProfileNow: Effect.Effect<TasteProfile | null, never, LibraryStore> =
  live.profile;

/** Keeps the taste profile up to date as signals come (`makeLiveTaste`). */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const run = (effect: Effect.Effect<void, never, LibraryStore>): void => {
      Effect.runFork(effect.pipe(Effect.provideService(LibraryStore, store)));
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => [
        onPlayEnded(({ play }) => run(live.played(play))),
        onStarred((trackIds) => run(live.marked("favorite", trackIds.map(String), Date.now()))),
        onUnstarred((ids) => live.unstarred(ids)),
        onLibraryChange((change) => {
          if (change.kind === "tracks") live.invalidate();
        }),
        onYtSongSignal((kind, videoIds) =>
          run(live.marked(kind, videoIds.map(ytTrackId), Date.now())),
        ),
      ]),
      (stops) =>
        Effect.sync(() => {
          for (const stop of stops) stop();
        }),
    );
  }),
);
