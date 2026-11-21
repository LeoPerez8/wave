/**
 * A Recap as its stories show it, for both apps: Core's slides (`recapSlides`) with the rows
 * of their songs, artists and album loaded.
 */
import {
  recap,
  recapSlides,
  type CountedListening,
  type EntityPlayTotals,
  type GenreFamily,
  type RecapPeriod,
  type RecapSlide,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { SongRow } from "../types.ts";
import type { PlayedAlbum, PlayedArtist, RecapPlays } from "./playedEntities.ts";
import { rankSongs, type Ranked, type StatsSong } from "./statsQueries.ts";
import type { YtAlbumSong } from "@wave/core";

/** A Recap slide with the rows it shows loaded. */
export type LoadedRecapSlide =
  | Exclude<RecapSlide, { kind: "topSongs" | "topArtists" | "topAlbum" | "discovered" | "summary" }>
  | { readonly kind: "topSongs"; readonly songs: readonly Ranked<StatsSong>[] }
  | { readonly kind: "topArtists"; readonly artists: readonly Ranked<PlayedArtist>[] }
  | { readonly kind: "topAlbum"; readonly album: Ranked<PlayedAlbum> }
  | {
      readonly kind: "discovered";
      /** How many artists the period discovered. */
      readonly count: number;
      /** The most played of them, the top one first. */
      readonly artists: readonly Ranked<PlayedArtist>[];
    }
  | {
      /** The summary card: the top songs (Library and streamed) and artists. */
      readonly kind: "summary";
      readonly minutes: number;
      readonly songs: readonly Ranked<StatsSong>[];
      readonly artists: readonly Ranked<PlayedArtist>[];
      readonly genre: GenreFamily | null;
    };

/** A Recap as its stories show it: Core's slides, their songs loaded. */
export interface LoadedRecap {
  readonly period: RecapPeriod;
  readonly title: string;
  readonly slides: readonly LoadedRecapSlide[];
}

/** The song rows a Recap reads; each app supplies its own schedule of them. */
interface RecapSongReads<E> {
  readonly songsByIds: (ids: readonly number[]) => Effect.Effect<readonly SongRow[], E>;
  readonly streamedSongsByIds: (
    ids: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, YtAlbumSong>, E>;
}

/** How many discovered artists a Recap's slide names. */
const DISCOVERED_SHOWN = 5;

/** The rows a Recap's slides show, by the ids Core ranked them by. */
interface RecapRows {
  readonly artists: ReadonlyMap<number | string, PlayedArtist>;
  readonly albums: ReadonlyMap<number | string, PlayedAlbum>;
}

/** [ranking]'s entities with their rows, in ranking order; one without a row is skipped. */
const withItems = <A>(
  ranking: readonly EntityPlayTotals[],
  rows: ReadonlyMap<number | string, A>,
): Ranked<A>[] =>
  ranking.flatMap((entry) => {
    const item = rows.get(entry.id);
    return item === undefined ? [] : [{ item, countedPlays: entry.countedPlays }];
  });

/** A Recap's song ranking as Stats ranks songs: a Library song by its id, a streamed one by its video id. */
const recapSongs = <E>(
  store: RecapSongReads<E>,
  ranking: readonly EntityPlayTotals[],
): Effect.Effect<readonly Ranked<StatsSong>[], E> =>
  rankSongs(
    store,
    ranking.map(({ id, ...totals }) => ({
      ...totals,
      song: typeof id === "number" ? { kind: "library", id } : { kind: "yt", videoId: id },
    })),
  );

/** Loads a slide's rows; a slide whose songs, artists or album all left the library is dropped. */
const loadSlide = <E>(
  store: RecapSongReads<E>,
  rows: RecapRows,
  slide: RecapSlide,
): Effect.Effect<readonly LoadedRecapSlide[], E> => {
  switch (slide.kind) {
    case "minutes":
      return Effect.succeed([slide]);
    case "topSongs":
      return Effect.map(recapSongs(store, slide.songs), (songs) =>
        songs.length === 0 ? [] : [{ kind: "topSongs", songs }],
      );
    case "topArtists": {
      const artists = withItems(slide.artists, rows.artists);
      return Effect.succeed(artists.length === 0 ? [] : [{ kind: "topArtists", artists }]);
    }
    case "topAlbum": {
      const [album] = withItems([slide.album], rows.albums);
      return Effect.succeed(album === undefined ? [] : [{ kind: "topAlbum", album }]);
    }
    case "discovered": {
      const artists = withItems(slide.artists.slice(0, DISCOVERED_SHOWN), rows.artists);
      return Effect.succeed(
        artists.length === 0 ? [] : [{ kind: "discovered", count: slide.artists.length, artists }],
      );
    }
    case "summary":
      return Effect.map(recapSongs(store, slide.songs), (songs) => [
        {
          kind: "summary",
          minutes: slide.minutes,
          songs,
          artists: withItems(slide.artists, rows.artists),
          genre: slide.genre,
        },
      ]);
    case "topGenres":
    case "habits":
      return Effect.succeed([slide]);
  }
};

/**
 * [period]'s Recap from its counted [listening] and [plays] (`recapPlays`), its slides in
 * Core's order with their rows loaded. The caller decides first whether the period has one.
 */
export const loadRecapStories = <E>(
  store: RecapSongReads<E>,
  {
    period,
    listening,
    plays,
  }: {
    readonly period: RecapPeriod;
    readonly listening: readonly CountedListening[];
    readonly plays: RecapPlays;
  },
): Effect.Effect<LoadedRecap, E> =>
  Effect.gen(function* () {
    const computed = recap({ period, listening, ...plays });
    const rows: RecapRows = {
      artists: new Map(plays.artists.map((entry) => [entry.id, entry.item])),
      albums: new Map(plays.albums.map((entry) => [entry.id, entry.item])),
    };
    const slides = yield* Effect.forEach(recapSlides(computed), (slide) =>
      loadSlide(store, rows, slide),
    );
    return { period, title: computed.title, slides: slides.flat() };
  });
