/**
 * Artist photos (docs/spec.md, "Artist photos"): looked up online by name in
 * the background, a few at a time, and cached as files beside the album
 * artwork. Which artist to look up and which result to take is Core's
 * (`artistPhotoLookups`, `pickArtistPhoto`); this file fetches and saves.
 */
import {
  deezerArtistCandidates,
  deezerArtistSearchUrl,
  identityKey,
  pickArtistPhoto,
} from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { WaveNative, type ArtistPhotoFiles } from "@/native/waveNative";
import { artistPhotosEnabled, useArtistPhotosEnabled } from "@/settings/artistPhotos";

import type { ArtistPhotoLookup, ArtistPhotoRecord } from "./db/artistPhotos";
import { LibraryStore } from "./LibraryStore";

/** Downloaded photos by artist key, loaded from the store when lookups start. */
const photos = makeExternalStore<ReadonlyMap<string, ArtistPhotoFiles>>(new Map());

/**
 * [name]'s downloaded photo, or null (none yet, no match, or downloads turned
 * off): the artist's album-artwork image shows instead.
 */
export const useArtistPhoto = (name: string): ArtistPhotoFiles | null => {
  const enabled = useArtistPhotosEnabled();
  const photo = useSyncExternalStore(photos.subscribe, () => photos.get().get(identityKey(name)));
  return enabled ? (photo ?? null) : null;
};

/** How many artist photos are downloaded. */
export const useArtistPhotoCount = (): number =>
  useSyncExternalStore(photos.subscribe, () => photos.get().size);

/** Lookups running at once: enough to get through a library, gentle on the service. */
const CONCURRENCY = 3;
/** A lookup (search and both downloads) that takes longer than this has failed. */
const LOOKUP_TIMEOUT = "30 seconds";
/** This many failed lookups in a row means the service can't be reached: stop until next time. */
const OFFLINE_AFTER_FAILURES = 3;

class Offline extends Data.TaggedError("Offline")<{}> {}

/** Searches [artist], picks the confident match and saves its photo. */
const lookUp = (artist: ArtistPhotoLookup) =>
  Effect.tryPromise(async (signal): Promise<ArtistPhotoRecord> => {
    const response = await fetch(deezerArtistSearchUrl(artist.query), { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candidates = deezerArtistCandidates(await response.json());
    if (candidates === null) throw new Error("Not a search result");
    const checkedAt = Date.now();
    const photo = pickArtistPhoto(artist.name, candidates);
    if (photo === null) return { outcome: "unmatched", checkedAt };
    const files = await WaveNative.saveArtistPhoto(artist.key, photo.thumbUrl, photo.largeUrl);
    return { outcome: "found", checkedAt, ...files };
  }).pipe(
    Effect.timeout(LOOKUP_TIMEOUT),
    Effect.orElseSucceed((): ArtistPhotoRecord => ({ outcome: "failed", checkedAt: Date.now() })),
  );

/** Reads the cached photos, so artists show them with no request. */
export const loadArtistPhotos = Effect.gen(function* () {
  const saved = yield* (yield* LibraryStore).listArtistPhotos;
  photos.set(new Map(saved.map(({ key, path, thumbPath }) => [key, { path, thumbPath }])));
});

/**
 * Looks up every artist that is due (new ones, and misses whose retry time
 * has come) unless downloads are off. Interrupt it to stop all requests.
 */
export const downloadArtistPhotos = Effect.gen(function* () {
  if (!artistPhotosEnabled()) return;
  const store = yield* LibraryStore;
  yield* loadArtistPhotos;
  const due = yield* store.artistPhotoLookups;
  let failuresInARow = 0;
  yield* Effect.forEach(
    due,
    (artist) =>
      Effect.gen(function* () {
        if (failuresInARow >= OFFLINE_AFTER_FAILURES) return yield* new Offline();
        const record = yield* lookUp(artist);
        failuresInARow = record.outcome === "failed" ? failuresInARow + 1 : 0;
        yield* store.recordArtistPhoto(artist.key, record);
        if (record.outcome === "found") {
          const { path, thumbPath } = record;
          photos.update((current) => new Map(current).set(artist.key, { path, thumbPath }));
        }
      }),
    { concurrency: CONCURRENCY, discard: true },
  );
}).pipe(Effect.catchTag("Offline", () => Effect.void));

/** Deletes every downloaded photo and forgets every lookup; artists show album artwork again. */
export const clearArtistPhotos = Effect.gen(function* () {
  const store = yield* LibraryStore;
  photos.set(new Map());
  // Files left behind are overwritten if the photo is downloaded again.
  yield* Effect.tryPromise(() => WaveNative.clearArtistPhotos()).pipe(Effect.ignore);
  yield* store.clearArtistPhotos;
});
