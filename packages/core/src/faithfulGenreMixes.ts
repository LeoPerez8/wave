import { filterSteps } from "./buildSteps.ts";
import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import {
  discoverMix,
  discoverMixSongsSteps,
  MIX_FEWEST,
  mixSeedArtists,
  type DiscoverLibrarySong,
  type DiscoverMix,
  type DiscoverMixSeed,
} from "./discoverMixes.ts";
import { discoverMixFamiliarPoolSteps, type DiscoverMixPoolSources } from "./discoverMixLevels.ts";
import type { GenreProfileOf } from "./genreAffinity.ts";
import { genreFamily, songFamilies } from "./genreMixes.ts";
import {
  rankRadioSongsSteps,
  type RadioRankingPage,
  type RadioRankingSources,
} from "./radioRanking.ts";
import type { MixSliders } from "./mixSliders.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

const GENRE_MIX_MOST = 25;
type Candidate = YtAlbumSong & { readonly video: boolean };
type RadioArtist = Pick<DiscoverMixSeed, "name" | "browseId">;
type GenreMixStep =
  | { readonly kind: "local" | "top-up"; readonly mixes: readonly DiscoverMix[] }
  | { readonly kind: "radio"; readonly artist: RadioArtist };

interface GenreMixSources<L extends DiscoverLibrarySong>
  extends
    Pick<DiscoverMixPoolSources<L>, "known" | "library">,
    Pick<RadioRankingSources, "taste" | "disliked"> {
  readonly catalog: readonly CatalogSong[];
  readonly genreOf: (videoId: string) => string | null | undefined;
}

/** The strongest family of the first credit with a profile must be unambiguous. */
const artistFamily = (song: YtAlbumSong, profileOf: GenreProfileOf | undefined) => {
  for (const artist of song.artists) {
    const profile = profileOf?.(artist);
    if (profile == null || profile.size === 0) continue;
    let family: string | undefined;
    let most = 0;
    for (const [key, share] of profile) {
      if (share > most) {
        family = key;
        most = share;
      } else if (share === most) family = undefined;
    }
    return family;
  }
  return undefined;
};

/**
 * Publishes usable catalog mixes before yielding any radio request. Send the
 * requested artist's first page back into the generator, or undefined on a
 * miss. Each completed family is published while the rest keep building.
 */
export function* faithfulGenreMixesSteps<L extends DiscoverLibrarySong>(
  seeds: readonly DiscoverMixSeed[],
  { catalog, genreOf, known, library, taste, disliked }: GenreMixSources<L>,
  sliders: MixSliders,
  avoid?: ReadonlySet<string>,
): Generator<GenreMixStep | void, DiscoverMix[], RadioRankingPage | undefined> {
  const options = { ...sliders, faithfulness: 5 as const };
  const ranking = {
    ...(taste === undefined ? {} : { taste }),
    ...(disliked === undefined ? {} : { disliked }),
    ...(library.profileOf === undefined ? {} : { profileOf: library.profileOf }),
  };
  const popularity = new Map<string, number>();
  for (const entry of catalog) {
    popularity.set(entry.song.videoId, 1 - 0.5 ** entry.radios.length);
    yield;
  }
  const popularityOf = (id: string) => popularity.get(id) ?? 0;
  const familiesOf = (song: YtAlbumSong): readonly string[] => {
    const tagged = songFamilies(
      { genre: genreOf(song.videoId) ?? "" },
      {
        artists: song.artists,
        graph: library.graph ?? null,
        profileOf: library.profileOf ?? (() => undefined),
      },
    );
    if (tagged.length > 0) return tagged.map(({ key }) => key);
    const key = artistFamily(song, library.profileOf);
    return key === undefined ? [] : [key];
  };
  const classification = new Map<string, readonly string[]>();
  const matches = (song: YtAlbumSong, family: string): boolean => {
    let keys = classification.get(song.videoId);
    if (keys === undefined) {
      keys = familiesOf(song);
      classification.set(song.videoId, keys);
    }
    return keys.includes(family);
  };
  const taken = new Set<string>();
  const familiarTaken = { tracks: new Set<number>(), videos: new Set<string>() };
  const mixes = new Map<string, DiscoverMix>();

  function* select(candidates: readonly Candidate[]) {
    return yield* discoverMixSongsSteps([candidates], {
      known: known.known,
      taken,
      limit: GENRE_MIX_MOST,
      ...(avoid === undefined ? {} : { avoid }),
    });
  }

  function* save(
    seed: DiscoverMixSeed,
    key: string,
    fresh: readonly Candidate[],
    radio: readonly Candidate[],
  ) {
    const familiar = yield* discoverMixFamiliarPoolSteps(seed, {
      radio,
      known,
      library,
      taken: familiarTaken,
      length: fresh.length,
      streamMatches: (song) => matches(song, key),
    });
    const mix = discoverMix(seed, fresh, familiar);
    if (mix === null) return;
    mixes.set(seed.id, mix);
    for (const song of mix.songs) taken.add(song.videoId);
    for (const song of familiar)
      if (song.source === "library") familiarTaken.tracks.add(song.track.id);
      else familiarTaken.videos.add(song.song.videoId);
  }

  const short: { seed: DiscoverMixSeed; key: string; catalog: readonly Candidate[] }[] = [];
  for (const seed of seeds) {
    const key = genreFamily(seed.genre ?? seed.name)?.key;
    if (key === undefined) continue;
    const artists = mixSeedArtists(seed);
    const seedKeys = new Set(artists.slice(0, 3).map(({ name }) => catalogSeedKey(name)));
    const preferred: YtAlbumSong[] = [];
    const other: YtAlbumSong[] = [];
    for (const { song, radios } of catalog) {
      if (matches(song, key)) {
        const target = radios.some(({ seed }) => seedKeys.has(seed)) ? preferred : other;
        target.push(song);
      }
      yield;
    }
    const candidates = yield* rankRadioSongsSteps(
      { artists: [] },
      {
        ...ranking,
        popularityOf,
        pages: [{ id: seed.id, artists: [], songs: [...preferred, ...other] }],
      },
      options,
    );
    const catalogSongs: Candidate[] = [];
    for (const { song } of candidates) {
      if (song !== null) catalogSongs.push({ ...song, video: false });
      yield;
    }
    const fresh = yield* select(catalogSongs);
    if (fresh.length >= MIX_FEWEST) {
      const localSeed =
        seed.artists === undefined ? seed : { ...seed, artists: seed.artists.slice(0, 3) };
      yield* save(localSeed, key, fresh, catalogSongs);
    } else short.push({ seed, key, catalog: catalogSongs });
  }
  const inOrder = () => seeds.flatMap(({ id }) => mixes.get(id) ?? []);
  yield { kind: "local", mixes: inOrder() };

  for (const { seed, key, catalog: candidates } of short) {
    const radio: Candidate[] = [];
    for (const [i, artist] of mixSeedArtists(seed).entries()) {
      const page = yield { kind: "radio", artist };
      if (page === undefined) continue;
      const songs = yield* filterSteps(
        page.songs,
        (song: YtAlbumSong & { readonly video?: boolean }) => {
          // A page can bring an album tag that was read after the catalog pass.
          classification.delete(song.videoId);
          return !song.video && matches(song, key);
        },
      );
      const ranked = yield* rankRadioSongsSteps(
        { artists: [] },
        { ...ranking, popularityOf, pages: [{ ...page, songs }] },
        options,
      );
      for (const { song } of ranked) {
        if (song !== null) radio.push({ ...song, video: false });
        yield;
      }
      const fresh = yield* select([
        ...(yield* filterSteps(candidates, (song) => matches(song, key))),
        ...radio,
      ]);
      if (fresh.length < MIX_FEWEST) continue;
      const expanded =
        seed.artists === undefined ? seed : { ...seed, artists: seed.artists.slice(0, i + 1) };
      yield* save(expanded, key, fresh, [...candidates, ...radio]);
      yield { kind: "top-up", mixes: inOrder() };
      break;
    }
  }
  return inOrder();
}
