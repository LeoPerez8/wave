/**
 * The harvest (docs/spec.md, "Discover", harvest): the background job that
 * refills the candidate catalog, apart from building Home's mixes, which
 * read only the phone. It reads the radios of the seeds and genre families
 * whose candidates run low (which and when are Core's: `harvestSeedPool`,
 * `harvestWants`, `harvestNext`, `harvestDue`): every low one on Wi-Fi, from
 * every artist Artist mixes may pick (`artistMixSeedPool`) and the Genre
 * mixes' families; on mobile data only the seeds the last builds picked that
 * have no candidates left, within about 5 MB a day, counted by the network
 * measurement and kept on the phone (`harvestMobileUse.ts`). Each seed's
 * read is one app-log line, and so are the similar artists' pages it reads.
 * Its Artists searches share the search allowance at the Discover priority
 * (`ytArtistBrowseId`). When it read something, the artist graph is derived
 * again and a section with no mixes yet builds.
 */
import {
  genreMixSeeds,
  harvestDue,
  harvestSeedPool,
  harvestWants,
  interleaveRadios,
  mixAffinity,
  mixProfileLookups,
  mixProfileLookupsNext,
  mixSeedArtists,
  libraryStyleOf,
  mixSlidersEngine,
  mixSeedProfile,
  discoverMixReadsMore,
  discoverMixSongs,
  networkUseBytes,
  type DiscoverMixFilter,
  type DiscoverMixSeed,
  type GenreProfileLibrary,
  type GenreProfileOf,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { withNetworkLog } from "@/lib/networkMeter";
import { oneAtATime } from "@/lib/oneAtATime";
import { appRuntime } from "@/library/runtime";
import type { NativeYtRadioSong } from "@/native/waveYtMusic";
import { onMobileData, online } from "@/native/waveNative";
import { tasteProfileForRecommendation } from "@/playback/TasteProfile";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { noteRadioNow } from "@/ytmusic/candidateCatalog";
import { YtMusic } from "@/ytmusic/YtMusic";

import { lookUpArtistProfiles, mixProfileOf } from "./artistGenres";
import { artistMixPools } from "./artistMixPools";
import { discoverSlidersNow } from "./discoverMixLevel";
import { harvestMobileUsed, noteHarvestMobileUse } from "./harvestMobileUse";
import { withSnapshotTaste } from "./homeMixBuild";
import { recommendationSnapshot } from "./recommendationSnapshot";
import { harvestRun } from "./mixHarvestRun";
import { mixIndexes } from "./mixKnown";
import { similarOnline, withSimilar } from "./similarArtists";
import { artistRadio } from "./ytArtistPage";

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
 * the songs the mix would keep (`discoverMixSongs`) are too few. Each page
 * goes into the candidate catalog as it arrives, as its artist's radio
 * (`noteRadioNow`), so a read cut short keeps what it read. Null when no
 * radio could be read.
 */
const readRadios = (seed: DiscoverMixSeed, filter: Filter, genres: MixGenres) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const artists = mixSeedArtists(seed);
    const firstPages = yield* Effect.all(
      artists.map((artist) =>
        Effect.result(
          artistRadio(artist).pipe(
            Effect.tap((page) =>
              page === null ? Effect.void : noteRadioNow(artist.name, page.songs),
            ),
          ),
        ),
      ),
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
                Effect.flatMap((next) => {
                  if (Result.isFailure(next)) {
                    radio.continuation = null;
                    return Effect.void;
                  }
                  radio.songs.push(...next.success.songs);
                  radio.continuation = next.success.continuation;
                  return noteRadioNow(radio.seed, next.success.songs);
                }),
              ),
        ),
        { concurrency: "unbounded" },
      );
      yield* knowGenres;
    }
    return interleaveRadios(radios.map((r) => r.songs)).length;
  });

/** The seeds Home's builds picked (each section's last build): what a harvest on mobile data refills. */
let picked: () => readonly DiscoverMixSeed[] = () => [];

/** Tells the harvest where to find the seeds Home's builds picked (`discoverMixes.ts` keeps them). */
export const setPickedSeeds = (seeds: () => readonly DiscoverMixSeed[]): void => {
  picked = seeds;
};

const harvested = new Set<() => void>();

/** Calls [listener] after each harvest that read something; returns the stop. */
export const onHarvested = (listener: () => void): (() => void) => {
  harvested.add(listener);
  return () => harvested.delete(listener);
};

/** When each seed was last tried this session, by id. */
const tried = new Map<string, number>();

/**
 * The seeds a harvest may read (Core's `harvestSeedPool`): on mobile data,
 * those the last builds picked; on Wi-Fi, also every artist Artist mixes may
 * pick and the Genre mixes' families. The similar artists' pages read for
 * the pools (those the phone has none of) are one app-log line, their bytes
 * counted in the day's mobile data when the phone is on it.
 */
const harvestSeeds = (mobile: boolean) =>
  Effect.gen(function* () {
    if (mobile) return harvestSeedPool({ picked: picked(), wifi: null });
    const library = yield* mixIndexes;
    const pools = yield* withNetworkLog(
      "Mix harvest similar artists",
      Effect.flatMap(artistMixPools(library), (artists) => withSimilar(artists, similarOnline)),
      undefined,
      (use) => {
        if (onMobileData()) noteHarvestMobileUse(networkUseBytes(use));
      },
    );
    const families = genreMixSeeds(library, Math.random);
    return harvestSeedPool({ picked: picked(), wifi: { pools, families } });
  });

/** One harvest: gives how many seeds it read. */
const harvest = Effect.gen(function* () {
  const mobile = onMobileData();
  const seeds = yield* harvestSeeds(mobile);
  if (seeds.length === 0) return 0;
  // The recommendation snapshot Home's mixes just read: its own batches go into the next one.
  const { library, catalog, graph, taste } = yield* withSnapshotTaste(
    recommendationSnapshot.get,
    tasteProfileForRecommendation,
  );
  const profileOf = mixProfileOf(library);
  const styleOf = libraryStyleOf(library);
  yield* freeTurnEffect;
  const sources = {
    catalog,
    graph,
    profileOf,
    styleOf,
    taste,
    now: Date.now(),
    library,
    known: library.known,
  };
  // A seed at a time, giving the JavaScript thread back between them, each
  // counted at Discover's sliders, as its mix would keep songs.
  const wants: ReturnType<typeof harvestWants<DiscoverMixSeed>> = [];
  const engine = mixSlidersEngine(discoverSlidersNow());
  for (const seed of seeds) {
    wants.push(...harvestWants([seed], sources, engine));
    yield* freeTurnEffect;
  }
  const filter: Filter = { known: library.known.known, taken: new Set() };
  const genres: MixGenres = { library, profileOf };
  return yield* harvestRun({
    wants,
    onMobileData: mobile,
    usedToday: harvestMobileUsed(),
    now: Date.now,
    tried,
    read: (seed) => {
      let bytes = 0;
      let reached = false;
      return withNetworkLog(
        `Mix harvest of ${seed.name}`,
        readRadios(seed, filter, genres),
        (songs) => (songs === null ? "no radio" : `${songs} songs`),
        (use) => {
          bytes = networkUseBytes(use);
          reached = use.ytMusic.requests > 0;
        },
      ).pipe(
        Effect.ignore,
        Effect.andThen(freeTurnEffect),
        Effect.map(() => ({ bytes, reached })),
      );
    },
    usedOnMobile: noteHarvestMobileUse,
  });
});

let lastRunAt: number | null = null;

const once = oneAtATime(
  Effect.gen(function* () {
    const read = yield* harvest;
    // Each batch it wrote reaches the snapshot's next read (`artistGraphSourcesChanged`).
    if (read === 0) return;
    for (const listener of harvested) listener();
  }).pipe(Effect.ignore),
);

/**
 * Starts a harvest in the background when one is due (`harvestDue`: every
 * 15 minutes at most), YT Music is on and the phone is online (offline, the
 * next visit tries again); one at a time.
 */
export const harvestSoon = (): void => {
  const now = Date.now();
  if (!ytMusicEnabled() || !online() || !harvestDue(lastRunAt, now)) return;
  lastRunAt = now;
  void appRuntime.runPromise(once).catch(() => {});
};
