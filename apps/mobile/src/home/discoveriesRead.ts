import {
  carouselPageSongs,
  discoveries,
  MAGIC_QUEUE_PICKS,
  magicLibraryMapperSteps,
  magicYtSong,
  mapSteps,
  ytTrackId,
  type CatalogSong,
  type DiscoveryCatalogSong,
  type DiscoveryLibrarySong,
  type GenreProfileOf,
  type MagicQueueSeed,
  type TasteProfile,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "../lib/stepped.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";
import type { PlayableSongRow, SongRow } from "@wave/client";

/** How many ranked songs are read at a time: the page, and room for a few that can't show. */
const BATCH = MAGIC_QUEUE_PICKS * 2;

/** What the page is built from, all of it kept on the phone. */
export interface DiscoveriesInputs {
  readonly now: number;
  /** The Library's songs and artists, as the recommendation snapshot holds them. */
  readonly library: {
    readonly songs: readonly SongRow[];
    readonly artists: readonly { readonly id: number; readonly name: string }[];
  };
  /** The candidate catalog. */
  readonly catalog: readonly CatalogSong[];
  /** The owner's Taste profile, or null when it can't be derived. */
  readonly taste: TasteProfile | null;
  /** The genre profile known for an artist, with no lookup. */
  readonly profileOf: GenreProfileOf;
  /** Whether Don't play explicit is on: explicit catalog songs then stay out. */
  readonly dontPlayExplicit: boolean;
  /** What the read yields to between steps. */
  readonly turn: Effect.Effect<void>;
}

/**
 * The carousel's Discoveries page (Core's `discoveries` and
 * `carouselPageSongs`): up to nine songs without a counted play, the
 * candidate catalog's first, ranked by the Taste profile, then the Library's
 * (the newest added first among those the profile weighs the same), as the
 * tiles the Magic Queue page draws, or none when fewer than three can show.
 * Built from the phone's database and [inputs] alone, with no network. A
 * catalog song the Library has a file of is passed over (it is that Library
 * song, which shows while unplayed), as is a Library song that can't play.
 *
 * Disliked songs: Core's `discoveries` takes them (`disliked`); nothing is
 * passed until the Dislike feature keeps them.
 */
export const readDiscoveries = (store: LibraryStore["Service"], inputs: DiscoveriesInputs) =>
  Effect.gen(function* () {
    const { turn } = inputs;
    const played = new Set<string>();
    for (const { song, countedPlays } of yield* store.songPlayTotals({
      from: null,
      to: inputs.now,
    }))
      if (countedPlays > 0)
        played.add(song.kind === "library" ? String(song.id) : ytTrackId(song.videoId));
    yield* turn;
    const catalog: DiscoveryCatalogSong[] = [];
    yield* runSteps(
      mapSteps(inputs.catalog, (entry) => {
        if (inputs.dontPlayExplicit && entry.song.explicit) return;
        const { videoId, artists } = entry.song;
        catalog.push({
          entry,
          magic: magicYtSong({ trackId: ytTrackId(videoId), artists }, inputs.profileOf),
        });
      }),
      turn,
    );
    const convert = yield* runSteps(magicLibraryMapperSteps(inputs.library.artists), turn);
    const library: DiscoveryLibrarySong<SongRow>[] = [];
    yield* runSteps(
      mapSteps(
        inputs.library.songs
          .filter((song) => song.path !== null)
          // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
          .sort((a, b) => b.addedAt - a.addedAt || a.id - b.id),
        (song) => {
          library.push({ song, magic: convert(song) });
        },
      ),
      turn,
    );
    yield* turn;
    const ranked = discoveries({ catalog, library, played, taste: inputs.taste });
    const seeds: MagicQueueSeed<PlayableSongRow>[] = [];
    for (let from = 0; from < ranked.length && seeds.length < MAGIC_QUEUE_PICKS; from += BATCH) {
      const batch = ranked.slice(from, from + BATCH);
      const videoIds = batch.flatMap((seed) =>
        seed.source === "stream" ? [seed.song.videoId] : [],
      );
      const owned = videoIds.length === 0 ? null : yield* store.songsWithVideos(videoIds);
      const files = new Map(
        (yield* store.songsByIds(
          batch.flatMap((seed) => (seed.source === "library" ? [seed.song.id] : [])),
        )).map((song) => [song.id, song]),
      );
      for (const seed of batch) {
        if (seed.source === "stream") {
          if (owned?.has(seed.song.videoId) !== true) seeds.push(seed);
        } else {
          const file = files.get(seed.song.id);
          if (file !== undefined) seeds.push({ source: "library", song: file });
        }
      }
    }
    return carouselPageSongs(seeds);
  });
