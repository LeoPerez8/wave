/**
 * Home's mix sections (docs/spec.md, "Artist mixes" and "Genre mixes"):
 * YouTube Music radios' songs the owner doesn't know, and a familiar share
 * (Library songs, and songs the owner played or has in a playlist, which
 * stream) the section's level blends in (`blendDiscoverMix`). Artist mixes grow from one artist's
 * radio each: the owner's most played artists, picked at random each build
 * but leaning towards the most played (the Library's artists when plays are
 * short, then artists similar to the Library's). Genre mixes grow from a
 * genre family's radios, up to three of its artists' read at once and
 * interleaved. Which seeds, which artist pages to read for similar artists,
 * which songs are new, which are familiar and when to build again are
 * Core's (`artistMixSeeds`, `genreMixSeeds`, `artistMixSimilarSource`,
 * `interleaveRadios`, `mixKnownSongs`, `discoverMixSongs`,
 * `discoverMixFamiliarPool`, `discoverMixesDue`); this asks YouTube Music and keeps each section's last
 * mixes built, so Home shows them at once (and what a section shows
 * meanwhile is Core's `discoverMixesSection`). Each section builds, saves
 * and blends on its own: a song may be in an artist mix and a genre mix.
 */
import {
  artistMixSeeds,
  artistMixSimilarSource,
  discoverMixKeep,
  discoverMix,
  discoverMixFamiliarPool,
  discoverMixReadsMore,
  discoverMixSongs,
  discoverMixesBuilt,
  discoverMixesDue,
  discoverMixesSection,
  genreMixSeeds,
  homeSectionTitle,
  identityKey,
  interleaveRadios,
  mixesShown,
  mixRefreshAvoid,
  mixRefreshWaitNotice,
  mixSectionOfId,
  mixSeedArtists,
  parseDiscoverMixes,
  parseMixesShown,
  pickYtArtist,
  savedDiscoverMix,
  storedDiscoverMixes,
  storedMixesShown,
  undoneMixRefresh,
  ytArtistLookup,
  type ArtistMixPools,
  type BlendedDiscoverMix,
  type DiscoverMix,
  type DiscoverMixBlend,
  type DiscoverMixFilter,
  type DiscoverMixSeed,
  type DiscoverMixes,
  type DiscoverMixesSection,
  type DiscoverSimilarArtists,
  type MixRefreshAvoid,
  type ShownMixes,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { persistedSetting, type PersistedSetting } from "@/lib/persistedSetting";
import { libraryListQueries } from "@/library/hooks";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { useLibraryQuery } from "@/library/sharedQueries";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { showToast } from "@/overlay/toast";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { Stats } from "@/stats/Stats";
import { searchAllowanceFreeAt, withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

import { useDiscoverMixLevel, type MixSectionId } from "./discoverMixLevel";
import { mixIndexes, refreshKnownVideos, useKnownVideos, type MixIndexes } from "./mixKnown";

export type { MixSectionId } from "./discoverMixLevel";

/** How many of the most played artists Artist mixes' seeds are picked from. */
const SEED_POOL = 20;

/** What was saved for a Library artist's YT Music section, or null. */
const savedYtArtist = (name: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* store.ytArtist(identityKey(name)).pipe(Effect.orElseSucceed(() => null));
  });

/**
 * The YT Music artist page a Library artist's mix starts from: the match
 * their artist page saved, or the one an Artists search finds. Null when
 * YouTube Music has no such artist.
 */
const artistPage = (name: string) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const lookup = ytArtistLookup(name, yield* savedYtArtist(name));
    if (lookup === null) return null;
    if (lookup.kind === "page") return lookup.browseId;
    const { query } = lookup;
    const artists = yield* withSearchTurn("discover", query, ytMusic.searchArtists(query));
    return pickYtArtist(name, artists);
  });

/**
 * The artists a Library artist's YT Music page lists as similar: the page
 * their artist page saved when it has them, else the page read now. None
 * when YouTube Music has no such artist; fails when it doesn't answer.
 */
const similarArtists = (name: string) =>
  Effect.gen(function* () {
    const answer = yield* savedYtArtist(name);
    const listed = answer?.outcome === "found" ? answer.page.similar : undefined;
    if (listed !== undefined) return listed;
    const browseId = yield* artistPage(name);
    if (browseId === null) return [];
    const ytMusic = yield* YtMusic;
    return (yield* ytMusic.artist(browseId)).similar ?? [];
  });

/**
 * [pools] with the similar artists Core asks for (`artistMixSimilarSource`),
 * one Library artist's page at a time. A page that can't be read counts as
 * one with no similar artists, so the other seeds stand as they are.
 */
const withSimilar = (pools: ArtistMixPools) =>
  Effect.gen(function* () {
    const similar: DiscoverSimilarArtists[] = [];
    for (
      let source = artistMixSimilarSource(pools);
      source !== null;
      source = artistMixSimilarSource({ ...pools, similar })
    ) {
      const artists = yield* similarArtists(source.name).pipe(Effect.orElseSucceed(() => []));
      similar.push({ of: source.name, artists });
    }
    return { ...pools, similar };
  });

/**
 * The first page of an artist's radio (the Start radio of their artist page:
 * [browseId], else the one their name finds), or null when YouTube Music
 * doesn't have the artist; fails when the radio can't be started.
 */
const firstRadioPage = (artist: { readonly name: string; readonly browseId?: string }) =>
  Effect.gen(function* () {
    const browseId = artist.browseId ?? (yield* artistPage(artist.name));
    if (browseId === null) return null;
    return yield* (yield* YtMusic).radio({ browseId });
  });

type Filter = DiscoverMixFilter<NativeYtRadioSong>;

interface ReadingRadio {
  readonly songs: NativeYtRadioSong[];
  continuation: string | null;
}

/**
 * [seed]'s radios, read at the same time and interleaved (`interleaveRadios`;
 * an artist mix has one), a page of each after another while Core asks for
 * more (a radio whose start or later page fails is left at what was read):
 * the new songs the mix keeps (`discoverMixSongs`, enough for level 5) and
 * every song the radios played, interleaved, for the mix's familiar share.
 * Null when no radio could be read.
 */
const readRadios = (seed: DiscoverMixSeed, filter: Filter) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const firstPages = yield* Effect.all(
      mixSeedArtists(seed).map((artist) => Effect.result(firstRadioPage(artist))),
      { concurrency: "unbounded" },
    );
    const radios: ReadingRadio[] = firstPages.flatMap((page) =>
      Result.isSuccess(page) && page.success !== null
        ? [{ songs: [...page.success.songs], continuation: page.success.continuation }]
        : [],
    );
    if (radios.length === 0) return null;
    const keep = () => discoverMixSongs([interleaveRadios(radios.map((r) => r.songs))], filter);
    let pages = 1;
    let kept = keep();
    while (
      discoverMixReadsMore({
        pages,
        kept: kept.length,
        more: radios.some((radio) => radio.continuation !== null),
      })
    ) {
      yield* Effect.all(
        radios.map((radio) =>
          radio.continuation === null
            ? Effect.void
            : Effect.result(ytMusic.radioMore(radio.continuation)).pipe(
                Effect.map((next) => {
                  if (Result.isFailure(next)) {
                    radio.continuation = null;
                    return;
                  }
                  radio.songs.push(...next.success.songs);
                  radio.continuation = next.success.continuation;
                }),
              ),
        ),
        { concurrency: "unbounded" },
      );
      pages += 1;
      kept = keep();
    }
    return { kept, radio: interleaveRadios(radios.map((r) => r.songs)) };
  });

/**
 * The mixes [seeds] make, one seed after another so no new song is in two
 * of the section's mixes (and no familiar song in two of its shares), or
 * null when no seed made a usable mix. It gives the JavaScript thread back
 * after each radio (`freeTurnEffect`), so Home stays smooth.
 */
const mixesOf = (
  seeds: readonly DiscoverMixSeed[],
  library: MixIndexes,
  avoid: MixRefreshAvoid | undefined,
) =>
  Effect.gen(function* () {
    const { known } = library;
    // A refresh's new songs leave out those the section showed today, where it can.
    const avoidSongs = avoid === undefined ? {} : { avoid: avoid.songs };
    const taken = new Set<string>();
    const takenFamiliar = { tracks: new Set<number>(), videos: new Set<string>() };
    const mixes: DiscoverMix[] = [];
    for (const seed of seeds) {
      const read = yield* Effect.result(
        readRadios(seed, { known: known.known, taken, ...avoidSongs }),
      );
      if (Result.isFailure(read) || read.success === null) continue;
      yield* freeTurnEffect;
      const { kept, radio } = read.success;
      const familiar = discoverMixFamiliarPool(seed, {
        radio,
        known,
        library,
        taken: takenFamiliar,
        length: kept.length,
      });
      const mix = discoverMix(seed, kept, familiar);
      if (mix === null) continue;
      mixes.push(mix);
      for (const song of mix.songs) taken.add(song.videoId);
      for (const song of familiar) {
        if (song.source === "library") takenFamiliar.tracks.add(song.track.id);
        else takenFamiliar.videos.add(song.song.videoId);
      }
    }
    return discoverMixesBuilt(mixes, Date.now(), seeds);
  });

/**
 * Builds Artist mixes from the owner's all-time most played artists, picked
 * at random (`Math.random`) leaning towards the most played, and the
 * Library's when plays are short, then artists similar to the Library's when
 * its artists are too few. "nothing-to-build-from" when there are no seeds
 * (no plays and an empty Library), null when no seed made a usable mix:
 * either way what was saved stays, and a later visit can try again. A
 * refresh passes [avoid] (`mixRefreshAvoid`): other artists, other songs.
 */
const buildArtistMixes = (avoid?: MixRefreshAvoid) =>
  Effect.gen(function* () {
    const stats = yield* Stats;
    const artists = yield* stats.topArtists("all", SEED_POOL);
    const library = yield* mixIndexes;
    const seeds = artistMixSeeds(
      yield* withSimilar({
        played: artists.map(({ item, countedPlays }) => ({
          id: item.id,
          name: item.name,
          countedPlays,
        })),
        library: library.artists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
        ...(avoid === undefined ? {} : { avoid }),
      }),
      Math.random,
    );
    if (seeds.length === 0) return "nothing-to-build-from" as const;
    return yield* mixesOf(seeds, library, avoid);
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
    return yield* mixesOf(seeds, library, avoid);
  });

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
});

const SECTIONS: Record<MixSectionId, MixSection> = {
  // Discover mixes' key: Artist mixes took its place.
  "artist-mixes": section("home.discoverMixes", buildArtistMixes, 0),
  "genre-mixes": section("home.genreMixes", buildGenreMixes, RETRY_MS),
};

/** Builds [id]'s mixes again when Core says they're due; [played]: the owner has counted plays. */
const refresh = (id: MixSectionId, played: boolean): void => {
  const mixSection = SECTIONS[id];
  const now = Date.now();
  if (mixSection.building.get() || !discoverMixesDue(mixSection.saved.get(), { now, played }))
    return;
  if (mixSection.retryAt !== null && now < mixSection.retryAt) return;
  mixSection.building.set(true);
  void appRuntime
    .runPromise(Effect.result(mixSection.build()))
    .then((result) => {
      const built = Result.isSuccess(result) ? result.success : null;
      if (built !== null && built !== "nothing-to-build-from") {
        mixSection.retryAt = null;
        mixSection.nothingToBuildFrom.set(false);
        mixSection.saved.set(built);
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
    });
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
 * (offline, nothing usable) keeps them and says so. Its searches share the
 * search allowance, and a toast says when that holds them back.
 */
export const refreshMixes = (id: MixSectionId): void => {
  const mixSection = SECTIONS[id];
  if (mixSection.building.get()) return;
  const { saved, shown, building } = mixSection;
  const now = Date.now();
  const previous = saved.get();
  const memory = previous === null ? shown.get() : mixesShown(shown.get(), previous, now);
  const freeAt = searchAllowanceFreeAt("discover");
  if (freeAt !== null) void showToast(mixRefreshWaitNotice(freeAt - now));
  building.set(true);
  void appRuntime
    .runPromise(Effect.result(mixSection.build(mixRefreshAvoid(memory, now))))
    .then((result) => {
      const built = Result.isSuccess(result) ? result.success : null;
      if (built === null || built === "nothing-to-build-from") {
        void showToast(`Couldn't refresh ${homeSectionTitle(id)}`);
        return;
      }
      mixSection.retryAt = null;
      mixSection.nothingToBuildFrom.set(false);
      saved.set(built);
      shown.set(mixesShown(memory, built, Date.now()));
      if (previous === null) return;
      void showToast(NEW_MIXES, {
        label: "Undo",
        run: () => {
          // Another build saved since: Undo would throw its mixes away.
          if (saved.get() !== built || building.get()) return;
          const undone = undoneMixRefresh(previous, built, Date.now());
          saved.set(undone);
          shown.set(mixesShown(shown.get(), undone, Date.now()));
        },
      });
    })
    .finally(() => {
      building.set(false);
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
  const level = useDiscoverMixLevel(id);
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
  return useMemo(
    () =>
      discoverMixesSection(mixes, {
        ytMusic: enabled,
        nothingToBuildFrom: nothing,
        blend,
        building: rebuilding,
      }),
    [mixes, enabled, nothing, blend, rebuilding],
  );
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
