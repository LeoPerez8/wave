/**
 * What Home's mixes know of the owner's songs (docs/spec.md, "Artist mixes"):
 * a build's indexes (Core's `mixKnownSongs`), read once and shared by every
 * section's build, and the videos re-blends leave out of a mix's new songs
 * (`discoverMixKeep`'s `knownVideos`), read again at each re-blend.
 */
import { mixKnownSongs, statsWindow, type MixKnownSongs, type PlayTotals } from "@wave/core";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore, type ArtistRow, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";

/** A Library song as a mix build reads it: with every value of its genre tag when it has several. */
export type MixSong = SongRow & { readonly genres?: readonly string[] };

/** [songs] with every value of their multi-value genre tags ([genres], by song id). */
const withGenres = (
  songs: readonly SongRow[],
  genres: ReadonlyMap<number, readonly string[]>,
): readonly MixSong[] =>
  genres.size === 0
    ? songs
    : songs.map((song) => {
        const values = genres.get(song.id);
        return values === undefined ? song : { ...song, genres: values };
      });

/** What a mix build reads of the Library and of what the owner knows. */
export interface MixIndexes {
  /** The Library's songs, each with every value of a multi-value genre tag (Genre mixes count each). */
  readonly songs: readonly MixSong[];
  readonly artists: readonly ArtistRow[];
  /** Every Library song's all-time counted plays. */
  readonly plays: readonly PlayTotals[];
  readonly known: MixKnownSongs<SongRow>;
}

/**
 * Reads the Library, the plays, the songs streamed and the playlists'
 * entries, and indexes what the owner knows, giving the JavaScript thread
 * back between steps (`freeTurnEffect`) so Home stays smooth.
 */
const readIndexes = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const genres = new Map((yield* store.listSongGenres).map((song) => [song.id, song.genres]));
  const songs = withGenres(yield* store.listSongs, genres);
  yield* freeTurnEffect;
  const artists = yield* store.listArtists;
  const plays = yield* store.trackPlayTotals(statsWindow("all", Date.now()));
  yield* freeTurnEffect;
  const playedRecordingKeys = yield* store.playedRecordingKeys;
  yield* freeTurnEffect;
  const streamed = yield* store.streamedSongs;
  const playlisted = yield* store.playlistedSongs;
  yield* freeTurnEffect;
  const known = mixKnownSongs({ library: songs, playedRecordingKeys, streamed, playlisted });
  yield* freeTurnEffect;
  return { songs, artists, plays, known } satisfies MixIndexes;
});

/** Indexes this recent serve another section's build. */
const SHARED_FOR_MS = 60_000;
let shared: { readonly at: number; readonly indexes: Promise<MixIndexes> } | null = null;

/**
 * The indexes for a mix build: read once, then shared by the builds that
 * start within a minute (Home's sections build on the same visit). A failed
 * read isn't kept.
 */
export const mixIndexes: Effect.Effect<MixIndexes, unknown> = Effect.suspend(() => {
  const now = Date.now();
  if (shared === null || now - shared.at > SHARED_FOR_MS) {
    const indexes = appRuntime.runPromise(readIndexes);
    shared = { at: now, indexes };
    indexes.catch(() => {
      if (shared?.indexes === indexes) shared = null;
    });
  }
  const { indexes } = shared;
  return Effect.tryPromise({ try: () => indexes, catch: (cause) => cause });
});

/**
 * The videos the owner knows now (`LibraryStore.knownVideos`), as of the
 * last re-blend; null until first read.
 */
const knownVideos = makeExternalStore<ReadonlySet<string> | null>(null);

/**
 * Reads the videos the owner knows again: a re-blend (a level change,
 * opening a mix's page or menu, Home coming into focus) leaves the new songs
 * played or added to a playlist since the build out. Offline; a failed read
 * keeps the last ones.
 */
export const refreshKnownVideos = (): void => {
  void appRuntime
    .runPromise(
      Effect.gen(function* () {
        return yield* (yield* LibraryStore).knownVideos;
      }),
    )
    .then((videos) => knownVideos.set(new Set(videos)))
    .catch(() => {});
};

/** The videos the owner knew at the last re-blend (`refreshKnownVideos`), or null before it. */
export const useKnownVideos = (): ReadonlySet<string> | null =>
  useSyncExternalStore(knownVideos.subscribe, knownVideos.get);
