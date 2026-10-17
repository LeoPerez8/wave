/**
 * Home's Discover mixes (docs/spec.md, "Discover mixes"): YouTube Music
 * radios of the owner's most played artists and songs (the Library's when
 * plays are short, then artists similar to the Library's), with every song
 * the owner already knows left out. Which seeds, which artist pages to read
 * for similar artists, which songs and when to build again are Core's
 * (`discoverMixSeeds`, `discoverSimilarSource`, `discoverMixSongs`,
 * `discoverMixesDue`); this asks YouTube Music and keeps the last mixes built,
 * so Home shows them at once.
 */
import {
  discoverMix,
  discoverMixReadsMore,
  discoverMixSeeds,
  discoverMixSongs,
  discoverMixesBuilt,
  discoverMixesDue,
  discoverSeedQuery,
  discoverSeedVideo,
  discoverSimilarSource,
  identityKey,
  libraryFinder,
  parseDiscoverMixes,
  pickYtArtist,
  playedFinder,
  storedDiscoverMixes,
  ytArtistLookup,
  type DiscoverMix,
  type DiscoverMixFilter,
  type DiscoverMixSeed,
  type DiscoverMixes,
  type DiscoverSeedPools,
  type DiscoverSimilarArtists,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { persistedSetting } from "@/lib/persistedSetting";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { Stats } from "@/stats/Stats";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

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
 * [seed]'s mix: its radio, page after page while Core asks for more (a later
 * page that fails ends it with what was read). Null when YouTube Music has
 * no radio for it or too few new songs; fails when the radio can't be started.
 */
const readMix = (seed: DiscoverMixSeed, filter: Filter) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const start = yield* radioStart(seed);
    if (start === null) return null;
    const mixFilter = { ...filter, seedVideo: start.video };
    let page = yield* ytMusic.radio(start.seed);
    let pages = 1;
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
      kept = discoverMixSongs([page.songs], mixFilter, kept);
    }
    return discoverMix(seed, kept);
  });

/**
 * Builds the mixes from the owner's all-time most played artists and songs,
 * and the Library's when plays are short, then artists similar to the
 * Library's when its artists are too few, one seed after another so no song
 * is in two mixes. Null when there's nothing to build from (an empty
 * Library) or no seed made a usable mix: what was saved stays, and a later
 * visit can try again.
 */
const buildMixes = Effect.gen(function* () {
  const stats = yield* Stats;
  const store = yield* LibraryStore;
  const artists = yield* stats.topArtists("all", SEED_POOL);
  const songs = yield* stats.topSongs("all", SEED_POOL);
  const librarySongs = yield* store.listSongs;
  const libraryArtists = yield* store.listArtists;
  const seeds = discoverMixSeeds(
    yield* withSimilar({
      played: {
        artists: artists.map((entry) => entry.item),
        songs: songs.map((entry) => entry.item),
      },
      library: {
        artists: libraryArtists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
        songs: librarySongs,
      },
    }),
  );
  if (seeds.length === 0) return null;
  const inLibrary = libraryFinder(librarySongs);
  const played = playedFinder(yield* store.playedRecordingKeys);
  const taken = new Set<string>();
  const mixes: DiscoverMix[] = [];
  for (const seed of seeds) {
    const mix = yield* Effect.result(
      readMix(seed, { inLibrary: (song) => inLibrary(song) !== null, played, taken }),
    );
    if (Result.isFailure(mix)) continue;
    if (mix.success === null) continue;
    mixes.push(mix.success);
    for (const song of mix.success.songs) taken.add(song.videoId);
  }
  return discoverMixesBuilt(mixes, Date.now(), seeds);
});

/** A build going on, so Home coming back into focus meanwhile doesn't start another. */
let building = false;
/** When a build last made no mixes: try again after a while, not on every visit. */
let failedAt: number | null = null;
const RETRY_MS = 10 * 60 * 1000;

/** Builds the mixes again when Core says they're due; [played]: the owner has counted plays. */
const refresh = (played: boolean): void => {
  const now = Date.now();
  if (building || !discoverMixesDue(saved.get(), { now, played })) return;
  if (failedAt !== null && now - failedAt < RETRY_MS) return;
  building = true;
  void appRuntime
    .runPromise(Effect.result(buildMixes))
    .then((result) => {
      if (Result.isSuccess(result) && result.success !== null) {
        failedAt = null;
        saved.set(result.success);
      } else failedAt = Date.now();
    })
    .finally(() => {
      building = false;
    });
};

/**
 * The mixes Home shows: the last ones built, or none while YT Music is off.
 * Each time Home comes into focus with YT Music on, they're built again if
 * they weren't today, and while it's in focus once [played] turns true (the
 * first counted plays) if the last build had no seeds from plays.
 */
export const useDiscoverMixes = (played: boolean): readonly DiscoverMix[] => {
  const enabled = useYtMusicEnabled();
  const mixes = saved.useValue();
  useFocusEffect(
    useCallback(() => {
      if (enabled) refresh(played);
    }, [enabled, played]),
  );
  return enabled && mixes !== null ? mixes.mixes : [];
};

/** The mix [id] as last built, or null when there's none (YT Music off, or rebuilt without it). */
export const useDiscoverMix = (id: string): DiscoverMix | null => {
  const enabled = useYtMusicEnabled();
  const mixes = saved.useValue();
  if (!enabled || mixes === null) return null;
  return mixes.mixes.find((mix) => mix.id === id) ?? null;
};
