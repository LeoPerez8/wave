/**
 * The artists similar to the Library's that Artist mixes seed from
 * (docs/spec.md, "Artist mixes"): what a Library artist's YT Music page
 * lists as "Fans might also like". A build reads them only from the phone
 * (the page their artist page saved, else what the harvest read and kept);
 * the harvest reads a page that neither has, and keeps what it lists
 * (Core's `similarArtistsKept.ts`; on this phone, not synced).
 */
import {
  artistMixSimilarSourceSteps,
  parseSimilarArtistsKept,
  similarArtistsKeptOf,
  storedSimilarArtistsKept,
  withSimilarArtistsKept,
  type ArtistMixPools,
  type DiscoverSimilarArtist,
  type DiscoverSimilarArtists,
  type SimilarArtistsKept,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "@/lib/stepped";
import { recommendationTurnEffect } from "@/lib/recommendationWork";

import { persistedSetting } from "@/lib/persistedSetting";
import type { LibraryStore } from "@/library/LibraryStore";
import { readArtistPage } from "@/ytmusic/candidateCatalog";

import { savedYtArtist, ytArtistBrowseId } from "./ytArtistPage";

/** The similar artists the harvest read, by Library artist. */
const kept = persistedSetting<SimilarArtistsKept>({
  key: "home.similarArtists",
  read: parseSimilarArtistsKept,
  write: storedSimilarArtistsKept,
  persistDelayMs: 2000,
});

/**
 * [name]'s similar artists as the phone has them: their artist page's
 * saved list, else the harvest's; undefined when neither was read.
 */
const similarOnPhone = (name: string) =>
  Effect.gen(function* () {
    const answer = yield* savedYtArtist(name);
    const listed = answer?.outcome === "found" ? answer.page.similar : undefined;
    return listed ?? similarArtistsKeptOf(kept.get(), name);
  });

/** Reads [name]'s similar artists. */
type SimilarReader<R> = (
  name: string,
) => Effect.Effect<readonly DiscoverSimilarArtist[], unknown, R>;

/** A build's: what the phone has, none for a page never read (the harvest reads it). */
export const similarOffline: SimilarReader<LibraryStore> = (name) =>
  Effect.map(similarOnPhone(name), (listed) => listed ?? []);

/**
 * The harvest's: what the phone has, else the page read now (its artist
 * found as a seed's is; it feeds the candidate catalog its top songs) and
 * kept. None when YouTube Music has no such artist; fails when it doesn't
 * answer.
 */
export const similarOnline = (name: string) =>
  Effect.gen(function* () {
    const listed = yield* similarOnPhone(name);
    if (listed !== undefined) return listed;
    const browseId = yield* ytArtistBrowseId(name);
    const artists = browseId === null ? [] : ((yield* readArtistPage(browseId)).similar ?? []);
    kept.set(withSimilarArtistsKept(kept.get(), name, artists));
    return artists;
  });

/**
 * [pools] with the similar artists Core asks for (`artistMixSimilarSource`),
 * one Library artist's at a time, as [read] reads them. A page that can't
 * be read counts as one with no similar artists, so the other seeds stand
 * as they are.
 */
export const withSimilar = <R>(pools: ArtistMixPools, read: SimilarReader<R>) =>
  Effect.gen(function* () {
    const similar: DiscoverSimilarArtists[] = [];
    for (
      let source = yield* runSteps(artistMixSimilarSourceSteps(pools), recommendationTurnEffect);
      source !== null;
      source = yield* runSteps(
        artistMixSimilarSourceSteps({ ...pools, similar }),
        recommendationTurnEffect,
      )
    ) {
      const artists = yield* read(source.name).pipe(Effect.orElseSucceed(() => []));
      similar.push({ of: source.name, artists });
    }
    return { ...pools, similar };
  });
