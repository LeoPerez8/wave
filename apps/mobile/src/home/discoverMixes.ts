/**
 * Home's mix sections (docs/spec.md, "Artist mixes" and "Genre mixes"):
 * songs the owner doesn't know, and a familiar share (Library songs, and
 * songs the owner played or has in a playlist, which stream) the section's
 * level blends in (`blendDiscoverMix`). Artist mixes grow from one artist
 * each: the owner's most played artists, picked at random each build but
 * leaning towards the most played (the Library's artists when plays are
 * short, then artists similar to the Library's). Genre mixes grow from a
 * genre family and up to three of its artists. A build reads only the
 * phone: each seed's songs are Wave's engine's ranking of the candidate
 * catalog (`catalogMixRead`, `recommend`: the seed's radios and its
 * neighbourhood in the artist graph, a genre mix's family across artists),
 * and the mixes' rules are Core's (`artistMixSeeds`, `genreMixSeeds`,
 * `mixKnownSongs`, `discoverMixesOfRadios`, `discoverMixesDue`). The
 * network only refills the catalog, in the background (`mixHarvest.ts`).
 * This keeps each section's last mixes built, so Home shows them at once
 * (and what a section shows meanwhile is Core's `discoverMixesSection`).
 * Each section builds, saves and blends on its own: a song may be in an
 * artist mix and a genre mix.
 */
import {
  artistMixSeeds,
  catalogMixReader,
  discoverMixKeep,
  discoverMixesBuilt,
  discoverMixesDue,
  discoverMixesOfCatalog,
  discoverMixesRerun,
  discoverMixesSection,
  genreMixSeeds,
  discoverRowTitle,
  mixesShown,
  mixRefreshAvoid,
  libraryStyleOf,
  mixSlidersEngine,
  mixSectionOfId,
  parseDiscoverMixes,
  parseMixesShown,
  rerankedDiscoverMixes,
  savedDiscoverMix,
  storedDiscoverMixes,
  storedMixesShown,
  undoneMixRefresh,
  type ArtistGraph,
  type BlendedDiscoverMix,
  type CatalogMixReader,
  type CatalogSong,
  type DiscoverMixBlend,
  type DiscoverMixSeed,
  type DiscoverMixes,
  type DiscoverMixesSection,
  type MixRefreshAvoid,
  type MixSliders,
  type ShownMixes,
  type TasteProfile,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { withNetworkLog } from "@/lib/networkMeter";
import { persistedSetting, type PersistedSetting } from "@/lib/persistedSetting";
import { libraryListQueries } from "@/library/hooks";
import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { useLibraryQuery } from "@/library/sharedQueries";
import { showToast } from "@/overlay/toast";
import { tasteProfileNow } from "@/playback/TasteProfile";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { mixProfileOf } from "./artistGenres";
import { artistGraphNow } from "./artistGraphNow";
import { artistMixPools } from "./artistMixPools";
import {
  discoverSlidersNow,
  setMixSlidersListener,
  useDiscoverLevel,
  type MixSectionId,
} from "./discoverMixLevel";
import { mixCatalog } from "./mixCatalog";
import { harvestSoon, onHarvested, setPickedSeeds } from "./mixHarvest";
import { mixIndexes, refreshKnownVideos, useKnownVideos, type MixIndexes } from "./mixKnown";
import { noteMixesShown } from "./mixPreDownload";
import { similarOffline, withSimilar } from "./similarArtists";

export type { MixSectionId } from "./discoverMixLevel";

/**
 * The mixes [seeds] make from the candidate catalog, or null when no seed
 * made a usable mix: each seed's catalog read (`catalogMixReader`: the
 * engine's ranking over the catalog, the artist graph, the genre profiles
 * and the owner's taste profile at the section's sliders, [avoid]ed songs
 * last, a random nudge each build, its variety saved with the mixes along
 * with the seeds, so a slider move re-ranks them: `rerank`), then the
 * seeds take their songs in seed order (Core's `discoverMixesOfCatalog`),
 * so no new song is in two of the section's mixes (and no familiar song in
 * two of its shares). A seed the catalog has no songs for yet makes no mix:
 * the harvest refills it, and the section has what the others make. No
 * request; it gives the JavaScript thread back after each seed
 * (`freeTurnEffect`), so Home stays smooth.
 */
const mixesOf = (
  id: MixSectionId,
  seeds: readonly DiscoverMixSeed[],
  library: MixIndexes,
  avoid: MixRefreshAvoid | undefined,
) =>
  Effect.gen(function* () {
    SECTIONS[id].picked = seeds;
    // A build's variety, kept with its mixes so a slider move re-ranks them as they were.
    const variety = Math.floor(Math.random() * 2 ** 31);
    const reader = yield* readerOf(id, library, variety);
    yield* freeTurnEffect;
    // A refresh's new songs leave out those the section showed today, where it can.
    const avoidSongs = avoid === undefined ? undefined : avoid.songs;
    const ranked = yield* rankedMixes(id, reader, seeds, library, avoidSongs);
    const built = discoverMixesBuilt(ranked.mixes, Date.now(), seeds, {
      ...(avoidSongs === undefined ? {} : { avoid: avoidSongs }),
      variety,
    });
    if (built !== null) rankedAt.set(built, ranked.sliders);
    return built;
  });

/** The sliders each build's mixes were ranked at: the section's `rankedWith` once they're saved. */
const rankedAt = new WeakMap<DiscoverMixes, MixSliders>();

/** Saves [built] as [id]'s mixes, with the sliders they were ranked at. */
const saveBuilt = (id: MixSectionId, built: DiscoverMixes): void => {
  const mixSection = SECTIONS[id];
  mixSection.saved.set(built);
  mixSection.rankedWith = rankedAt.get(built) ?? null;
};

/**
 * The mixes [seeds] make by [reader] (Core's `discoverMixesOfCatalog`),
 * ranked at [id]'s sliders as they are once every seed's walk is done
 * (giving the JavaScript thread back before each, `freeTurnEffect`, which
 * waits out a finger on a slider), with the sliders they were ranked at.
 */
const rankedMixes = (
  id: MixSectionId,
  reader: CatalogMixReader,
  seeds: readonly DiscoverMixSeed[],
  library: MixIndexes,
  avoid: ReadonlySet<string> | undefined,
) =>
  Effect.gen(function* () {
    for (const seed of seeds) {
      reader.read(seed);
      yield* freeTurnEffect;
    }
    const sliders = discoverSlidersNow();
    const mixes = discoverMixesOfCatalog(seeds, reader, {
      known: library.known,
      library,
      ...mixSlidersEngine(sliders),
      ...(avoid === undefined ? {} : { avoid }),
    });
    return { mixes, sliders };
  });

/** A section's last reader of catalog reads, with what it reads: kept for the re-ranks after a build. */
interface ReaderMemo {
  readonly reader: CatalogMixReader;
  readonly variety: number | undefined;
  readonly catalog: readonly CatalogSong[];
  readonly graph: ArtistGraph | null;
  readonly taste: TasteProfile | null;
  readonly library: MixIndexes;
}

/**
 * [id]'s reader of catalog reads (`catalogMixReader`) over the catalog, the
 * artist graph, the genre profiles and the owner's taste profile now, with
 * [variety]: the section's last one while all of them are the same, so a
 * re-rank after a build only weighs its songs again.
 */
const readerOf = (id: MixSectionId, library: MixIndexes, variety: number | undefined) =>
  Effect.gen(function* () {
    const catalog = yield* mixCatalog;
    const graph = yield* artistGraphNow;
    const taste = yield* tasteProfileNow;
    const memo = SECTIONS[id].reader;
    if (
      memo !== null &&
      memo.variety === variety &&
      memo.catalog === catalog &&
      memo.graph === graph &&
      memo.taste === taste &&
      memo.library === library
    )
      return memo.reader;
    const sources = {
      catalog,
      graph,
      profileOf: mixProfileOf(library),
      styleOf: libraryStyleOf(library),
      taste,
      now: Date.now(),
    };
    const reader = catalogMixReader(
      { ...sources, library },
      variety === undefined ? {} : { variety },
    );
    SECTIONS[id].reader = { reader, variety, catalog, graph, taste, library };
    return reader;
  });

/**
 * [saved] ranked again from the catalog at [id]'s sliders now: the build's
 * seeds, avoided songs and variety (Core's `discoverMixesRerun`), no new
 * seed picked and no request, then the seeds take their songs in order as
 * a build's do. The saved mixes when it makes none.
 */
const rerankedOf = (id: MixSectionId, saved: DiscoverMixes) =>
  Effect.gen(function* () {
    const library = yield* mixIndexes;
    const { seeds, avoid, variety } = discoverMixesRerun(saved, library.artists);
    const reader = yield* readerOf(id, library, variety);
    const avoidSongs = avoid.size === 0 ? undefined : avoid;
    const { mixes, sliders } = yield* rankedMixes(id, reader, seeds, library, avoidSongs);
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
    .runPromise(Effect.result(rerankedOf(id, saved)))
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
 * its artists are too few (those the phone has read: `similarOffline`).
 * "nothing-to-build-from" when there are no seeds (no plays and an empty
 * Library), null when no seed made a usable mix: either way what was saved
 * stays, and a later visit can try again. A refresh passes [avoid]
 * (`mixRefreshAvoid`): other artists, other songs.
 */
const buildArtistMixes = (avoid?: MixRefreshAvoid) =>
  Effect.gen(function* () {
    const library = yield* mixIndexes;
    const seeds = artistMixSeeds(
      yield* withSimilar(yield* artistMixPools(library, avoid), similarOffline),
      Math.random,
    );
    if (seeds.length === 0) return "nothing-to-build-from" as const;
    return yield* mixesOf("artist-mixes", seeds, library, avoid);
  });

/**
 * Builds Genre mixes from the Library's genre families with five songs or
 * more, most played first, each from up to three of its artists picked at
 * random (`Math.random`) leaning towards those most played in it.
 * "nothing-to-build-from" when no family has enough songs (the section
 * hides), null when no seed made a usable mix. A refresh passes [avoid]
 * (`mixRefreshAvoid`): other families or other artists, other songs.
 */
const buildGenreMixes = (avoid?: MixRefreshAvoid) =>
  Effect.gen(function* () {
    const library = yield* mixIndexes;
    const seeds = genreMixSeeds(library, Math.random, avoid);
    if (seeds.length === 0) return "nothing-to-build-from" as const;
    return yield* mixesOf("genre-mixes", seeds, library, avoid);
  });

/** What a build made, for its line in the app log. */
const builtOutcome = (built: DiscoverMixes | null | "nothing-to-build-from"): string => {
  if (built === "nothing-to-build-from") return "nothing to build from";
  const count = built?.mixes.length ?? 0;
  return count === 0 ? "no mix" : count === 1 ? "1 mix" : `${count} mixes`;
};

/**
 * [id]'s build ([pulled]: a refresh the owner pulled for), writing its
 * network use to the app log as it ends (`withNetworkLog`).
 */
const loggedBuild = (id: MixSectionId, pulled: boolean, avoid?: MixRefreshAvoid) =>
  withNetworkLog(
    `${discoverRowTitle(id)} ${pulled ? "refresh" : "build"}`,
    SECTIONS[id].build(avoid),
    builtOutcome,
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
   * none for Artist mixes (it asks nothing, so the visit after an import
   * builds at once), a while for Genre mixes, which reads the whole Library
   * and is often left without families.
   */
  readonly nothingRetryMs: number;
  /**
   * A build going on: Home coming back into focus meanwhile doesn't start
   * another, and the section says it's updating over the saved mixes.
   */
  readonly building: ExternalStore<boolean>;
  /** After a build that made no mixes: no build before then (ms since the epoch). */
  retryAt: number | null;
  /** The seeds this session's last build picked, those it made no mix of too; null before one. */
  picked: readonly DiscoverMixSeed[] | null;
  /** The last reader of catalog reads, for re-ranks at once (`readerOf`). */
  reader: ReaderMemo | null;
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
  retryAt: null,
  picked: null,
  reader: null,
  rankedWith: null,
  reranking: false,
  rerankAfter: false,
});

const SECTIONS: Record<MixSectionId, MixSection> = {
  // Discover mixes' key: Artist mixes took its place.
  "artist-mixes": section("home.discoverMixes", buildArtistMixes, 0),
  "genre-mixes": section("home.genreMixes", buildGenreMixes, RETRY_MS),
};

// What a harvest on mobile data refills: each section's last build's seeds,
// this session's or, after a relaunch, those its saved mixes were built from.
setPickedSeeds(() =>
  Object.values(SECTIONS).flatMap((mixSection) => {
    if (mixSection.picked !== null) return mixSection.picked;
    const saved = mixSection.saved.get();
    return saved === null ? [] : discoverMixesRerun(saved, []).seeds;
  }),
);

/**
 * Builds [id]'s mixes again when Core says they're due ([played]: the owner
 * has counted plays), then lets the harvest refill the catalog
 * (`harvestSoon`); when no build is due, the harvest goes at once.
 */
const refresh = (id: MixSectionId, played: boolean): void => {
  const mixSection = SECTIONS[id];
  const now = Date.now();
  if (
    mixSection.building.get() ||
    !discoverMixesDue(mixSection.saved.get(), { now, played }) ||
    (mixSection.retryAt !== null && now < mixSection.retryAt)
  ) {
    harvestSoon();
    return;
  }
  mixSection.building.set(true);
  void appRuntime
    .runPromise(Effect.result(loggedBuild(id, false)))
    .then((result) => {
      const built = Result.isSuccess(result) ? result.success : null;
      if (built !== null && built !== "nothing-to-build-from") {
        mixSection.retryAt = null;
        mixSection.nothingToBuildFrom.set(false);
        saveBuilt(id, built);
        // The day's build: what refreshes avoid starts again from it.
        mixSection.shown.set(mixesShown([], built, Date.now()));
        return;
      }
      if (built === "nothing-to-build-from") {
        const wait = mixSection.nothingRetryMs;
        mixSection.retryAt = wait === 0 ? null : Date.now() + wait;
        mixSection.nothingToBuildFrom.set(true);
        return;
      }
      mixSection.retryAt = Date.now() + RETRY_MS;
      if (Result.isSuccess(result)) mixSection.nothingToBuildFrom.set(false);
    })
    .finally(() => {
      mixSection.building.set(false);
      rerankAfterward(id);
      harvestSoon();
    });
};

// A harvest that refilled the catalog builds a section that has no mixes yet
// (a fresh install's first ones), without waiting for its retry.
onHarvested(() => {
  for (const id of Object.keys(SECTIONS) as MixSectionId[]) {
    const mixSection = SECTIONS[id];
    if (mixSection.saved.get() !== null) continue;
    mixSection.retryAt = null;
    refresh(id, false);
  }
});

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
 * (nothing usable in the catalog) keeps them and says so. It reads only
 * the phone; the harvest after it refills what it used up.
 */
export const refreshMixes = (id: MixSectionId): void => {
  const mixSection = SECTIONS[id];
  if (mixSection.building.get()) return;
  const { saved, shown, building } = mixSection;
  const now = Date.now();
  const previous = saved.get();
  const memory = previous === null ? shown.get() : mixesShown(shown.get(), previous, now);
  building.set(true);
  void appRuntime
    .runPromise(Effect.result(loggedBuild(id, true, mixRefreshAvoid(memory, now))))
    .then((result) => {
      const built = Result.isSuccess(result) ? result.success : null;
      if (built === null || built === "nothing-to-build-from") {
        void showToast(`Couldn't refresh ${discoverRowTitle(id)}`);
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
    .finally(() => {
      building.set(false);
      rerankAfterward(id);
      harvestSoon();
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
 * Music is off. Each time Home comes into focus with YT
 * Music on, they're built again if they weren't today, and while it's in
 * focus once [played] turns true (the first counted plays) if the last build
 * had no seeds from plays.
 */
export const useDiscoverMixes = (id: MixSectionId, played: boolean): DiscoverMixesSection => {
  const { saved, nothingToBuildFrom, building } = SECTIONS[id];
  const enabled = useYtMusicEnabled();
  const mixes = saved.useValue();
  const blend = useBlend(id, null);
  const nothing = nothingToBuildFrom.useValue();
  const rebuilding = useSyncExternalStore(building.subscribe, building.get);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      refreshKnownVideos();
      refresh(id, played);
    }, [enabled, id, played]),
  );
  const shown = useMemo(
    () =>
      discoverMixesSection(mixes, {
        ytMusic: enabled,
        nothingToBuildFrom: nothing,
        blend,
        building: rebuilding,
      }),
    [mixes, enabled, nothing, blend, rebuilding],
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
