/** Discover's saved mix rows, built and reranked from ordered artist radios. */
import {
  artistMixNeedsChartSteps,
  artistMixSeedsSteps,
  discoverMixKeep,
  discoverMixesBuilt,
  homeMixBuildsDue,
  discoverMixesOfRadiosSteps,
  rankedDiscoverMixRead,
  discoverMixesRerun,
  discoverMixesSection,
  genreMixSeedsSteps,
  discoverRowTitle,
  mixesShown,
  mixRefreshAvoid,
  libraryCanSeedArtistMixes,
  libraryMixProfilesSteps,
  mixSectionOfId,
  parseDiscoverMixes,
  parseMixesShown,
  rerankedDiscoverMixes,
  savedDiscoverMix,
  storedDiscoverMixes,
  storedMixesShown,
  undoneMixRefresh,
  type BlendedDiscoverMix,
  type DiscoverMixBlend,
  type DiscoverMixSeed,
  type DiscoverMixes,
  type DiscoverMixesSection,
  type MixRefreshAvoid,
  type MixSliders,
  type ShownMixes,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { runSteps } from "@/lib/stepped";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { withNetworkLog } from "@/lib/networkMeter";
import { persistedSetting, type PersistedSetting } from "@/lib/persistedSetting";
import { libraryListQueries } from "@/library/hooks";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { useLibraryQuery } from "@/library/sharedQueries";
import { showToast } from "@/overlay/toast";
import { latestTasteProfile, tasteProfileForRecommendation } from "@/playback/TasteProfile";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useDiscoverFocus } from "./discoverFocus";
import { lookedUpProfileOf } from "./artistGenres";
import { artistMixPools } from "./artistMixPools";
import {
  discoverSlidersNow,
  setMixSlidersListener,
  useDiscoverLevel,
  type MixSectionId,
} from "./discoverMixLevel";
import { recommendationSnapshot } from "./recommendationSnapshot";
import { buildHomeMixes } from "./homeMixBuild";
import { refreshKnownVideos, useKnownVideos } from "./mixKnown";
import { noteMixesShown } from "./mixPreDownload";
import { similarOffline, withSimilar } from "./similarArtists";
import { chartArtists } from "./ytChart";
import { artistRadioCacheId } from "./cachedArtistRadio";
import { mixRadioPages, readMixArtistRadio } from "./mixArtistRadio";
import { readMixRadios } from "./mixRadioReads";
import { readMixBuildLibrary } from "./mixBuildLibrary";
import { knownLibraryFinder } from "@/ytmusic/libraryFinder";

export type { MixSectionId } from "./discoverMixLevel";

/** Both mix rows rank only their own radios, including on offline slider reranks. */
const radioMixes = (
  seeds: readonly DiscoverMixSeed[],
  inputs: MixBuildInputs,
  avoid: ReadonlySet<string> | undefined,
  live: boolean,
) =>
  Effect.gen(function* () {
    const pages = yield* readMixRadios(seeds, (artist) =>
      live
        ? readMixArtistRadio(artist)
        : Effect.succeed(mixRadioPages.get(artistRadioCacheId(artist.name))),
    );
    yield* inputs.matchRadios(pages.flat().flatMap((page) => page.songs));
    const sliders = discoverSlidersNow();
    const popularity = new Map(
      inputs.catalog.map((entry) => [entry.song.videoId, 1 - 0.5 ** entry.radios.length]),
    );
    const profileOf = (name: string) => inputs.profiles.profileOf(name) ?? lookedUpProfileOf(name);
    const reads = seeds.flatMap((seed, i) => {
      const page = pages[i];
      return page == null || page.length === 0
        ? []
        : [
            rankedDiscoverMixRead(
              seed,
              {
                pages: page,
                taste: inputs.taste,
                profileOf,
                popularityOf: (videoId) => popularity.get(videoId) ?? 0,
              },
              { ...sliders, ...(seed.kind === "artist" ? { profile: profileOf(seed.name) } : {}) },
            ),
          ];
    });
    const mixes = yield* runSteps(
      discoverMixesOfRadiosSteps(reads, {
        known: inputs.library.known,
        library: inputs.library,
        ...(avoid === undefined ? {} : { avoid }),
      }),
      recommendationTurnEffect,
    );
    return { mixes, sliders };
  });

/** The sliders each build's mixes were ranked at: the section's `rankedWith` once they're saved. */
const rankedAt = new WeakMap<DiscoverMixes, MixSliders>();

/** Saves [built] as [id]'s mixes, with the sliders they were ranked at. */
const saveBuilt = (id: MixSectionId, built: DiscoverMixes): void => {
  const mixSection = SECTIONS[id];
  mixSection.saved.set(built);
  mixSection.rankedWith = rankedAt.get(built) ?? null;
};

/** Builds use the last completed indexes; derivations warm separately on focus. */
const mixBuildInputs = Effect.gen(function* () {
  const snapshot = recommendationSnapshot.peek();
  const { library, matchRadios } = yield* readMixBuildLibrary(
    snapshot.library,
    yield* LibraryStore,
    recommendationTurnEffect,
    knownLibraryFinder(),
  );
  const profiles = yield* runSteps(libraryMixProfilesSteps(library), recommendationTurnEffect);
  return {
    library,
    matchRadios,
    catalog: snapshot.catalog ?? [],
    graph: snapshot.graph,
    taste: latestTasteProfile(),
    profiles,
  };
});

type MixBuildInputs = Effect.Success<typeof mixBuildInputs>;

/**
 * [saved] ranked again from cached radios: the build's
 * seeds and avoided songs (Core's `discoverMixesRerun`), no new
 * seed picked and no request, then the seeds take their songs in order as
 * a build's do. The saved mixes when it makes none.
 */
const rerankedOf = (saved: DiscoverMixes) =>
  Effect.gen(function* () {
    const inputs = yield* mixBuildInputs;
    const library = inputs.library;
    const { seeds, avoid } = discoverMixesRerun(saved, library.artists);
    const avoidSongs = avoid.size === 0 ? undefined : avoid;
    const { mixes, sliders } = yield* radioMixes(seeds, inputs, avoidSongs, false);
    return { mixes: rerankedDiscoverMixes(saved, mixes), sliders };
  });

/** Whether two settings of the sliders are the same. */
const sameSliders = (a: MixSliders | null, b: MixSliders): boolean =>
  a !== null && a.faithfulness === b.faithfulness && a.popularity === b.popularity;

/**
 * Re-ranks [id]'s saved mixes at its sliders now (`rerankedOf`), at once
 * and offline, and saves them as the same build, so Home's tiles and the
 * mix pages crossfade to them. One at a time: sliders moved while it or a
 * build goes on re-rank once more after it, when they differ from those it
 * ranked at. The re-ranked set replaces itself in what a refresh avoids.
 */
const rerank = (id: MixSectionId): void => {
  const mixSection = SECTIONS[id];
  const saved = mixSection.saved.get();
  if (mixSection.building.get() || mixSection.reranking) {
    mixSection.rerankAfter = true;
    return;
  }
  if (saved === null || sameSliders(mixSection.rankedWith, discoverSlidersNow())) return;
  mixSection.reranking = true;
  void appRuntime
    .runPromise(settledTurnEffect.pipe(Effect.andThen(Effect.result(rerankedOf(saved)))))
    .then((result) => {
      if (!Result.isSuccess(result)) return;
      // A build, a refresh or an Undo saved others meanwhile: they say what they're ranked at.
      if (mixSection.saved.get() !== saved) {
        mixSection.rerankAfter = true;
        return;
      }
      const { mixes, sliders } = result.success;
      // Unchanged or not, the saved mixes are what the sliders now rank.
      mixSection.rankedWith = sliders;
      if (mixes === saved) return;
      mixSection.saved.set(mixes);
      mixSection.shown.set(mixesShown(mixSection.shown.get(), mixes, Date.now()));
    })
    .finally(() => {
      mixSection.reranking = false;
      rerankAfterward(id);
    });
};

/** After a build or a re-rank: the re-rank sliders moved meanwhile asked for. */
const rerankAfterward = (id: MixSectionId): void => {
  const mixSection = SECTIONS[id];
  if (!mixSection.rerankAfter) return;
  mixSection.rerankAfter = false;
  rerank(id);
};

setMixSlidersListener(rerank);

/**
 * Builds Artist mixes from the owner's all-time most played artists, picked
 * at random (`Math.random`) leaning towards the most played, and the
 * Library's when plays are short, then artists similar to the Library's when
 * its artists are too few (those the phone has read: `similarOffline`), then
 * the top artists of YouTube Music's chart while slots are left (read once a
 * week only then, else as kept: `chartArtists`). "nothing-to-build-from"
 * when there are no seeds (no plays, an empty Library and no chart), null
 * when no seed made a usable mix: either way what was saved stays, and a
 * later visit can try again. A refresh passes [avoid] (`mixRefreshAvoid`):
 * other artists, other songs.
 */
const buildArtistMixes = (inputs: MixBuildInputs, avoid?: MixRefreshAvoid) =>
  Effect.gen(function* () {
    const library = inputs.library;
    const pools = yield* withSimilar(yield* artistMixPools(library, avoid), similarOffline);
    const needsChart = yield* runSteps(artistMixNeedsChartSteps(pools), recommendationTurnEffect);
    const seeds = yield* runSteps(
      artistMixSeedsSteps(
        needsChart ? { ...pools, chart: yield* chartArtists } : pools,
        Math.random,
      ),
      recommendationTurnEffect,
    );
    if (seeds.length === 0) return "nothing-to-build-from" as const;
    SECTIONS["artist-mixes"].picked = seeds;
    const avoidSongs = avoid?.songs;
    const ranked = yield* radioMixes(seeds, inputs, avoidSongs, true);
    const built = discoverMixesBuilt(
      ranked.mixes,
      Date.now(),
      seeds,
      avoidSongs === undefined ? {} : { avoid: avoidSongs },
    );
    if (built !== null) rankedAt.set(built, ranked.sliders);
    return built;
  });

/**
 * Builds Genre mixes from the Library's genre families with five songs or
 * more, most played first, each from its three most played artists.
 * Untagged artists inherit a known family from direct graph neighbours.
 * "nothing-to-build-from" when no family has enough songs (the section
 * hides), null when no seed made a usable mix. A refresh passes [avoid]
 * (`mixRefreshAvoid`): other families or other artists, other songs.
 */
const buildGenreMixes = (inputs: MixBuildInputs, avoid?: MixRefreshAvoid) =>
  Effect.gen(function* () {
    const library = inputs.library;
    const seeds = yield* runSteps(
      genreMixSeedsSteps(
        {
          ...library,
          graph: inputs.graph,
          profileOf: (name) => inputs.profiles.profileOf(name) ?? lookedUpProfileOf(name),
        },
        avoid,
      ),
      recommendationTurnEffect,
    );
    if (seeds.length === 0) return "nothing-to-build-from" as const;
    SECTIONS["genre-mixes"].picked = seeds;
    const ranked = yield* radioMixes(seeds, inputs, avoid?.songs, true);
    const built = discoverMixesBuilt(
      ranked.mixes,
      Date.now(),
      seeds,
      avoid === undefined ? {} : { avoid: avoid.songs },
    );
    if (built !== null) rankedAt.set(built, ranked.sliders);
    return built;
  });

/** What a build made, for its line in the app log. */
const builtOutcome = (built: DiscoverMixes | null | "nothing-to-build-from"): string => {
  if (built === "nothing-to-build-from") return "nothing to build from";
  const count = built?.mixes.length ?? 0;
  return count === 0 ? "no mix" : count === 1 ? "1 mix" : `${count} mixes`;
};

/** Each row builds independently from the last completed inputs. */
const loggedBuild = (ids: readonly MixSectionId[], pulled: boolean, avoid?: MixRefreshAvoid) =>
  withNetworkLog(
    `${ids.length === 1 ? discoverRowTitle(ids[0]!) : "Home mixes"} ${pulled ? "refresh" : "build"}`,
    buildHomeMixes(
      ids,
      Effect.void,
      (id) => Effect.flatMap(mixBuildInputs, (inputs) => SECTIONS[id].build(inputs, avoid)),
      settledTurnEffect,
    ),
    (results) =>
      results
        .map(
          ({ id, result }) =>
            `${discoverRowTitle(id)}: ${Result.isSuccess(result) ? builtOutcome(result.success) : "failed"}`,
        )
        .join(", "),
  );

/** When a build made no mixes: try again after a while, not on every visit. */
const RETRY_MS = 10 * 60 * 1000;

/** One of Home's mix sections: its saved mixes, its build and how a build is going. */
interface MixSection {
  /**
   * The mixes last built, kept on this phone (not synced: they're built from
   * its plays). Mixes saved in an older format read as none (Core's
   * `parseDiscoverMixes`), so they're built again on the next Home visit.
   */
  readonly saved: PersistedSetting<DiscoverMixes | null>;
  /**
   * Whether the last build found no seeds at all: the section hides instead
   * of showing its skeleton. Kept on the phone, so a Library that has
   * nothing to build from doesn't flash a skeleton on every launch.
   */
  readonly nothingToBuildFrom: PersistedSetting<boolean>;
  /**
   * The sets of mixes the section showed today (Core's `mixesShown`): what
   * a refresh avoids. The day's automatic build starts it afresh.
   */
  readonly shown: PersistedSetting<ShownMixes[]>;
  readonly build: typeof buildArtistMixes;
  /**
   * How long a build that found nothing to build from waits for the next:
   * none for Artist mixes, so the visit after an import builds at once;
   * a while for Genre mixes, whose Library may have no eligible family.
   */
  readonly nothingRetryMs: number;
  /**
   * A build going on: Home coming back into focus meanwhile doesn't start
   * another, and the section says it's updating over the saved mixes.
   */
  readonly building: ExternalStore<boolean>;
  readonly failed: ExternalStore<boolean>;
  /** After a build that made no mixes: no build before then (ms since the epoch). */
  retryAt: number | null;
  /** The seeds this session's last build picked, those it made no mix of too; null before one. */
  picked: readonly DiscoverMixSeed[] | null;
  /** The sliders the saved mixes were last ranked at; null: not known (saved before this launch). */
  rankedWith: MixSliders | null;
  /** A re-rank going on (`rerank`). */
  reranking: boolean;
  /** Sliders moved while a build or a re-rank went on: re-rank after it. */
  rerankAfter: boolean;
}

const flag = (key: string) =>
  persistedSetting<boolean>({
    key,
    read: (stored) => stored === "1",
    write: (value) => (value ? "1" : null),
  });

const section = (
  key: string,
  build: typeof buildArtistMixes,
  nothingRetryMs: number,
): MixSection => ({
  saved: persistedSetting<DiscoverMixes | null>({
    key,
    read: parseDiscoverMixes,
    write: (mixes) => (mixes === null ? null : storedDiscoverMixes(mixes)),
  }),
  nothingToBuildFrom: flag(`${key}.nothingToBuildFrom`),
  shown: persistedSetting<ShownMixes[]>({
    key: `${key}.shown`,
    read: parseMixesShown,
    write: (memory) => (memory.length === 0 ? null : storedMixesShown(memory)),
  }),
  build,
  nothingRetryMs,
  building: makeExternalStore(false),
  failed: makeExternalStore(false),
  retryAt: null,
  picked: null,
  rankedWith: null,
  reranking: false,
  rerankAfter: false,
});

const SECTIONS: Record<MixSectionId, MixSection> = {
  // Discover mixes' key: Artist mixes took its place.
  "artist-mixes": section("home.discoverMixes", buildArtistMixes, 0),
  "genre-mixes": section("home.genreMixes", buildGenreMixes, RETRY_MS),
};

/**
 * Starts each due row independently ([played]: the owner has counted plays).
 * Saved mixes remain visible until that row saves a successful build.
 */
const refresh = (played: boolean, onlyEmpty = false): void => {
  const ids = homeMixBuildsDue(
    (Object.keys(SECTIONS) as MixSectionId[])
      .filter((id) => !onlyEmpty || SECTIONS[id].saved.get() === null)
      .map((id) => ({
        id,
        saved: SECTIONS[id].saved.get(),
        building: SECTIONS[id].building.get(),
        retryAt: SECTIONS[id].retryAt,
      })),
    {
      now: Date.now(),
      played,
      // Mixes seeded from the chart alone give way once the Library can seed.
      librarySeeds: libraryCanSeedArtistMixes(recommendationSnapshot.peek().library?.artists ?? []),
    },
  );
  if (ids.length === 0) {
    return;
  }
  // Claim every row before yielding: another focus callback cannot launch it again.
  for (const id of ids) {
    SECTIONS[id].building.set(true);
    SECTIONS[id].failed.set(false);
  }
  // Save each row as soon as its radios finish.
  for (const id of ids) {
    const mixSection = SECTIONS[id];
    void appRuntime
      .runPromise(Effect.result(loggedBuild([id], false)))
      .then((attempt) => {
        const result = Result.isSuccess(attempt)
          ? attempt.success[0]!.result
          : Result.fail(attempt.failure);
        const built = Result.isSuccess(result) ? result.success : null;
        mixSection.failed.set(built === null);
        if (built !== null && built !== "nothing-to-build-from") {
          mixSection.retryAt = null;
          mixSection.nothingToBuildFrom.set(false);
          saveBuilt(id, built);
          mixSection.shown.set(mixesShown([], built, Date.now()));
        } else if (built === "nothing-to-build-from") {
          const wait = mixSection.nothingRetryMs;
          mixSection.retryAt = wait === 0 ? null : Date.now() + wait;
          mixSection.nothingToBuildFrom.set(true);
        } else {
          mixSection.retryAt = Date.now() + RETRY_MS;
          if (Result.isSuccess(result)) mixSection.nothingToBuildFrom.set(false);
        }
      })
      .catch(() => {
        mixSection.failed.set(true);
        mixSection.retryAt = Date.now() + RETRY_MS;
      })
      .finally(() => {
        mixSection.building.set(false);
        rerankAfterward(id);
      });
  }
};

/** The toast after a refresh saved new mixes; its Undo puts the previous ones back. */
const NEW_MIXES = "New mixes";

/**
 * Builds [id]'s mixes again now, for new ones (the owner pulled its
 * carousel past its start): only that section, whether or not a build is
 * due, its new mixes avoiding the seeds and new songs it showed today where
 * others are left (Core's `mixRefreshAvoid`). Does nothing while the
 * section builds. Its saved mixes stay, "Updating…" in the header, until
 * the new ones are saved and crossfade in, counting as the section's build
 * for the day; a "New mixes" toast then offers Undo, which puts the
 * previous set back while the toast shows. A refresh that makes no mixes
 * keeps the current mixes and says so. Mixes reuse fresh radios or
 * read their first pages with an eight-second network deadline.
 */
export const refreshMixes = (id: MixSectionId): void => {
  const mixSection = SECTIONS[id];
  if (mixSection.building.get()) return;
  const { saved, shown, building } = mixSection;
  const now = Date.now();
  const previous = saved.get();
  const memory = previous === null ? shown.get() : mixesShown(shown.get(), previous, now);
  building.set(true);
  mixSection.failed.set(false);
  void appRuntime
    .runPromise(Effect.result(loggedBuild([id], true, mixRefreshAvoid(memory, now))))
    .then((result) => {
      const row = Result.isSuccess(result)
        ? result.success[0]!.result
        : Result.fail(result.failure);
      const built = Result.isSuccess(row) ? row.success : null;
      if (built === null || built === "nothing-to-build-from") {
        mixSection.failed.set(true);
        return;
      }
      mixSection.retryAt = null;
      mixSection.nothingToBuildFrom.set(false);
      saveBuilt(id, built);
      shown.set(mixesShown(memory, built, Date.now()));
      if (previous === null) return;
      void showToast(NEW_MIXES, {
        label: "Undo",
        run: () => {
          // Another build saved since: Undo would throw its mixes away.
          if (saved.get() !== built || building.get()) return;
          const undone = undoneMixRefresh(previous, built, Date.now());
          saved.set(undone);
          // It was ranked at the sliders of its time: the next slider move ranks it again.
          mixSection.rankedWith = null;
          shown.set(mixesShown(shown.get(), undone, Date.now()));
        },
      });
    })
    .catch(() => mixSection.failed.set(true))
    .finally(() => {
      building.set(false);
      rerankAfterward(id);
    });
};

/**
 * How [id]'s saved mixes are blended now: its level, leaving out Library
 * songs [tracks] (the Library's songs by id) doesn't have, new songs the
 * owner streamed or put in a playlist since the build (as of the last
 * re-blend, `refreshKnownVideos`), and explicit songs while Don't play
 * explicit is on (Core's `discoverMixKeep`). Without [tracks] (Home, which
 * doesn't read every song; or the Library not read yet), every one counts
 * as there, flagged as the build saw it.
 */
const useBlend = (
  id: MixSectionId,
  tracks: ReadonlyMap<number, SongRow> | null,
): DiscoverMixBlend => {
  const level = useDiscoverLevel();
  const dontPlayExplicit = useDontPlayExplicit();
  const knownVideos = useKnownVideos();
  return useMemo(
    () => ({
      level,
      keep: discoverMixKeep({
        dontPlayExplicit,
        library: tracks,
        ...(knownVideos === null ? {} : { knownVideos }),
      }),
    }),
    [level, tracks, dontPlayExplicit, knownVideos],
  );
};

/**
 * [mix]'s songs that stream, in its order: its new songs and its familiar
 * songs the phone has no file for. What its Download downloads.
 */
export const newSongsOf = (mix: BlendedDiscoverMix): YtAlbumSong[] =>
  mix.songs.flatMap((song) => (song.source === "stream" ? [song.song] : []));

/** The Library's songs by id (the shared `songs` query), or null until it's read. */
export const useLibraryTracks = (): ReadonlyMap<number, SongRow> | null => {
  const songs = useLibraryQuery(libraryListQueries.songs, null);
  return useMemo(
    () => (songs === null ? null : new Map(songs.map((song) => [song.id, song]))),
    [songs],
  );
};

/**
 * What the Home mix section [id] shows (`discoverMixesSection`): the last
 * mixes built, blended by its level (saying they're updating while a
 * rebuild runs), a skeleton while the first ones build, or nothing while YT
 * Music is off, or for Genre mixes while the Library is [empty] (no tagged
 * songs). The screen warms both rows through `useDiscoverMixesFocus`.
 */
export const useDiscoverMixes = (id: MixSectionId, empty = false): DiscoverMixesSection => {
  const { saved, nothingToBuildFrom, building, failed } = SECTIONS[id];
  const enabled = useYtMusicEnabled();
  const mixes = saved.useValue();
  const blend = useBlend(id, null);
  const nothing = nothingToBuildFrom.useValue();
  const rebuilding = useSyncExternalStore(building.subscribe, building.get);
  const buildFailed = useSyncExternalStore(failed.subscribe, failed.get);
  const shown = useMemo(
    () =>
      discoverMixesSection(mixes, {
        ytMusic: enabled,
        nothingToBuildFrom: nothing,
        blend,
        building: rebuilding,
        failed: buildFailed,
        noTaggedSongs: id === "genre-mixes" && empty,
      }),
    [id, mixes, enabled, nothing, blend, rebuilding, buildFailed, empty],
  );
  // The start of what Home shows is fetched ahead on Wi-Fi.
  useEffect(() => noteMixesShown(id, shown), [id, shown]);
  return shown;
};

/**
 * The mix [id] as last built (an artist or a genre mix), blended by its
 * section's level with the Library songs [tracks] has (`useLibraryTracks`),
 * or null when there's none (YT Music off, rebuilt without it, or too short
 * with Don't play explicit on: Core's `savedDiscoverMix`).
 */
export const useDiscoverMix = (
  id: string,
  tracks: ReadonlyMap<number, SongRow> | null,
): BlendedDiscoverMix | null => {
  const sectionId = mixSectionOfId(id);
  const enabled = useYtMusicEnabled();
  const mixes = SECTIONS[sectionId].saved.useValue();
  const blend = useBlend(sectionId, tracks);
  // Opening a mix's page or menu re-blends it with what the owner knows now.
  useEffect(refreshKnownVideos, []);
  return useMemo(
    () => (enabled ? savedDiscoverMix(mixes, id, blend) : null),
    [enabled, mixes, id, blend],
  );
};

/** Both mix rows warm their inputs once per screen focus. */
const focusMixes = (played: boolean): void => {
  refreshKnownVideos();
  const previousLibrary = recommendationSnapshot.peek().library;
  void appRuntime
    .runPromise(recommendationSnapshot.library)
    .then((library) => {
      // A newly completed index can provide seeds a cold or empty Library did not have.
      if (library !== previousLibrary) refresh(played);
      void appRuntime.runPromise(tasteProfileForRecommendation(library)).catch(() => {});
    })
    .catch(() => {});
  const previousGraph = recommendationSnapshot.peek().graph;
  void appRuntime
    .runPromise(recommendationSnapshot.graph)
    .then((graph) => {
      const genre = SECTIONS["genre-mixes"];
      if (graph !== previousGraph && genre.saved.get() === null) {
        genre.retryAt = null;
        refresh(played, true);
      }
    })
    .catch(() => {});
  // Focus changes leave the in-flight attempt running to completion.
  refresh(played);
};

export const useDiscoverMixesFocus = (enabled: boolean, played: boolean | undefined): void => {
  useDiscoverFocus(enabled, played, focusMixes);
};
