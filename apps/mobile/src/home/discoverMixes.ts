/**
 * Home's mix sections (docs/spec.md, "Artist mixes" and "Genre mixes"):
 * YouTube Music radios' new songs, and a pool of Library songs the section's
 * level blends in (`blendDiscoverMix`). Artist mixes grow from one artist's
 * radio each: the owner's most played artists, picked at random each build
 * but leaning towards the most played (the Library's artists when plays are
 * short, then artists similar to the Library's). Genre mixes grow from a
 * genre family's radios, up to three of its artists' read at once and
 * interleaved. Which seeds, which artist pages to read for similar artists,
 * which songs, which Library songs and when to build again are Core's
 * (`artistMixSeeds`, `genreMixSeeds`, `artistMixSimilarSource`,
 * `interleaveRadios`, `discoverMixSongs`, `discoverMixLibraryPool`,
 * `discoverMixesDue`); this asks YouTube Music and keeps each section's last
 * mixes built, so Home shows them at once (and what a section shows
 * meanwhile is Core's `discoverMixesSection`). Each section builds, saves
 * and blends on its own: a song may be in an artist mix and a genre mix.
 */
import {
  artistMixSeeds,
  artistMixSimilarSource,
  discoverMixKeep,
  discoverMix,
  discoverMixLibraryPool,
  discoverMixReadsMore,
  discoverMixSongs,
  discoverMixesBuilt,
  discoverMixesDue,
  discoverMixesSection,
  genreMixSeeds,
  identityKey,
  interleaveRadios,
  libraryFinder,
  parseDiscoverMixes,
  pickYtArtist,
  playedFinder,
  savedDiscoverMix,
  statsWindow,
  storedDiscoverMixes,
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
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { persistedSetting, type PersistedSetting } from "@/lib/persistedSetting";
import { libraryListQueries } from "@/library/hooks";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { useLibraryQuery } from "@/library/sharedQueries";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { Stats } from "@/stats/Stats";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

import { useDiscoverMixLevel, type MixSectionId } from "./discoverMixLevel";

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

/** The artists whose radios [seed]'s mix grows from: a genre's seed artists, else its artist. */
const radioArtists = (
  seed: DiscoverMixSeed,
): readonly { readonly name: string; readonly browseId?: string }[] => seed.artists ?? [seed];

type Filter = Omit<DiscoverMixFilter<NativeYtRadioSong>, "seedVideo">;

interface ReadingRadio {
  readonly songs: NativeYtRadioSong[];
  continuation: string | null;
}

/**
 * [seed]'s radios, read at the same time and interleaved (`interleaveRadios`;
 * an artist mix has one), a page of each after another while Core asks for
 * more (a radio whose start or later page fails is left at what was read):
 * the new songs the mix keeps (`discoverMixSongs`, enough for level 5) and
 * every song the radios played, interleaved, for the mix's Library pool.
 * Null when no radio could be read.
 */
const readRadios = (seed: DiscoverMixSeed, filter: Filter) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const firstPages = yield* Effect.all(
      radioArtists(seed).map((artist) => Effect.result(firstRadioPage(artist))),
      { concurrency: "unbounded" },
    );
    const radios: ReadingRadio[] = firstPages.flatMap((page) =>
      Result.isSuccess(page) && page.success !== null
        ? [{ songs: [...page.success.songs], continuation: page.success.continuation }]
        : [],
    );
    if (radios.length === 0) return null;
    const mixFilter = { ...filter, seedVideo: null };
    const keep = () => discoverMixSongs([interleaveRadios(radios.map((r) => r.songs))], mixFilter);
    let pages = 1;
    let kept = keep();
    while (
      radios.some((radio) => radio.continuation !== null) &&
      discoverMixReadsMore({ pages, kept: kept.length, more: true })
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

/** What a section's mixes are built from: the Library and its plays, read once per build. */
const readLibrary = Effect.gen(function* () {
  const store = yield* LibraryStore;
  // Every value of the songs' multi-value genre tags, which Genre mixes count.
  const genres = new Map((yield* store.listSongGenres).map((song) => [song.id, song.genres]));
  const songs = yield* store.listSongs;
  return {
    songs:
      genres.size === 0
        ? songs
        : songs.map((song) => {
            const values = genres.get(song.id);
            return values === undefined ? song : { ...song, genres: values };
          }),
    artists: yield* store.listArtists,
    // Every song's all-time plays: a mix's Library pool takes the most played first.
    plays: yield* store.trackPlayTotals(statsWindow("all", Date.now())),
  };
});

type BuildLibrary = Effect.Success<typeof readLibrary>;

/**
 * The mixes [seeds] make, one seed after another so no new song is in two
 * of the section's mixes (and no Library song in two of its pools), or null
 * when no seed made a usable mix.
 */
const mixesOf = (seeds: readonly DiscoverMixSeed[], library: BuildLibrary) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const inLibrary = libraryFinder(library.songs);
    const played = playedFinder(yield* store.playedRecordingKeys);
    const taken = new Set<string>();
    const takenLibrary = new Set<number>();
    const mixes: DiscoverMix[] = [];
    for (const seed of seeds) {
      const read = yield* Effect.result(
        readRadios(seed, { inLibrary: (song) => inLibrary(song) !== null, played, taken }),
      );
      if (Result.isFailure(read) || read.success === null) continue;
      const { kept, radio } = read.success;
      const pool = discoverMixLibraryPool(seed, {
        radio,
        find: inLibrary,
        library,
        taken: takenLibrary,
        length: kept.length,
      });
      const mix = discoverMix(seed, kept, pool);
      if (mix === null) continue;
      mixes.push(mix);
      for (const song of mix.songs) taken.add(song.videoId);
      for (const song of pool) takenLibrary.add(song.id);
    }
    return discoverMixesBuilt(mixes, Date.now(), seeds);
  });

/**
 * Builds Artist mixes from the owner's all-time most played artists, picked
 * at random (`Math.random`) leaning towards the most played, and the
 * Library's when plays are short, then artists similar to the Library's when
 * its artists are too few. "nothing-to-build-from" when there are no seeds
 * (no plays and an empty Library), null when no seed made a usable mix:
 * either way what was saved stays, and a later visit can try again.
 */
const buildArtistMixes = Effect.gen(function* () {
  const stats = yield* Stats;
  const artists = yield* stats.topArtists("all", SEED_POOL);
  const library = yield* readLibrary;
  const seeds = artistMixSeeds(
    yield* withSimilar({
      played: artists.map(({ item, countedPlays }) => ({
        id: item.id,
        name: item.name,
        countedPlays,
      })),
      library: library.artists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
    }),
    Math.random,
  );
  if (seeds.length === 0) return "nothing-to-build-from" as const;
  return yield* mixesOf(seeds, library);
});

/**
 * Builds Genre mixes from the Library's genre families with five songs or
 * more, most played first, each from up to three of its artists picked at
 * random (`Math.random`) leaning towards those most played in it.
 * "nothing-to-build-from" when no family has enough songs (the section
 * hides), null when no seed made a usable mix.
 */
const buildGenreMixes = Effect.gen(function* () {
  const library = yield* readLibrary;
  const seeds = genreMixSeeds(library, Math.random);
  if (seeds.length === 0) return "nothing-to-build-from" as const;
  return yield* mixesOf(seeds, library);
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

/**
 * The section a mix [id] is of: Genre mixes' ids are Core's `genre:<family>`
 * (`genreMixSeeds`), Artist mixes' `artist:<name>`.
 */
const sectionOfMix = (id: string): MixSectionId =>
  id.startsWith("genre:") ? "genre-mixes" : "artist-mixes";

/** Builds [id]'s mixes again when Core says they're due; [played]: the owner has counted plays. */
const refresh = (id: MixSectionId, played: boolean): void => {
  const mixSection = SECTIONS[id];
  const now = Date.now();
  if (mixSection.building.get() || !discoverMixesDue(mixSection.saved.get(), { now, played }))
    return;
  if (mixSection.retryAt !== null && now < mixSection.retryAt) return;
  mixSection.building.set(true);
  void appRuntime
    .runPromise(Effect.result(mixSection.build))
    .then((result) => {
      const built = Result.isSuccess(result) ? result.success : null;
      if (built !== null && built !== "nothing-to-build-from") {
        mixSection.retryAt = null;
        mixSection.nothingToBuildFrom.set(false);
        mixSection.saved.set(built);
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

/**
 * How [id]'s saved mixes are blended now: its level, leaving out Library
 * songs [tracks] (the Library's songs by id) doesn't have, and explicit
 * songs while Don't play explicit is on (Core's `discoverMixKeep`). Without
 * [tracks] (Home, which doesn't read every song; or the Library not read
 * yet), every one counts as there, flagged as the build saw it.
 */
const useBlend = (
  id: MixSectionId,
  tracks: ReadonlyMap<number, SongRow> | null,
): DiscoverMixBlend => {
  const level = useDiscoverMixLevel(id);
  const dontPlayExplicit = useDontPlayExplicit();
  return useMemo(
    () => ({ level, keep: discoverMixKeep({ dontPlayExplicit, library: tracks }) }),
    [level, tracks, dontPlayExplicit],
  );
};

/** [mix]'s new songs, in its order: what its Download downloads. */
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
      if (enabled) refresh(id, played);
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
  const sectionId = sectionOfMix(id);
  const enabled = useYtMusicEnabled();
  const mixes = SECTIONS[sectionId].saved.useValue();
  const blend = useBlend(sectionId, tracks);
  return useMemo(
    () => (enabled ? savedDiscoverMix(mixes, id, blend) : null),
    [enabled, mixes, id, blend],
  );
};
