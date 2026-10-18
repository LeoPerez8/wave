/**
 * Home's Discover mixes (docs/spec.md, "Discover mixes"): YouTube Music
 * radios of the owner's most played artists and songs (the Library's when
 * plays are short, then artists similar to the Library's), then of the
 * Library's genres' artists: the radio's new songs, and a pool of Library
 * songs the owner's level blends in (`blendDiscoverMix`). Which seeds, which
 * artist pages to read for similar artists, which songs, which Library songs
 * and when to build again are Core's (`discoverMixSeeds`,
 * `discoverSimilarSource`, `discoverMixSongs`, `discoverMixLibraryPool`,
 * `discoverMixesDue`); this asks YouTube Music and keeps the last mixes built,
 * so Home shows them at once (and what the section shows meanwhile is Core's
 * `discoverMixesSection`).
 */
import {
  discoverMixKeep,
  discoverMix,
  discoverMixLibraryPool,
  discoverMixReadsMore,
  discoverMixSeeds,
  discoverMixSongs,
  discoverMixesBuilt,
  discoverMixesDue,
  discoverMixesSection,
  discoverSeedQuery,
  discoverSeedVideo,
  discoverSimilarSource,
  identityKey,
  libraryFinder,
  parseDiscoverMixes,
  pickYtArtist,
  playedFinder,
  savedDiscoverMix,
  statsWindow,
  storedDiscoverMixes,
  ytArtistLookup,
  type BlendedDiscoverMix,
  type DiscoverMix,
  type DiscoverMixBlend,
  type DiscoverMixFilter,
  type DiscoverMixSeed,
  type DiscoverMixes,
  type DiscoverMixesSection,
  type DiscoverSeedPools,
  type DiscoverSimilarArtists,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
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

import { useDiscoverMixLevel } from "./discoverMixLevel";

/** How many of the most played artists and songs the seeds are picked from. */
const SEED_POOL = 20;

/** The mixes last built, kept on this phone (not synced: they're built from its plays). */
const saved = persistedSetting<DiscoverMixes | null>({
  key: "home.discoverMixes",
  read: parseDiscoverMixes,
  write: (mixes) => (mixes === null ? null : storedDiscoverMixes(mixes)),
});

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
 * [pools] with the similar artists Core asks for (`discoverSimilarSource`),
 * one Library artist's page at a time. A page that can't be read counts as
 * one with no similar artists, so the other seeds stand as they are.
 */
const withSimilar = (pools: DiscoverSeedPools) =>
  Effect.gen(function* () {
    const similar: DiscoverSimilarArtists[] = [];
    for (
      let source = discoverSimilarSource(pools);
      source !== null;
      source = discoverSimilarSource({ ...pools, similar })
    ) {
      const artists = yield* similarArtists(source.name).pipe(Effect.orElseSucceed(() => []));
      similar.push({ of: source.name, artists });
    }
    return { ...pools, similar };
  });

/** Where [seed]'s radio starts, or null when YouTube Music doesn't have the artist or the song. */
const radioStart = (seed: DiscoverMixSeed) =>
  Effect.gen(function* () {
    if (seed.kind === "artist") {
      const browseId = seed.browseId ?? (yield* artistPage(seed.name));
      return browseId === null ? null : { seed: { browseId }, video: null };
    }
    const ytMusic = yield* YtMusic;
    const query = discoverSeedQuery(seed.song);
    const results = yield* withSearchTurn("discover", query, ytMusic.searchSongs(query));
    const videoId = discoverSeedVideo(seed.song, results.songs);
    return videoId === null ? null : { seed: { videoId }, video: videoId };
  });

type Filter = Omit<DiscoverMixFilter<NativeYtRadioSong>, "seedVideo">;

/**
 * [seed]'s radio, page after page while Core asks for more (a later page
 * that fails ends it with what was read): the new songs it keeps
 * (`discoverMixSongs`, enough for level 5) and every song it played, for the
 * mix's Library pool. Null when YouTube Music has no radio for it; fails when
 * the radio can't be started.
 */
const readRadio = (seed: DiscoverMixSeed, filter: Filter) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const start = yield* radioStart(seed);
    if (start === null) return null;
    const mixFilter = { ...filter, seedVideo: start.video };
    let page = yield* ytMusic.radio(start.seed);
    let pages = 1;
    const radio = [...page.songs];
    // Kept page by page, so each song is looked at once.
    let kept = discoverMixSongs([page.songs], mixFilter);
    while (
      page.continuation !== null &&
      discoverMixReadsMore({ pages, kept: kept.length, more: true })
    ) {
      const next = yield* Effect.result(ytMusic.radioMore(page.continuation));
      if (Result.isFailure(next)) break;
      page = next.success;
      pages += 1;
      radio.push(...page.songs);
      kept = discoverMixSongs([page.songs], mixFilter, kept);
    }
    return { kept, radio };
  });

/**
 * Builds the mixes from the owner's all-time most played artists and songs,
 * and the Library's when plays are short, then artists similar to the
 * Library's when its artists are too few, one seed after another so no song
 * is in two mixes. "nothing-to-build-from" when there are no seeds (no plays
 * and an empty Library), null when no seed made a usable mix: either way what
 * was saved stays, and a later visit can try again.
 */
const buildMixes = Effect.gen(function* () {
  const stats = yield* Stats;
  const store = yield* LibraryStore;
  const artists = yield* stats.topArtists("all", SEED_POOL);
  const songs = yield* stats.topSongs("all", SEED_POOL);
  const librarySongs = yield* store.listSongs;
  const libraryArtists = yield* store.listArtists;
  // Every song's all-time plays: Core ranks the Library's genres by them.
  const songPlays = yield* store.trackPlayTotals(statsWindow("all", Date.now()));
  const seeds = discoverMixSeeds(
    yield* withSimilar({
      played: {
        artists: artists.map((entry) => entry.item),
        songs: songs.map((entry) => entry.item),
      },
      library: {
        artists: libraryArtists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
        songs: librarySongs,
        plays: songPlays,
      },
    }),
  );
  if (seeds.length === 0) return "nothing-to-build-from" as const;
  const inLibrary = libraryFinder(librarySongs);
  const played = playedFinder(yield* store.playedRecordingKeys);
  const taken = new Set<string>();
  // Each Library song is in one mix's pool at most, as each new song is in one mix.
  const takenLibrary = new Set<number>();
  const mixes: DiscoverMix[] = [];
  for (const seed of seeds) {
    const read = yield* Effect.result(
      readRadio(seed, { inLibrary: (song) => inLibrary(song) !== null, played, taken }),
    );
    if (Result.isFailure(read) || read.success === null) continue;
    const { kept, radio } = read.success;
    const pool = discoverMixLibraryPool(seed, {
      radio,
      find: inLibrary,
      library: { artists: libraryArtists, songs: librarySongs, plays: songPlays },
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

/** A build going on, so Home coming back into focus meanwhile doesn't start another. */
let building = false;
/** When a build last made no mixes: try again after a while, not on every visit. */
let failedAt: number | null = null;
const RETRY_MS = 10 * 60 * 1000;
/** Whether the last build found no seeds at all: no skeleton while there's nothing to build. */
const nothingToBuildFrom = makeExternalStore(false);

/** Builds the mixes again when Core says they're due; [played]: the owner has counted plays. */
const refresh = (played: boolean): void => {
  const now = Date.now();
  if (building || !discoverMixesDue(saved.get(), { now, played })) return;
  if (failedAt !== null && now - failedAt < RETRY_MS) return;
  building = true;
  void appRuntime
    .runPromise(Effect.result(buildMixes))
    .then((result) => {
      const built = Result.isSuccess(result) ? result.success : null;
      if (built !== null && built !== "nothing-to-build-from") {
        failedAt = null;
        nothingToBuildFrom.set(false);
        saved.set(built);
        return;
      }
      failedAt = Date.now();
      if (Result.isSuccess(result)) nothingToBuildFrom.set(built !== null);
    })
    .finally(() => {
      building = false;
    });
};

/**
 * How the saved mixes are blended now: the owner's level, leaving out Library
 * songs [tracks] (the Library's songs by id) doesn't have, and explicit songs
 * while Don't play explicit is on (Core's `discoverMixKeep`). Without
 * [tracks] (Home, which doesn't read every song; or the Library not read
 * yet), every one counts as there, flagged as the build saw it.
 */
const useBlend = (tracks: ReadonlyMap<number, SongRow> | null): DiscoverMixBlend => {
  const level = useDiscoverMixLevel();
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
 * What Home's Discover mixes section shows (`discoverMixesSection`): the last
 * mixes built, blended by the owner's level, a skeleton while the first ones
 * build, or nothing while YT Music is off. Each time Home comes into focus
 * with YT Music on, they're built again if they weren't today, and while
 * it's in focus once [played] turns true (the first counted plays) if the
 * last build had no seeds from plays.
 */
export const useDiscoverMixes = (played: boolean): DiscoverMixesSection => {
  const enabled = useYtMusicEnabled();
  const mixes = saved.useValue();
  const blend = useBlend(null);
  const nothing = useSyncExternalStore(nothingToBuildFrom.subscribe, nothingToBuildFrom.get);
  useFocusEffect(
    useCallback(() => {
      if (enabled) refresh(played);
    }, [enabled, played]),
  );
  return useMemo(
    () => discoverMixesSection(mixes, { ytMusic: enabled, nothingToBuildFrom: nothing, blend }),
    [mixes, enabled, nothing, blend],
  );
};

/**
 * The mix [id] as last built, blended by the owner's level with the Library
 * songs [tracks] has (`useLibraryTracks`), or null when there's none (YT
 * Music off, rebuilt without it, or too short with Don't play explicit on:
 * Core's `savedDiscoverMix`).
 */
export const useDiscoverMix = (
  id: string,
  tracks: ReadonlyMap<number, SongRow> | null,
): BlendedDiscoverMix | null => {
  const enabled = useYtMusicEnabled();
  const mixes = saved.useValue();
  const blend = useBlend(tracks);
  return useMemo(
    () => (enabled ? savedDiscoverMix(mixes, id, blend) : null),
    [enabled, mixes, id, blend],
  );
};
