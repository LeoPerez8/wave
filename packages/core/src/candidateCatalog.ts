/**
 * The candidate catalog (docs/spec.md, "Candidate catalog"): the YT Music
 * songs YouTube Music has already shown Wave, kept on the phone so
 * recommendations can later be built without the network. Every song a
 * radio (a mix's, the Magic Queue's) or an artist page brings comes in with
 * its metadata; a radio's songs also keep whose radio brought them (the
 * radio's seed artist) and when, the raw material of the artist graph and
 * of popularity (how many distinct radios carry a song). Core decides what
 * a page adds, how a song seen again merges and what leaves; the app stores
 * it and reads YouTube Music.
 */

import { artistPhotoName, artistPhotoQuery } from "./artistPhoto.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import type { YtSong } from "./ytMusic.ts";

/** One radio that brought a song: its seed artist and when it last did. */
export interface CatalogRadio {
  /** The seed artist as artists are told apart (`catalogSeedKey`). */
  readonly seed: string;
  /** The seed artist's name, as the radio was asked for. */
  readonly seedName: string;
  readonly lastSeenAt: number;
}

/** A song of the candidate catalog. */
export interface CatalogSong {
  readonly song: YtAlbumSong;
  /** When a radio or page first brought it (ms since the epoch). */
  readonly firstSeenAt: number;
  /** When a radio or page last brought it. */
  readonly lastSeenAt: number;
  /** The distinct radios that brought it, one per seed artist. */
  readonly radios: readonly CatalogRadio[];
}

/** A song as a radio or an artist page brings it: a radio's may be a music video. */
export type CatalogPageSong = YtSong & {
  readonly albumId?: string | null;
  readonly video?: boolean;
};

/** What one radio or artist page brought. */
export interface CatalogPage {
  readonly songs: readonly CatalogPageSong[];
  /** The radio's seed artist's name; null for an artist page (no radio evidence). */
  readonly seed: string | null;
}

/**
 * [name]'s key as the catalog tells seed artists apart (as artist photos
 * compare names, `artistPhotoName`), or null when the name isn't an
 * artist's ("Various Artists"): such a radio brings songs but no evidence.
 */
export const catalogSeedKey = (name: string): string | null =>
  artistPhotoQuery(name) === null ? null : artistPhotoName(name);

/** [song]'s metadata as the catalog keeps it. */
const catalogMetadata = (song: CatalogPageSong): YtAlbumSong => ({
  videoId: song.videoId,
  title: song.title,
  artists: song.artists,
  album: song.album,
  albumId: song.albumId ?? null,
  durationMs: song.durationMs,
  artworkUrl: song.artworkUrl,
  explicit: song.explicit,
});

/** [radios] with [radio] seen: a seed already there counts once, seen again now. */
const withRadio = (radios: readonly CatalogRadio[], radio: CatalogRadio): CatalogRadio[] =>
  radios.some((known) => known.seed === radio.seed)
    ? radios.map((known) =>
        known.seed === radio.seed
          ? { ...radio, lastSeenAt: Math.max(known.lastSeenAt, radio.lastSeenAt) }
          : known,
      )
    : [...radios, radio];

/**
 * The catalog entries [page] writes at [now], given the songs [known] by
 * video id: each of its songs once, in the page's order, music videos left
 * out (mixes never keep them). A song new to the catalog comes in seen now;
 * one seen before keeps when it was first seen, is seen now and takes the
 * page's metadata. A radio's songs count it among their radios once, by its
 * seed artist (`catalogSeedKey`); an artist page's, or a radio whose seed
 * isn't an artist's, count no radio.
 */
export const catalogSeen = (
  known: ReadonlyMap<string, CatalogSong>,
  page: CatalogPage,
  now: number,
): CatalogSong[] => {
  const seedKey = page.seed === null ? null : catalogSeedKey(page.seed);
  const radio: CatalogRadio | null =
    seedKey === null || page.seed === null
      ? null
      : { seed: seedKey, seedName: page.seed, lastSeenAt: now };
  const seen = new Set<string>();
  const entries: CatalogSong[] = [];
  for (const song of page.songs) {
    if (song.video === true || song.videoId === "" || seen.has(song.videoId)) continue;
    seen.add(song.videoId);
    const before = known.get(song.videoId);
    const radios = before?.radios ?? [];
    entries.push({
      song: catalogMetadata(song),
      firstSeenAt: Math.min(before?.firstSeenAt ?? now, now),
      lastSeenAt: Math.max(before?.lastSeenAt ?? now, now),
      radios: radio === null ? radios : withRadio(radios, radio),
    });
  }
  return entries;
};

/** The most songs the catalog keeps. */
export const CATALOG_MOST = 5_000;

/** A song no radio or page brought for this long leaves (60 days), and a radio stops counting. */
export const CATALOG_UNSEEN_MS = 60 * 24 * 60 * 60 * 1000;

/** A catalog song as deciding what leaves sees it. */
export interface CatalogSeenSong {
  readonly videoId: string;
  readonly lastSeenAt: number;
}

/** What leaves the catalog. */
export interface CatalogLeaving {
  /** The songs that leave, by video id, with their radios. */
  readonly songs: readonly string[];
  /** A radio that last brought a song before this, or then, stops counting for it (ms since the epoch). */
  readonly radiosSeenBefore: number;
}

/**
 * What leaves the catalog of [songs] at [now]: every song no radio or page
 * brought in 60 days (`CATALOG_UNSEEN_MS`), then, past 5,000 songs
 * (`CATALOG_MOST`), the least recently seen. A radio that last brought a
 * song that long ago stops counting among the song's radios, so a seed's
 * radio forgets what it no longer plays.
 */
export const catalogLeaving = (songs: readonly CatalogSeenSong[], now: number): CatalogLeaving => {
  const seenBefore = now - CATALOG_UNSEEN_MS;
  const leaving: string[] = [];
  const staying: CatalogSeenSong[] = [];
  for (const song of songs) {
    if (song.lastSeenAt <= seenBefore) leaving.push(song.videoId);
    else staying.push(song);
  }
  if (staying.length > CATALOG_MOST) {
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array the loop made; Hermes lacks toSorted
    const oldestFirst = staying.sort(
      (a, b) => a.lastSeenAt - b.lastSeenAt || (a.videoId < b.videoId ? -1 : 1),
    );
    for (const song of oldestFirst.slice(0, staying.length - CATALOG_MOST))
      leaving.push(song.videoId);
  }
  return { songs: leaving, radiosSeenBefore: seenBefore };
};
