/**
 * The harvest (docs/spec.md, "Discover", harvest): the background job that
 * refills the candidate catalog, apart from building Home's mixes, which
 * read only the phone. It reads the radios of the seeds and genre families
 * whose candidates run low (which and when are Core's: `harvestWants`,
 * `harvestNext`, `harvestDue`): every low one on Wi-Fi, from every artist
 * Artist mixes may pick (`artistMixSeedPool`) and the Genre mixes' families;
 * on mobile data only the seeds the last builds picked that have no
 * candidates left, within about 5 MB a day, counted by the network
 * measurement and kept on the phone. Each seed's read is one app-log line.
 * Its Artists searches share the search allowance at the Discover priority
 * (`ytArtistBrowseId`). When it read something, the artist graph is derived
 * again and a section with no mixes yet builds.
 */
import {
  artistMixSeedPool,
  genreMixSeeds,
  harvestDue,
  harvestMobileUsedToday,
  harvestWants,
  interleaveRadios,
  mixAffinity,
  mixProfileLookups,
  mixProfileLookupsNext,
  mixSeedArtists,
  mixSeedProfile,
  discoverMixReadsMore,
  discoverMixSongs,
  networkUseBytes,
  parseHarvestMobileUse,
  storedHarvestMobileUse,
  withHarvestMobileUse,
  type CatalogPageSong,
  type DiscoverMixFilter,
  type DiscoverMixSeed,
  type GenreProfileLibrary,
  type GenreProfileOf,
  type HarvestMobileUse,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { withNetworkLog } from "@/lib/networkMeter";
import { oneAtATime } from "@/lib/oneAtATime";
import { persistedSetting } from "@/lib/persistedSetting";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { onMobileData } from "@/native/waveNative";
import { tasteProfileNow } from "@/playback/TasteProfile";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { Stats } from "@/stats/Stats";
import { YtMusic } from "@/ytmusic/YtMusic";

import { lookUpArtistProfiles, mixProfileOf } from "./artistGenres";
import { artistGraphNow, forgetArtistGraph } from "./artistGraphNow";
import type { MixSectionId } from "./discoverMixLevel";
import { forgetMixCatalog } from "./mixCatalog";
import { harvestRun } from "./mixHarvestRun";
import { mixIndexes } from "./mixKnown";
import { similarOnline, withSimilar } from "./similarArtists";
import { artistRadio } from "./ytArtistPage";

/** How many of the most played artists Artist mixes' seeds are picked from. */
export const SEED_POOL = 20;

type Filter = DiscoverMixFilter<NativeYtRadioSong>;

interface ReadingRadio {
  /** The radio's artist, whose radio the candidate catalog files its songs under. */
  readonly seed: string;
  readonly songs: NativeYtRadioSong[];
  continuation: string | null;
}

/** What a read knows of artists' genres: the Library, and every artist's profile by name. */
interface MixGenres {
  readonly library: GenreProfileLibrary;
  readonly profileOf: GenreProfileOf;
}

/**
 * [seed]'s radios, read at the same time and interleaved (`interleaveRadios`;
 * an artist mix has one), a page of each after another while Core asks for
 * more (a radio whose start or later page fails is left at what was read),
 * the genres of the radio artists that decide the songs the mix would keep
 * looked up on Deezer (the seed's outside artists first, then a round at a
 * time, till 50 match: `mixProfileLookupsNext`). A page more is read while
 * the songs the mix would keep (`discoverMixSongs`) are too few. Every page
 * read is [note]d as its artist's radio (into the candidate catalog),
 * however the read ends. Null when no radio could be read.
 */
const readRadios = (
  seed: DiscoverMixSeed,
  filter: Filter,
  genres: MixGenres,
  note: (seed: string, songs: readonly CatalogPageSong[]) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const artists = mixSeedArtists(seed);
    const firstPages = yield* Effect.all(
      artists.map((artist) => Effect.result(artistRadio(artist))),
      { concurrency: "unbounded" },
    );
    const radios: ReadingRadio[] = firstPages.flatMap((page, at) =>
      Result.isSuccess(page) && page.success !== null
        ? [
            {
              seed: artists[at]?.name ?? seed.name,
              songs: [...page.success.songs],
              continuation: page.success.continuation,
            },
          ]
        : [],
    );
    if (radios.length === 0) return null;
    // Whatever the reading below comes to, every page read feeds the candidate catalog.
    yield* Effect.addFinalizer(() =>
      Effect.forEach(radios, (radio) => note(radio.seed, radio.songs), { discard: true }),
    );
    const { library, profileOf } = genres;
    // The seed's own artists first: an outside seed needs its profile to judge any song.
    const seedArtists = { artists: mixSeedArtists(seed).map((artist) => artist.name) };
    yield* lookUpArtistProfiles(mixProfileLookups([seedArtists], profileOf));
    const affinity = mixAffinity(mixSeedProfile(seed, library, profileOf), profileOf);
    const asked: string[] = [];
    // Only the artists that decide the songs the mix would keep next, a round at a time.
    const knowGenres = Effect.gen(function* () {
      for (;;) {
        const names = mixProfileLookupsNext(interleaveRadios(radios.map((r) => r.songs)), {
          filter: { ...filter, affinity },
          profileOf,
          asked,
        });
        if (names.length === 0) return;
        asked.push(...names);
        yield* lookUpArtistProfiles(names);
      }
    });
    yield* knowGenres;
    const kept = () =>
      discoverMixSongs([interleaveRadios(radios.map((r) => r.songs))], { ...filter, affinity })
        .length;
    for (
      let pages = 1;
      discoverMixReadsMore({
        pages,
        kept: kept(),
        more: radios.some((radio) => radio.continuation !== null),
      });
      pages += 1
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
      yield* knowGenres;
    }
    return interleaveRadios(radios.map((r) => r.songs)).length;
  }).pipe(Effect.scoped);

/** The seeds each section's last build picked this session: what a harvest on mobile data refills. */
const picked = new Map<MixSectionId, readonly DiscoverMixSeed[]>();

/** Notes the seeds [id]'s build picked, those it made no mix of among them. */
export const noteSeedsPicked = (id: MixSectionId, seeds: readonly DiscoverMixSeed[]): void => {
  picked.set(id, seeds);
};

const harvested = new Set<() => void>();

/** Calls [listener] after each harvest that read something; returns the stop. */
export const onHarvested = (listener: () => void): (() => void) => {
  harvested.add(listener);
  return () => harvested.delete(listener);
};

/** The mobile data the harvest used today, kept on this phone (not synced). */
const mobileUse = persistedSetting<HarvestMobileUse | null>({
  key: "home.harvestMobileUse",
  read: parseHarvestMobileUse,
  write: (use) => (use === null ? null : storedHarvestMobileUse(use)),
});

/** The mobile data the harvest used today, in bytes: a Magic Queue's refill counts in it too. */
export const harvestMobileUsed = (): number => harvestMobileUsedToday(mobileUse.get(), Date.now());

/** Counts [bytes] of mobile data the harvest (or a Magic Queue's refill) used now. */
export const noteHarvestMobileUse = (bytes: number): void => {
  mobileUse.set(withHarvestMobileUse(mobileUse.get(), bytes, Date.now()));
};

/** When each seed was last tried this session, by id. */
const tried = new Map<string, number>();

/** [seeds] each once, by id, in order. */
const uniqueSeeds = (seeds: readonly DiscoverMixSeed[]): DiscoverMixSeed[] => {
  const ids = new Set<string>();
  return seeds.filter((seed) => {
    if (ids.has(seed.id)) return false;
    ids.add(seed.id);
    return true;
  });
};

/**
 * The seeds a harvest may read: on mobile data, those the last builds
 * picked; on Wi-Fi, every artist Artist mixes may pick (similar artists'
 * pages read when the phone has none) and the Genre mixes' families.
 */
const harvestSeeds = (mobile: boolean) =>
  Effect.gen(function* () {
    if (mobile) return uniqueSeeds([...picked.values()].flat());
    const library = yield* mixIndexes;
    const top = yield* (yield* Stats).topArtists("all", SEED_POOL);
    const pools = yield* withSimilar(
      {
        played: top.map(({ item, countedPlays }) => ({
          id: item.id,
          name: item.name,
          countedPlays,
        })),
        library: library.artists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
      },
      similarOnline,
    );
    return uniqueSeeds([...artistMixSeedPool(pools), ...genreMixSeeds(library, Math.random)]);
  });

/** One harvest: gives how many seeds it read. */
const harvest = Effect.gen(function* () {
  const mobile = onMobileData();
  const seeds = yield* harvestSeeds(mobile);
  if (seeds.length === 0) return 0;
  const library = yield* mixIndexes;
  const store = yield* LibraryStore;
  const catalog = yield* store.candidateCatalog;
  const graph = yield* artistGraphNow;
  const taste = yield* tasteProfileNow;
  const profileOf = mixProfileOf(library);
  yield* freeTurnEffect;
  const sources = {
    catalog,
    graph,
    profileOf,
    taste,
    now: Date.now(),
    library,
    known: library.known,
  };
  // A seed at a time, giving the JavaScript thread back between them.
  const wants: ReturnType<typeof harvestWants<DiscoverMixSeed>> = [];
  for (const seed of seeds) {
    wants.push(...harvestWants([seed], sources));
    yield* freeTurnEffect;
  }
  const filter: Filter = { known: library.known.known, taken: new Set() };
  const genres: MixGenres = { library, profileOf };
  // The harvest's pages go into the catalog as they're read, so the build after it has them.
  const note = (seed: string, songs: readonly CatalogPageSong[]) =>
    store.addCandidates({ songs, seed }, Date.now()).pipe(Effect.ignore);
  return yield* harvestRun({
    wants,
    onMobileData: mobile,
    usedToday: harvestMobileUsed(),
    now: Date.now,
    tried,
    read: (seed) => {
      let bytes = 0;
      return withNetworkLog(
        `Mix harvest of ${seed.name}`,
        readRadios(seed, filter, genres, note),
        (songs) => (songs === null ? "no radio" : `${songs} songs`),
        (use) => {
          bytes = networkUseBytes(use);
        },
      ).pipe(
        Effect.ignore,
        Effect.andThen(freeTurnEffect),
        Effect.map(() => bytes),
      );
    },
    usedOnMobile: noteHarvestMobileUse,
  });
});

let lastRunAt: number | null = null;

const once = oneAtATime(
  Effect.gen(function* () {
    const read = yield* harvest;
    if (read === 0) return;
    forgetArtistGraph();
    forgetMixCatalog();
    for (const listener of harvested) listener();
  }).pipe(Effect.ignore),
);

/**
 * Starts a harvest in the background when one is due (`harvestDue`: every
 * 15 minutes at most) and YT Music is on; one at a time.
 */
export const harvestSoon = (): void => {
  const now = Date.now();
  if (!ytMusicEnabled() || !harvestDue(lastRunAt, now)) return;
  lastRunAt = now;
  void appRuntime.runPromise(once).catch(() => {});
};
