/**
 * What Home's mixes know of the owner's songs (docs/spec.md, "Artist mixes"):
 * a build's indexes (Core's `mixKnownSongs`), read once and shared by every
 * section's build, and the videos re-blends leave out of a mix's new songs
 * (`discoverMixKeep`'s `knownVideos`), shared until a relevant source changes.
 */
import type { MixKnownSongs, PlayedSeedArtist, PlayTotals } from "@wave/core";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { settledTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore, type ArtistRow, type SongRow } from "@/library/LibraryStore";
import { onLibraryChange } from "@/library/libraryChanges";
import { createKnownVideosRead, readKnownVideos } from "./knownVideosRead";
import { appRuntime } from "@/library/runtime";

/** A Library song as a mix build reads it: with every value of its genre tag when it has several. */
export type MixSong = SongRow & { readonly genres?: readonly string[] };

/** What a mix build reads of the Library and of what the owner knows. */
export interface MixIndexes {
  readonly topArtists: readonly PlayedSeedArtist[];
  /** The Library's songs, each with every value of a multi-value genre tag (Genre mixes count each). */
  readonly songs: readonly MixSong[];
  readonly artists: readonly ArtistRow[];
  /** Every Library song's all-time counted plays. */
  readonly plays: readonly PlayTotals[];
  readonly known: MixKnownSongs<SongRow>;
}

/**
 * The videos the owner knows now (`LibraryStore.knownVideos`), as of the
 * last re-blend; null until first read.
 */
const knownVideos = makeExternalStore<ReadonlySet<string> | null>(null);

/**
 * Reads in pages, each on a settled turn, and
 * refreshes only a changed source version: a re-blend (a level change,
 * opening a mix's page or menu, Home coming into focus) leaves the new songs
 * played or added to a playlist since the build out. Offline; a failed read
 * keeps the last ones.
 */
const videoRead = createKnownVideosRead(
  Effect.gen(function* () {
    yield* settledTurnEffect;
    return yield* readKnownVideos(yield* LibraryStore, settledTurnEffect);
  }),
);
onLibraryChange(videoRead.change);
export const refreshKnownVideos = (): void => {
  void appRuntime
    .runPromise(videoRead.get)
    .then((videos) => {
      const previous = knownVideos.get();
      if (
        previous !== null &&
        previous.size === videos.length &&
        videos.every((video) => previous.has(video))
      )
        return;
      knownVideos.set(new Set(videos));
    })
    .catch(() => {});
};

/** The videos the owner knew at the last re-blend (`refreshKnownVideos`), or null before it. */
export const useKnownVideos = (): ReadonlySet<string> | null =>
  useSyncExternalStore(knownVideos.subscribe, knownVideos.get);
