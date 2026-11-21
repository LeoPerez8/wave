import { namedWork } from "@/lib/stepped";
import { ytTrackId, type MagicSong, type TasteHistory } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { recommendationTurnEffect } from "@/lib/recommendationWork";

import {
  onDisliked,
  onLibraryChange,
  onStarred,
  onUndisliked,
  onUnstarred,
  onYtSongSignal,
  type DislikedChange,
} from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { type SongRow, type ArtistRow } from "@wave/client";

import { deriveTaste, deriveTasteFromLibrary } from "./tasteDerivation";
import { makeLiveTaste } from "./liveTaste";
import { magicStreamedSong } from "./magicQueueRadio";
import { magicSongsOf } from "./magicSongs";
import { onPlayEnded } from "./PlayHistory";

/**
 * The taste profile (docs/spec.md, Taste profile): what the owner likes,
 * which the radio recommendations weigh. Core derives it
 * from the play history, favorites and downloads (`tasteProfile`), so it
 * keeps no state of its own; this module derives it once per launch, the
 * first time it's asked for, and keeps it up to date as signals come from
 * playback anywhere in the app (`makeLiveTaste`): plays ending (streamed ones
 * too, weighed as `magicSongsOf` weighs them live), stars and unstars, YT
 * Music stars and downloads, dislikes and their removal.
 */
const derive = (snapshotTaken: (history: TasteHistory) => void) =>
  Effect.gen(function* () {
    return yield* deriveTaste(
      yield* LibraryStore,
      recommendationTurnEffect,
      Date.now(),
      undefined,
      snapshotTaken,
      magicStreamedSong,
    );
  }).pipe(namedWork("taste profile"));
const live = makeLiveTaste({
  derive: derive(() => {}),
  deriveWithSnapshot: (snapshotTaken) => derive(snapshotTaken),
  songsOf: magicSongsOf,
  between: recommendationTurnEffect,
});

/**
 * The owner's taste profile, derived from the history the first time it's
 * asked for, then as signals have kept it; null when the history can't be
 * read. A recommendation passes its snapshot's Library, which a cold profile
 * maps instead of reading the songs again.
 */
export const tasteProfileForRecommendation = (library: {
  readonly songs: readonly SongRow[];
  readonly artists: readonly ArtistRow[];
}) =>
  live.profileUsing((snapshotTaken) =>
    Effect.gen(function* () {
      return yield* deriveTasteFromLibrary(
        yield* LibraryStore,
        recommendationTurnEffect,
        Date.now(),
        library,
        snapshotTaken,
        magicStreamedSong,
      );
    }).pipe(namedWork("taste profile")),
  );

/**
 * The songs just disliked as the profile weighs them: the Library's and the
 * queue's as `magicSongsOf` tells them, any other (a YT Music song disliked
 * from a search) by the artists its dislike keeps, as a derivation weighs it.
 */
const dislikedSongs = (songs: readonly DislikedChange[]) =>
  magicSongsOf(songs.map((song) => song.key)).pipe(
    Effect.orElseSucceed((): readonly MagicSong[] => []),
    Effect.map((known) => {
      const byId = new Map(known.map((song) => [song.trackId, song]));
      return songs.map(
        ({ key, artists }) => byId.get(key) ?? magicStreamedSong({ id: key, artists }),
      );
    }),
  );

/** Last derived taste, available while a refresh runs. */
export const latestTasteProfile = live.peek;

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
        onDisliked((songs) => {
          const at = Date.now();
          run(Effect.flatMap(dislikedSongs(songs), (disliked) => live.disliked(disliked, at)));
        }),
        onUndisliked((keys) => live.undisliked(keys)),
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
