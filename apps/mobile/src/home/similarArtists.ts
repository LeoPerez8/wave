/** Similar artists from saved artist pages and previously stored lists; builds make no lookup. */
import {
  artistMixSimilarSourceSteps,
  parseSimilarArtistsKept,
  similarArtistsKeptOf,
  storedSimilarArtistsKept,
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

import { savedYtArtist } from "./ytArtistPage";

/** Previously stored similar artists, by Library artist. */
const kept = persistedSetting<SimilarArtistsKept>({
  key: "home.similarArtists",
  read: parseSimilarArtistsKept,
  write: storedSimilarArtistsKept,
  persistDelayMs: 2000,
});

/**
 * [name]'s similar artists as the phone has them: their artist page's
 * saved list, else a previously stored list; undefined when neither was read.
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

/** A build's: what the phone has, none for a page never read. */
export const similarOffline: SimilarReader<LibraryStore> = (name) =>
  Effect.map(similarOnPhone(name), (listed) => listed ?? []);

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
